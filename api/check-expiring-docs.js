// Hlídá platnost dokladů (občanka, pas, A1, Freistellung…) a včas upozorní.
//
// Co dělá: jednou denně projde všechny doklady aktivních pracovníků, najde ty,
// kterým do měsíce končí platnost (nebo už propadly), a pošle pracovníkovi
// e-mail + zprávu přímo do aplikace. Admin to zároveň vidí na dashboardu.
//
// Spouští se automaticky přes Vercel Cron (nastaveno ve vercel.json).
// Ručně se dá zavolat takto (užitečné pro vyzkoušení):
//   curl "https://VASE-DOMENA/api/check-expiring-docs?secret=TAJNY_KLIC"
//
// E-maily posíláme přes Brevo — stejnou službou, kterou už používá náborový
// formulář (SubBau CRM). Klíč i odesílatel jsou proto pojmenované stejně,
// takže stačí zkopírovat hodnoty z projektu CRM.
//
// CO JE POTŘEBA NASTAVIT ve Vercel → Project Settings → Environment Variables:
//   SUPABASE_SERVICE_ROLE_KEY  — už používá funkce admin-update-worker
//   CRON_SECRET                — libovolné heslo; chrání endpoint před cizím voláním
//   BREVO_API_KEY              — stejný klíč jako v projektu CRM (bez něj se
//                                e-maily neposílají, zprávy v appce chodí dál)
//   BREVO_FROM_EMAIL           — nepovinné; výchozí je formular@subbau.cz
//   DOC_EXPIRY_ADMIN_EMAIL     — nepovinné; sem přijde denní souhrn pro SubBau

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';

// Kolik dní předem upozorňujeme (stejná hodnota je i v appce)
const WARN_DAYS = 30;
// Aby stejný doklad nespamoval každý den — další připomínka nejdřív za tolik dní
const REMIND_AFTER_DAYS = 14;

// Názvy dokladů — musí odpovídat DOC_TYPES v subbau_final.html
const DOC_LABELS = {
  op: 'Občanský průkaz',
  pas: 'Cestovní pas',
  ridicak: 'Řidičský průkaz',
  zivnost: 'Živnostenské oprávnění',
  gewerbeschein: 'Živnostenské oprávnění',
  a1: 'Formulář A1',
  a1_zadost: 'Žádost o A1',
  pobyt: 'Povolení k pobytu',
  vizum: 'Vízum',
  freistellung: 'Freistellung',
  other: 'Dokument',
};

const midnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const daysBetween = (from, to) => Math.round((midnight(to) - midnight(from)) / 86400000);
const czDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('cs-CZ');
const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Skloňování, ať zpráva nezní jako od stroje: 1 den / 2 dny / 5 dní
const dayWord = (n) => (n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní');

async function sb(path, serviceKey, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Supabase ${resp.status}: ${body.slice(0, 300)}`);
  }
  // DELETE/PATCH bez Prefer:return=representation vrací prázdné tělo
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'formular@subbau.cz';

async function sendEmail({ to, name, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { sent: false, reason: 'BREVO_API_KEY není nastavený' };
  try {
    const resp = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SubBau s.r.o.', email: FROM_EMAIL },
        to: [{ email: to, ...(name ? { name } : {}) }],
        subject,
        htmlContent: html,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { sent: false, reason: `Brevo ${resp.status}: ${body.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String(e?.message || e) };
  }
}

