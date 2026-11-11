// Odešle fakturu ODBĚRATELI (např. MMI) z firemního mailboxu přes SMTP (Wedos) — jedna
// faktura = jeden e-mail, PDF v příloze. Volá se z appky tlačítkem „Odeslat" u faktury
// (nebo „Odeslat všechny" u firmy v týdnu) — dostane hotové PDF z appky.
//
// NASTAVENÍ ve Vercel → Project Settings → Environment Variables (heslo NIKDY do chatu):
//   WEDOS_SMTP_HOST  — server odchozí pošty (např. wes1-smtp.wedos.net; viz Wedos → e-mail → nastavení)
//   WEDOS_SMTP_PORT  — 465 (šifrované hned) nebo 587 (STARTTLS); výchozí 465
//   WEDOS_SMTP_USER  — celá adresa mailboxu, např. faktury@subbau.cz
//   WEDOS_SMTP_PASS  — heslo k mailboxu
//   WEDOS_SMTP_FROM  — nepovinné; výchozí = WEDOS_SMTP_USER
//   WEDOS_SMTP_NAME  — nepovinné; jméno odesílatele (výchozí „SubBau")
//   WEDOS_SMTP_BCC   — nepovinné; skrytá kopie každé faktury sobě (pro archiv)
//
// Bezpečnost: posílat smí jen přihlášený SPRÁVCE (ověřuje se Bearer token proti Supabase
// Auth a role v profilu). Počet odeslání se brzdí podle člověka i podle IP.
// Bez nastavení se nic neodešle a appka to pozná (sent:false).

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlZWZ6bGtqbnJjbGZwbWhnZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTkxODYsImV4cCI6MjA5MjI5NTE4Nn0.fIewYds5zd3AICHWSpbcfOKk_SfGHuP1I-YR1yKW4NI';
// Deník chyb (2. 11. 2026): faktura, kterou Brevo odmítl nebo která cestou
// spadla, se zapíše i na serveru — appka se o tom dozví jen jako „sent:false"
// a kancelář by jinak nevěděla, proč faktury nechodí.
const { zapisChybuServeru } = require('./_denik.js');
const { posliSmtp, sestavZpravu, jeEmail } = require('./_smtp.js');

