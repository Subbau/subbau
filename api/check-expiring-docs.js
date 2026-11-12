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

const crypto = require('crypto');
// Deník chyb (2. 11. 2026, majitel: „jakoukoliv chybu napříč aplikací to musí
// zaznamenat"). Tenhle hlídač běží ráno sám (cron) a jeho výstup končí jen
// v logu Vercelu — kdyby spadl nebo něco nedoručil, nikdo by se to nedozvěděl.
const { zapisChybuServeru, kodVyjimky, stavVyjimky } = require('./_denik.js');

// Porovnání hesla, které trvá vždycky stejně dlouho. U běžného === se dá podle
// doby odpovědi heslo uhodnout znak po znaku.
function hesloSedi(zadane, spravne) {
  const a = Buffer.from(String(zadane));
  const b = Buffer.from(String(spravne));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (e) { return false; }
}

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
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Supabase ${resp.status}: ${body.slice(0, 300)}`);
  }
  // DELETE/PATCH bez Prefer:return=representation vrací prázdné tělo
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// Načte VŠECHNY řádky (Supabase vrací nanejvýš max-rows na dotaz). Cesta musí mít
// jednoznačné řazení (order=…,id.asc), jinak by stránky mohly přeskakovat řádky.
async function sbVse(path, serviceKey) {
  const vse = [];
  for (let strana = 0; strana < 200; strana++) {
    const dalsi = await sb(`${path}&limit=1000&offset=${vse.length}`, serviceKey);
    if (!Array.isArray(dalsi) || !dalsi.length) break;
    vse.push(...dalsi);
  }
  return vse;
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
      signal: AbortSignal.timeout(15000),
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

// Povinné doklady. Občanka a pas jsou zaměnitelné — stačí jeden z nich.
// Musí odpovídat DOC_TYPES v subbau_final.html (required: true).
const POVINNE_DOKLADY = ['op', 'zivnost', 'a1', 'ridicak'];

// Nadpis upomínky. Podle něj se pozná, co už dneska odešlo — proto musí být
// pokaždé stejný a nesmí se do něj cpát jméno ani seznam dokladů.
const UPOMINKA_NADPIS = '📄 Chybí nám od vás doklady';

// Upomínky za CHYBĚJÍCÍ doklady — ty, které nikdo nikdy nenahrál.
// Chodí jen v pondělí a ve čtvrtek, a jen jako zpráva v aplikaci (bez e-mailu).
// Dokud člověk doklad nedodá, připomene se mu to dvakrát týdně.
async function upomenChybejiciDoklady(serviceKey, dnesIso) {
  const den = new Date(dnesIso + 'T00:00:00').getDay();   // 0 = neděle
  if (den !== 1 && den !== 4) return { preskoceno: 'není pondělí ani čtvrtek' };

  const lide = await sbVse(
    `profiles?select=id,full_name,bez_ridicaku&role=in.(osvec,partak)&is_active=eq.true&order=id.asc`,
    serviceKey
  ).catch(async () => await sbVse(
    // Bez migrace sloupec bez_ridicaku není — načti to aspoň bez něj.
    `profiles?select=id,full_name&role=in.(osvec,partak)&is_active=eq.true&order=id.asc`,
    serviceKey
  ));
  if (!lide?.length) return { poslano: 0 };

  const ids = lide.map((w) => w.id);
  const doklady = await sbVsePodleId(
    `documents?select=worker_id,doc_type,status&worker_id=in.`, ids, `&order=id.asc`,
    serviceKey
  );

  // Co už dneska odešlo — ať se při dvojím spuštění neposílá dvakrát.
  // Poznáváme to podle nadpisu, ne podle vlastního typu: sloupec `type` může
  // mít v databázi omezený výčet hodnot a nová hodnota by zápis tiše shodila.
  // Když se to nepovede načíst, upomínky se neposílají (neověřený stav = riziko dvojí zprávy).
  const jizPoslano = await sbVse(
    `notifications?select=worker_id&title=eq.${encodeURIComponent(UPOMINKA_NADPIS)}&created_at=gte.${dnesIso}T00:00:00&order=id.asc`,
    serviceKey
  );
  const dnesUz = new Set((jizPoslano || []).map((n) => n.worker_id));

  let poslano = 0;
  const chyby = [];
  // Doklady podle člověka jednou (dřív se pro každého filtrovaly všechny).
  const doklPodleLidi = new Map();
  for (const d of (doklady || [])) {
    if (!doklPodleLidi.has(d.worker_id)) doklPodleLidi.set(d.worker_id, []);
    doklPodleLidi.get(d.worker_id).push(d);
  }
  // Zprávy se zakládají po osmi naráz (dřív jedna po druhé: 200 lidí × ~150 ms = 30 s
  // a víc, a funkce na Vercelu má strop doby běhu).
  await souNaraz(lide, 8, async (w) => {
    if (dnesUz.has(w.id)) return;
    const moje = doklPodleLidi.get(w.id) || [];
    const chceme = w.bez_ridicaku === true
      ? POVINNE_DOKLADY.filter((t) => t !== 'ridicak')
      : POVINNE_DOKLADY;
    const chybi = chceme.filter((typ) => !moje.some((d) => {
      // Starší typ gewerbeschein je pro appku totéž co zivnost.
      const dt = d.doc_type === 'gewerbeschein' ? 'zivnost' : d.doc_type;
      const sedi = typ === 'op' ? (dt === 'op' || dt === 'pas') : dt === typ;
      return sedi && d.status !== 'rejected' && d.status !== 'unreadable';
    }));
    if (!chybi.length) return;

    const seznam = chybi.map((t) => DOC_LABELS[t] || t).join(', ');
    try {
      await sb('notifications', serviceKey, {
        method: 'POST',
        body: JSON.stringify({
          worker_id: w.id,
          title: UPOMINKA_NADPIS,
          message: 'Zatím nemáme: ' + seznam
            + '. Nahrajte je prosím v aplikaci v sekci Dokumenty. Bez nich vám nemůžeme proplácet práci.',
          type: 'obecna',
          is_read: false,
        }),
      });
      poslano++;
    } catch (e) {
      chyby.push(String(e?.message || e));
    }
  });
  return { poslano, chyby };
}

// Co ranní běh nedotáhl, i když doběhl (přesuny, upomínky, zprávy v appce,
// e-maily, značka „upozorněno") — jeden řádek do deníku chyb za celý běh.
// Jména lidí ani doklady se do deníku nepíšou, jen počty.
async function nahlasProblemyBehu(presuny, upominky, results) {
  try {
    const vysledky = results || [];
    const pocty = {
      presuny: presuny && presuny.chyba !== undefined ? 1 : 0,
      upominky: upominky && (upominky.chyba || (upominky.chyby && upominky.chyby.length)) ? 1 : 0,
      zpravVAppce: vysledky.filter((r) => r.inApp === 'neodesláno').length,
      emailu: vysledky.filter((r) => typeof r.email === 'string' && /^neodesláno \((Brevo |(?!BREVO_API_KEY|chybí e-mail))/.test(r.email)).length,
      znacek: vysledky.filter((r) => r.error).length,
    };
    const celkem = pocty.presuny + pocty.upominky + pocty.zpravVAppce + pocty.emailu + pocty.znacek;
    if (!celkem) return;
    const co = Object.entries(pocty).filter(([, n]) => n > 0).map(([k, n]) => k + ' ' + n).join(', ');
    await zapisChybuServeru('check-expiring-docs', 'Ranní hlídač dokladů doběhl, ale něco nedotáhl: ' + co, {
      t: 'varovani', krok: 'souhrn-behu', problemu: celkem, neodeslano: pocty.zpravVAppce + pocty.emailu,
      stav: presuny && Number.isInteger(presuny.chyba) ? presuny.chyba : undefined,
    });
  } catch (e) { console.error('[check-expiring-docs] souhrn do deníku chyb:', (e && e.name) || e); }
}

// Seznam id do `in.(…)` po kusech: 200 uuid v jedné adrese je přes 7 kB a brány
// před databází (a Node) mají strop na délku adresy kolem 8 kB — dotaz by u plné
// firmy spadl na 414. Kusy jdou souběžně (po 4), výsledky se složí za sebou.
async function sbVsePodleId(cestaPred, ids, cestaPo, serviceKey, kus = 50) {
  const kusy = [];
  for (let i = 0; i < ids.length; i += kus) kusy.push(ids.slice(i, i + kus));
  const vysledky = new Array(kusy.length);
  await souNaraz(kusy.map((k, i) => [k, i]), 4, async ([k, i]) => {
    vysledky[i] = await sbVse(`${cestaPred}(${k.join(',')})${cestaPo}`, serviceKey);
  });
  return vysledky.flat();
}

// Pracovní fronta: `fn` se pustí nad položkami, nejvýš `pocet` naráz. Chyba z `fn`
// zastaví čekání (stejně jako dřív chyba ve smyčce); běžící volání dojedou.
async function souNaraz(polozky, pocet, fn) {
  let dalsi = 0;
  await Promise.all(Array.from({ length: Math.min(pocet, polozky.length) }, async () => {
    while (dalsi < polozky.length) await fn(polozky[dalsi++]);
  }));
}

module.exports = async function handler(req, res) {
  // Endpoint smí spustit jen ten, kdo zná CRON_SECRET.
  //
  // Dřív stačilo poslat hlavičku User-Agent s textem „vercel-cron" — jenže tu si
  // nastaví kdokoli jedním příkazem, takže to žádná ochrana nebyla. Kdo znal
  // adresu, mohl robota spouštět opakovaně: rozesílat pracovníkům e-maily,
  // umlčet skutečnou ranní připomínku na 14 dní a číst si jména a doklady.
  //
  // Vercel Cron posílá heslo sám v hlavičce Authorization: Bearer <CRON_SECRET>,
  // jakmile je proměnná nastavená — na hádání podle User-Agent tedy není důvod.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Bez nastaveného hesla radši neběžet vůbec, než běžet komukoli na požádání.
    res.status(503).json({ ok: false, error: 'cron_secret_not_configured' });
    return;
  }
  const bearer = String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
  const provided = String(req.query?.secret ?? req.headers['x-cron-secret'] ?? bearer);
  if (!hesloSedi(provided, secret)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ ok: false, error: 'server_not_configured' });
    return;
  }

  // PLÁNOVANÉ PŘESUNY MEZI UBYTOVÁNÍMI (majitel 4. 10. 2026: „ten den se
  // přesune sám"). Ranní běh provede plány, kterým nastal den — i když ten den
  // nikdo z kanceláře appku neotevře. Funkce v databázi (supabase-migrace-
  // ubytovani-presuny.sql) běží pod serverem, takže se do historie úprav zapíše
  // jako „server". Chyba tady nesmí zastavit hlídání dokladů; jen se vrátí ve
  // výsledku (dokud SQL neproběhlo, přijde 404 a nic se neděje).
  let presuny = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/skupinky_proved_presuny`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    presuny = r.ok ? { provedeno: await r.json() } : { chyba: r.status };
  } catch (e) {
    presuny = { chyba: String(e?.message || e) };
  }

  const today = midnight(new Date());
  const limit = new Date(today.getTime() + WARN_DAYS * 86400000);
  const toIso = (d) => d.toISOString().slice(0, 10);

  try {
    // 1) Doklady, kterým do měsíce končí platnost (a propadlé za poslední půlrok —
    //    starší už nemá cenu připomínat, tam se řeší rovnou nový doklad).
    const past = new Date(today.getTime() - 180 * 86400000);
    const docs = await sbVse(
      `documents?select=*` +
        `&valid_until=gte.${toIso(past)}&valid_until=lte.${toIso(limit)}` +
        `&status=not.in.(rejected,unreadable)&order=valid_until.asc,id.asc`,
      serviceKey
    );

    // Upomínky za CHYBĚJÍCÍ doklady běží nezávisle na tom, jestli zrovna
    // někomu končí platnost — proto se pouštějí dřív než případný odchod níž.
    const upominky = await upomenChybejiciDoklady(serviceKey, toIso(today))
      .catch((e) => ({ chyba: String(e?.message || e) }));

    if (!docs?.length) {
      await nahlasProblemyBehu(presuny, upominky, []);
      res.status(200).json({ ok: true, checked: 0, notified: 0, upominky, presuny, message: 'Žádné končící doklady' });
      return;
    }

    // 2) Načti pracovníky (jen aktivní — odebraným nemá smysl psát)
    const ids = [...new Set(docs.map((d) => d.worker_id))].filter(Boolean);
    const workers = await sbVsePodleId(
      `profiles?select=id,full_name,email,is_active&id=in.`, ids, `&order=id.asc`,
      serviceKey
    );
    const workerById = new Map((workers || []).map((w) => [w.id, w]));

    // Doklad, co mezitím nahradil novější (pracovník ho sám nahrál znovu),
    // se nesmí dál připomínat — starý řádek se při nahrání nového nikde
    // neoznačí jako nahrazený, takže upomínka na něj jela dál vedle nového
    // dokladu (audit 16. 10. 2026). „op" a „pas" počítáme jako stejný typ
    // dokladu, stejně jako chybějící doklady výš.
    // Když se kontrola nepovede načíst, běh skončí chybou (do deníku) — bez ní by se
    // připomínaly doklady, které už pracovník nahradil novým.
    const vsechnyDoklady = await sbVsePodleId(
      `documents?select=worker_id,doc_type,status,uploaded_at&worker_id=in.`, ids,
      `&status=not.in.(rejected,unreadable)&order=id.asc`,
      serviceKey
    );
    const typovaSkupina = (t) => (t === 'op' || t === 'pas') ? 'op' : (t === 'gewerbeschein' ? 'zivnost' : t);
    const nejnovejsi = new Map();
    for (const d of (vsechnyDoklady || [])) {
      const klic = d.worker_id + '|' + typovaSkupina(d.doc_type);
      const aktualni = nejnovejsi.get(klic);
      if (!aktualni || String(d.uploaded_at || '') > String(aktualni)) nejnovejsi.set(klic, d.uploaded_at);
    }

    const results = [];
    const adminSummary = [];

    // Doklady se zpracují po čtyřech naráz (dřív jeden po druhém: rezervace, zpráva
    // a e-mail = 3 obrátky na doklad, u stovky dokladů přes minutu). Výsledky se na
    // konci skládají podle pořadí dokladů, takže odpověď i souhrn jsou stejné jako dřív.
    const zaznamy = new Array(docs.length);
    await souNaraz(docs.map((d, i) => [d, i]), 4, async ([doc, poradi]) => {
      const mojeVysl = [];
      const mojeSouhrn = [];
      zaznamy[poradi] = { vysl: mojeVysl, souhrn: mojeSouhrn };

      const worker = workerById.get(doc.worker_id);
      if (!worker || worker.is_active === false) return;

      // Doklad, u kterého admin řekl „platnost neřešíme" — nepřipomínat.
      // (Když migrace supabase-migrace-doklad-bez-expirace.sql ještě neproběhla,
      //  sloupec chybí, hodnota je undefined a chová se to jako dřív.)
      if (doc.no_expiry) return;

      // Novější doklad stejného typu už existuje — tenhle starý přeskočit.
      const nejnovejsiUploadTypu = nejnovejsi.get(doc.worker_id + '|' + typovaSkupina(doc.doc_type));
      if (nejnovejsiUploadTypu && String(nejnovejsiUploadTypu) > String(doc.uploaded_at || '')) return;

      const daysLeft = daysBetween(today, new Date(doc.valid_until + 'T00:00:00'));
      // Propadlý doklad připomínáme, dokud ho nevymění; končící až od 30 dní.
      if (daysLeft > WARN_DAYS) return;

      // Neposílat každý den to samé
      if (doc.expiry_notified_at) {
        const since = daysBetween(new Date(doc.expiry_notified_at), today);
        if (since < REMIND_AFTER_DAYS) return;
      }

      // Rezervace upomínky: podmíněný zápis značky PŘED odesláním. Druhý souběžný běh
      // (ruční spuštění přes cron) už nic nenajde a neposílá znovu.
      const puvodniZnacka = doc.expiry_notified_at || null;
      const zacatekRezervace = new Date(Date.now() - 10 * 60000).toISOString();
      const mojeRezervace = new Date().toISOString();
      try {
        const vzato = await sb(`documents?id=eq.${doc.id}` +
          `&or=(expiry_notified_at.is.null,expiry_notified_at.lt.${encodeURIComponent(zacatekRezervace)})&select=id`, serviceKey, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ expiry_notified_at: mojeRezervace }),
        });
        if (!Array.isArray(vzato) || !vzato.length) return;
      } catch (e) {
        // Když sloupec ještě neexistuje (neproběhla migrace), upozornění by
        // chodilo denně — radši to ohlásíme v odpovědi, ať je to vidět.
        mojeVysl.push({ worker: worker.full_name, doc: (DOC_LABELS[doc.doc_type] || doc.doc_type || 'Dokument'), error: 'expiry_notified_at: ' + e.message });
        return;
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

      // 4) Značka „upozorněno" zůstane jen při doručení aspoň jedním kanálem; jinak se
      //    rezervace vrátí a další běh to zkusí znovu (ne až za 14 dní).
      if (!inApp && !mail.sent) {
        try {
          await sb(`documents?id=eq.${doc.id}&expiry_notified_at=gte.${encodeURIComponent(zacatekRezervace)}`, serviceKey, {
            method: 'PATCH',
            body: JSON.stringify({ expiry_notified_at: puvodniZnacka }),
          });
        } catch (e) {
          mojeVysl.push({ worker: worker.full_name, doc: label, error: 'expiry_notified_at: ' + e.message });
          return;
        }
      }

      mojeVysl.push({
        worker: worker.full_name,
        doc: label,
        validUntil: doc.valid_until,
        daysLeft,
        email: mail.sent ? 'odesláno' : 'neodesláno (' + mail.reason + ')',
        inApp: inApp ? 'odesláno' : 'neodesláno',
      });
      mojeSouhrn.push(
        `${worker.full_name} — ${label}: ${expired ? 'PROPADLO ' + czDate(doc.valid_until) : 'zbývá ' + daysLeft + ' ' + dayWord(daysLeft) + ' (do ' + czDate(doc.valid_until) + ')'}`
      );
        });
    for (const z of zaznamy) { if (!z) continue; results.push(...z.vysl); adminSummary.push(...z.souhrn); }

    // 5) Souhrn pro SubBau (nepovinné)
    const adminMail = process.env.DOC_EXPIRY_ADMIN_EMAIL;
    if (adminMail && adminSummary.length) {
      const souhrn = await sendEmail({
        to: adminMail,
        subject: `Doklady ke kontrole: ${adminSummary.length}`,
        html:
          '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7">' +
          '<b>Doklady, kterým končí nebo skončila platnost:</b><br><br>' +
          adminSummary.map((s) => '• ' + escapeHtml(s)).join('<br>') +
          '</div>',
      });
      if (!souhrn.sent) results.push({ error: 'souhrn pro správce neodeslán (' + String(souhrn.reason || '').slice(0, 60) + ')' });
    }

    // V odpovědi schválně nejsou jména pracovníků ani jejich doklady — kdyby se
    // heslo někdy dostalo ven, ať s ním neunikne rovnou seznam lidí ve firmě.
    // Podrobnosti zůstávají v logu nasazení ve Vercelu.
    const problemy = results.filter((r) => r.error).map((r) => r.error);
    await nahlasProblemyBehu(presuny, upominky, results);
    res.status(200).json({ ok: true, checked: docs.length, notified: results.length, upominky, presuny, problemy });
  } catch (e) {
    // Celý ranní běh spadl — upozornění na doklady dnes neodešla nikomu.
    await zapisChybuServeru('check-expiring-docs', 'Ranní hlídač dokladů spadl — upozornění dnes neodešla (' + kodVyjimky(e) + ')',
      { krok: 'beh', stav: stavVyjimky(e), kod: kodVyjimky(e) });
    res.status(500).json({ ok: false, error: String(e?.message || e), presuny });
  }
};