function workerEmailHtml({ name, docLabel, validUntil, daysLeft }) {
  const expired = daysLeft < 0;
  const headline = expired
    ? `Propadl vám doklad: ${docLabel}`
    : `Za ${daysLeft} ${dayWord(daysLeft)} vám končí platnost dokladu`;
  const body = expired
    ? `Platnost dokladu <b>${escapeHtml(docLabel)}</b> skončila <b>${czDate(validUntil)}</b>.
       Bez platného dokladu vás nemůžeme poslat na stavbu.`
    : `Doklad <b>${escapeHtml(docLabel)}</b> platí do <b>${czDate(validUntil)}</b>,
       tedy už jen <b>${daysLeft} ${dayWord(daysLeft)}</b>. Zařiďte si prosím nový včas,
       ať nemusíte přerušit práci.`;
  return `<!doctype html>
<html lang="cs"><body style="margin:0;background:#f4efe7;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#211D1A">
  <div style="max-width:520px;margin:0 auto;padding:24px 18px">
    <div style="background:#211D1A;border-radius:14px 14px 0 0;padding:18px 22px">
      <div style="color:#E8A13A;font-size:17px;font-weight:800">SubBau s.r.o.</div>
      <div style="color:rgba(250,247,242,.55);font-size:12px;margin-top:2px">Upozornění na platnost dokladu</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px">
      <div style="font-size:17px;font-weight:800;margin-bottom:10px;color:${expired ? '#9c3b22' : '#9a6b15'}">
        ${escapeHtml(headline)}
      </div>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px">Dobrý den${name ? ', ' + escapeHtml(name) : ''},</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 16px">${body}</p>
      <div style="background:${expired ? '#f7e9e5' : '#faf0dc'};border-radius:10px;padding:14px;font-size:13.5px;line-height:1.6">
        Jakmile budete mít nový doklad, nahrajte ho prosím v aplikaci
        (<b>Profil → Dokumenty → Nahrát</b>) a vyplňte novou platnost.
      </div>
      <p style="font-size:13px;color:#6b6157;line-height:1.6;margin:18px 0 0">
        Kdyby cokoliv, ozvěte se nám.<br>SubBau s.r.o.
      </p>
    </div>
  </div>
</body></html>`;
}