const MAX_PDF_BYTES = 3 * 1024 * 1024;
const HITS = new Map();
function rateLimited(key, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const fresh = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) { HITS.set(key, fresh); return true; }
  fresh.push(now); HITS.set(key, fresh);
  if (HITS.size > 5000) HITS.clear();
  return false;
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
const safeFileName = (v) => {
  const base = String(v ?? '').split(/[\\/]/).pop() || '';
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return /\.pdf$/i.test(clean) ? clean : (clean || 'Rechnung') + '.pdf';
};
const applyCors = (req, res) => {
  const origin = String(req.headers.origin ?? '');
  const host = String(req.headers.host ?? '');
  try { if (origin && new URL(origin).host === host) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); } } catch {}
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ sent: false, reason: 'method_not_allowed' }); return; }
  if (rateLimited('odeslat-faktu:' + clientIp(req), 600)) { res.status(429).json({ sent: false, reason: 'rate_limited' }); return; }

  const callerToken = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) { res.status(401).json({ sent: false, reason: 'missing_token' }); return; }
  let caller = null, profil = null;
  try {
    const r1 = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${callerToken}` } });
    if (!r1.ok) { res.status(401).json({ sent: false, reason: 'invalid_session' }); return; }
    caller = await r1.json();
    if (!caller?.id) { res.status(401).json({ sent: false, reason: 'invalid_session' }); return; }
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,role,is_active,email&id=eq.${encodeURIComponent(caller.id)}&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${callerToken}`, Accept: 'application/json' } });
    const radky = r2.ok ? await r2.json() : null;
    profil = Array.isArray(radky) ? radky[0] : null;
  } catch (e) {
    await zapisChybuServeru('odeslat-fakturu', 'Ověření přihlášení před odesláním faktury odběrateli spadlo (' + ((e && e.name) || 'chyba') + ')', { krok: 'overeni', ucet: caller?.id });
    res.status(401).json({ sent: false, reason: 'invalid_session' }); return;
  }
  if (!profil || profil.is_active !== true || String(profil.role || '').trim().toLowerCase() !== 'admin') {
    res.status(403).json({ sent: false, reason: 'not_allowed' }); return;
  }
  if (rateLimited('odeslat-faktu-u:' + caller.id, 500)) { res.status(429).json({ sent: false, reason: 'rate_limited' }); return; }

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { res.status(400).json({ sent: false, reason: 'bad_json' }); return; }
  const komu = String(body.to || '').trim();
  if (!jeEmail(komu)) { res.status(400).json({ sent: false, reason: 'bad_recipient' }); return; }
  const pdfBase64 = String(body.pdfBase64 || '');
  if (!pdfBase64) { res.status(400).json({ sent: false, reason: 'missing_pdf' }); return; }
  if (pdfBase64.length * 0.75 > MAX_PDF_BYTES) { res.status(413).json({ sent: false, reason: 'pdf_too_large' }); return; }

  // Rezervace faktury: appka pošle číslo faktury a pokusu; těsně před SMTP se v databázi (serverový
  // čas, tokenem volajícího) ověří, že rezervace pořád patří TOMUHLE pokusu — jinak se neposílá.
  const invoiceId = String(body.invoiceId || ''), pokus = String(body.pokus || '');
  if (!invoiceId || !pokus) { res.status(400).json({ sent: false, reason: 'missing_reservation' }); return; }
  try {
    const rd = await fetch(`${SUPABASE_URL}/rest/v1/rpc/faktury_zacit_odesilani`, { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${callerToken}`, 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_invoice: invoiceId, p_pokus: pokus }) });
    const dj = rd.ok ? await rd.json().catch(() => null) : null;
    if (dj !== true) { res.status(200).json({ sent: false, reason: 'rezervace už nepatří tomuto pokusu — neposílám' }); return; }
  } catch (e) { res.status(200).json({ sent: false, reason: 'rezervaci se nepodařilo ověřit — neposílám' }); return; }

  const host = process.env.WEDOS_SMTP_HOST, user = process.env.WEDOS_SMTP_USER, pass = process.env.WEDOS_SMTP_PASS;
  if (!host || !user || !pass) {
    // Není to chyba appky — jen se ještě nenastavil mailbox.
    res.status(200).json({ sent: false, reason: 'not_configured' }); return;
  }
  const od = process.env.WEDOS_SMTP_FROM || user;
  const port = Number(process.env.WEDOS_SMTP_PORT) || 465;
  const predmet = String(body.subject || 'Faktura').slice(0, 200);
  const text = String(body.text || '').slice(0, 5000);
  try {
    const zprava = sestavZpravu({ od, odJmeno: process.env.WEDOS_SMTP_NAME || 'SubBau', komu, predmet, text,
      priloha: { nazev: safeFileName(body.fileName), obsah: Buffer.from(pdfBase64, 'base64') },
      odpoved: isReply(body.replyTo) ? body.replyTo : (profil.email || ''), domena: (od.split('@')[1] || 'subbau.local') });
    await posliSmtp({ host, port, user, pass, od, komu, kopie: process.env.WEDOS_SMTP_BCC, dovolBezTls: process.env.SMTP_TEST_BEZ_TLS === '1' }, zprava);
    res.status(200).json({ sent: true, to: komu });
  } catch (e) {
    const popis = String(e?.message || e).replace(pass, '***').slice(0, 220);
    await zapisChybuServeru('odeslat-fakturu', 'Odeslání faktury odběrateli selhalo: ' + popis.slice(0, 120), { krok: 'smtp', ucet: caller?.id });
    res.status(200).json({ sent: false, reason: popis, nejasne: !!(e && e.nejasne) });
  }
};
function isReply(v) { return jeEmail(v); }
