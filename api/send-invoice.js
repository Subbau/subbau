// Odešle fakturu pracovníka e-mailem na faktury@subbau.cz — i s přílohou.
//
// PROČ SERVER: z prohlížeče e-mail s přílohou odeslat nejde. `mailto:` přílohu
// neumí a sdílení přes telefon vyžaduje, aby pracovník sám vybral poštu.
// Tahle funkce vezme hotové PDF z appky a pošle ho rovnou — pracovník jen
// zmáčkne tlačítko. Když funkce není nasazená nebo chybí klíč, appka to pozná
// (vrátí se `sent:false`) a nabídne pracovníkovi sdílení nebo mailto.
//
// E-maily posíláme přes Brevo — stejnou službou jako hlídač platnosti dokladů
// (api/check-expiring-docs.js), takže se použije stejný klíč.
//
// CO JE POTŘEBA NASTAVIT ve Vercel → Project Settings → Environment Variables:
//   BREVO_API_KEY     — stejný klíč jako u ostatních funkcí (bez něj se
//                       e-mail neodešle a appka nabídne náhradní cestu)
//   BREVO_FROM_EMAIL  — nepovinné; výchozí je formular@subbau.cz
//   INVOICE_TO_EMAIL  — nepovinné; výchozí je faktury@subbau.cz
//
// Bezpečnost: posílat smí jen přihlášený uživatel (ověřuje se Bearer token
// proti Supabase Auth) a jen sám za sebe. Adresa příjemce je pevně daná
// serverem — z prohlížeče ji přepsat nejde, aby se z endpointu nedal udělat
// rozesílač pošty.

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlZWZ6bGtqbnJjbGZwbWhnZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTkxODYsImV4cCI6MjA5MjI5NTE4Nn0.fIewYds5zd3AICHWSpbcfOKk_SfGHuP1I-YR1yKW4NI';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'formular@subbau.cz';
const TO_EMAIL = process.env.INVOICE_TO_EMAIL || 'faktury@subbau.cz';

// Vercel má na tělo požadavku limit kolem 4,5 MB. Faktura je jedna stránka,
// takže se vejde s velkou rezervou — větší soubor rovnou odmítneme s jasnou
// hláškou, ať se to neprojeví jako záhadná chyba.
const MAX_PDF_BYTES = 3 * 1024 * 1024;

// Brzda proti opakovanému bušení do endpointu (paměť žije jen po dobu běhu instance)
const HITS = new Map();
function rateLimited(key, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const fresh = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    HITS.set(key, fresh);
    return true;
  }
  fresh.push(now);
  HITS.set(key, fresh);
  if (HITS.size > 5000) HITS.clear();
  return false;
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';

const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

// Název přílohy nesmí obsahovat cestu ani divné znaky
const safeFileName = (v) => {
  const base = String(v ?? '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return /\.pdf$/i.test(clean) ? clean : (clean || 'faktura') + '.pdf';
};

const applyCors = (req, res) => {
  const origin = String(req.headers.origin ?? '');
  const host = String(req.headers.host ?? '');
  try {
    if (origin && new URL(origin).host === host) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } catch {
    // neplatná Origin hlavička — nic nepovolíme
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

function invoiceEmailHtml(d) {
  const row = (label, value) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#7a7168;font-size:13px">${escapeHtml(label)}</td>
         <td style="padding:4px 0;color:#211D1A;font-size:13px;font-weight:700">${escapeHtml(value)}</td></tr>`;
  const period = d.periodFrom && d.periodTo ? `${d.periodFrom} – ${d.periodTo}` : '';
  return `<div style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#211D1A">
    <h2 style="margin:0 0 4px;font-size:18px">Nová faktura od pracovníka</h2>
    <p style="margin:0 0 14px;color:#7a7168;font-size:13px">Faktura je v příloze jako PDF (jedna strana A4).</p>
    <table style="border-collapse:collapse">
      ${row('Pracovník', d.workerName || '—')}
      ${row('Číslo faktury', d.invoiceNumber || '—')}
      ${d.week ? row('Týden', `KW ${d.week}/${d.year}`) : ''}
      ${period ? row('Období plnění', period) : ''}
      ${row('Odpracováno', `${Number(d.totalHours || 0).toFixed(2)} h`)}
      ${row('Částka', `${Number(d.totalAmount || 0).toFixed(2)} EUR`)}
      ${d.customerName ? row('Odběratel', d.customerName) : ''}
    </table>
  </div>`;
}

// CommonJS (module.exports), ne "export default" — repozitář nemá package.json
// s "type":"module", takže by ESM syntaxe na Node runtime spadla.
module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ sent: false, reason: 'method_not_allowed' });
    return;
  }

  if (rateLimited(`send-invoice:${clientIp(req)}`, 20)) {
    res.status(429).json({ sent: false, reason: 'rate_limited' });
    return;
  }

  // 1) Kdo volá? — ověř přístupový token proti Supabase Auth
  const authHeader = String(req.headers.authorization ?? '');
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    res.status(401).json({ sent: false, reason: 'missing_token' });
    return;
  }
  try {
    const callerResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerResp.ok) {
      res.status(401).json({ sent: false, reason: 'invalid_session' });
      return;
    }
    const caller = await callerResp.json();
    if (!caller?.id) {
      res.status(401).json({ sent: false, reason: 'invalid_session' });
      return;
    }
  } catch {
    res.status(401).json({ sent: false, reason: 'invalid_session' });
    return;
  }

  // 2) Data faktury
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const pdfBase64 = String(body.pdfBase64 || '');
  if (!pdfBase64) {
    res.status(400).json({ sent: false, reason: 'missing_pdf' });
    return;
  }
  // base64 je zhruba o třetinu delší než samotný soubor
  if (pdfBase64.length * 0.75 > MAX_PDF_BYTES) {
    res.status(413).json({ sent: false, reason: 'pdf_too_large' });
    return;
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Není to chyba appky — jen tu není nastavený klíč. Appka na to zareaguje
    // a nabídne pracovníkovi odeslání přes jeho vlastní poštu.
    res.status(200).json({ sent: false, reason: 'BREVO_API_KEY není nastavený' });
    return;
  }

  const subjectParts = ['Faktura'];
  if (body.invoiceNumber) subjectParts.push(String(body.invoiceNumber));
  if (body.workerName) subjectParts.push('— ' + String(body.workerName));
  const subject = subjectParts.join(' ').slice(0, 200);

  try {
    const payload = {
      sender: { name: 'SubBau — appka', email: FROM_EMAIL },
      to: [{ email: TO_EMAIL }],
      subject,
      htmlContent: invoiceEmailHtml(body),
      attachment: [{ content: pdfBase64, name: safeFileName(body.fileName) }],
    };
    // Odpověď ať jde rovnou pracovníkovi, ne na formulářovou adresu
    if (isEmail(body.replyTo)) {
      payload.replyTo = { email: String(body.replyTo).trim(), name: String(body.workerName || '').slice(0, 100) };
    }

    const resp = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      res.status(200).json({ sent: false, reason: `Brevo ${resp.status}: ${text.slice(0, 200)}` });
      return;
    }
    res.status(200).json({ sent: true, to: TO_EMAIL });
  } catch (e) {
    res.status(200).json({ sent: false, reason: String(e?.message || e) });
  }
};