module.exports = async function handler(req, res) {
  // Endpoint chráníme heslem, ať ho nemůže spouštět kdokoliv.
  // Vercel Cron se hlásí vlastní hlavičkou, tu bereme také.
  const secret = process.env.CRON_SECRET;
  const provided = String(req.query?.secret ?? req.headers['x-cron-secret'] ?? '');
  const fromVercelCron = String(req.headers['user-agent'] ?? '').includes('vercel-cron');
  // Zamčeno i tehdy, když CRON_SECRET nikdo nenastavil. Dřív se v tom případě
  // kontrola přeskočila a robota mohl spustit kdokoli z internetu — a pracovníkům
  // by chodily připomínky pořád dokola. Bez hesla projde už jen Vercel Cron.
  const allowed = fromVercelCron || (!!secret && provided === secret);
  if (!allowed) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ ok: false, error: 'server_not_configured' });
    return;
  }

  const today = midnight(new Date());
  const limit = new Date(today.getTime() + WARN_DAYS * 86400000);
  const toIso = (d) => d.toISOString().slice(0, 10);

  try {
    // 1) Doklady, kterým do měsíce končí platnost (a propadlé za poslední půlrok —
    //    starší už nemá cenu připomínat, tam se řeší rovnou nový doklad).
    const past = new Date(today.getTime() - 180 * 86400000);
    const docs = await sb(
      `documents?select=*` +
        `&valid_until=gte.${toIso(past)}&valid_until=lte.${toIso(limit)}` +
        `&status=not.in.(rejected,unreadable)&order=valid_until.asc`,
      serviceKey
    );

    if (!docs?.length) {
      res.status(200).json({ ok: true, checked: 0, notified: 0, message: 'Žádné končící doklady' });
      return;
    }

    // 2) Načti pracovníky (jen aktivní — odebraným nemá smysl psát)
    const ids = [...new Set(docs.map((d) => d.worker_id))].filter(Boolean);
    const workers = await sb(
      `profiles?select=id,full_name,email,is_active&id=in.(${ids.join(',')})`,
      serviceKey
    );
    const workerById = new Map((workers || []).map((w) => [w.id, w]));

    const results = [];
    const adminSummary = [];

    for (const doc of docs) {
      const worker = workerById.get(doc.worker_id);
      if (!worker || worker.is_active === false) continue;

      // Doklad, u kterého admin řekl „platnost neřešíme" — nepřipomínat.
      // (Když migrace supabase-migrace-doklad-bez-expirace.sql ještě neproběhla,
      //  sloupec chybí, hodnota je undefined a chová se to jako dřív.)
      if (doc.no_expiry) continue;

      const daysLeft = daysBetween(today, new Date(doc.valid_until + 'T00:00:00'));
      // Propadlý doklad připomínáme, dokud ho nevymění; končící až od 30 dní.
      if (daysLeft > WARN_DAYS) continue;

      // Neposílat každý den to samé
      if (doc.expiry_notified_at) {
        const since = daysBetween(new Date(doc.expiry_notified_at), today);
        if (since < REMIND_AFTER_DAYS) continue;
      }

      const label = DOC_LABELS[doc.doc_type] || doc.doc_type || 'Dokument';
      const expired = daysLeft < 0;
      const title = expired ? '❌ Propadlý doklad' : '⏳ Končí platnost dokladu';
      const message = expired
        ? `${label} — platnost skončila ${czDate(doc.valid_until)}. Nahrajte prosím nový doklad.`
        : `${label} — platí do ${czDate(doc.valid_until)}, zbývá ${daysLeft} ${dayWord(daysLeft)}. Zařiďte si prosím nový včas.`;

      // 3a) Zpráva přímo v aplikaci — chodí vždy, i když e-maily nejsou nastavené
      let inApp = true;
      try {
        await sb('notifications', serviceKey, {
          method: 'POST',
          body: JSON.stringify({
            worker_id: worker.id,
            title,
            message,
            type: 'obecna',
            is_read: false,
          }),
        });
      } catch (e) {
        inApp = false;
      }

      // 3b) E-mail
      let mail = { sent: false, reason: 'chybí e-mail pracovníka' };
      if (worker.email) {
        mail = await sendEmail({
          to: worker.email,
          name: worker.full_name,
          subject: expired
            ? `Propadl vám doklad: ${label}`
            : `Za ${daysLeft} ${dayWord(daysLeft)} vám končí platnost: ${label}`,
          html: workerEmailHtml({
            name: worker.full_name,
            docLabel: label,
            validUntil: doc.valid_until,
            daysLeft,
          }),
        });
      }

      // 4) Zapiš, že jsme upozornili — ať se to zítra neopakuje
      try {
        await sb(`documents?id=eq.${doc.id}`, serviceKey, {
          method: 'PATCH',
          body: JSON.stringify({ expiry_notified_at: new Date().toISOString() }),
        });
      } catch (e) {
        // Když sloupec ještě neexistuje (neproběhla migrace), upozornění by
        // chodilo denně — radši to ohlásíme v odpovědi, ať je to vidět.
        results.push({ worker: worker.full_name, doc: label, error: 'expiry_notified_at: ' + e.message });
        continue;
      }

      results.push({
        worker: worker.full_name,
        doc: label,
        validUntil: doc.valid_until,
        daysLeft,
        email: mail.sent ? 'odesláno' : 'neodesláno (' + mail.reason + ')',
        inApp: inApp ? 'odesláno' : 'neodesláno',
      });
      adminSummary.push(
        `${worker.full_name} — ${label}: ${expired ? 'PROPADLO ' + czDate(doc.valid_until) : 'zbývá ' + daysLeft + ' ' + dayWord(daysLeft) + ' (do ' + czDate(doc.valid_until) + ')'}`
      );
    }

    // 5) Souhrn pro SubBau (nepovinné)
    const adminMail = process.env.DOC_EXPIRY_ADMIN_EMAIL;
    if (adminMail && adminSummary.length) {
      await sendEmail({
        to: adminMail,
        subject: `Doklady ke kontrole: ${adminSummary.length}`,
        html:
          '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">' +
          '<b>Doklady, kterým končí nebo skončila platnost:</b><br><br>' +
          adminSummary.map((s) => '• ' + escapeHtml(s)).join('<br>') +
          '</div>',
      });
    }

    res.status(200).json({ ok: true, checked: docs.length, notified: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
