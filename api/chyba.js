// =====================================================================
// ZÁPIS CHYBY BEZ PŘIHLÁŠENÍ — /api/chyba (2. 11. 2026)
//
// PROČ: majitel 2. 11. 2026 — „v tom deníku to musí hlídat úplně všechno …
// jakoukoliv chybu napříč aplikací to musí zaznamenat". Deník chyb
// (chyby_appky) přijme zápis jen od přihlášeného a jen za sebe (RLS). Kdo se
// do appky vůbec nedostane — appka se mu nespustí, přihlášení padá na
// serveru, registrace se nedokončí, firma podepisuje smlouvu přes odkaz,
// odběrateli spadne stránka s docházkou (klient.html) — ten by v deníku
// nezanechal nic. Tahle funkce jeho chybu zapíše serverovým klíčem
// s prázdným „kdo".
//
// CO PUSTÍ: jen POST z naší stránky (Origin nebo Referer = Host; u stránky
// s „no-referrer" pošle prohlížeč Origin „null" — pak stačí Sec-Fetch-Site
// same-origin, tu stránka podvrhnout nemůže), tělo do 8 kB (v BAJTECH —
// česká věta má víc bajtů než znaků), nejvýš 10 záznamů naráz, jen druhy ze
// seznamu DRUHY. Věta se očistí (e-mail, odkaz, klíč, uuid, dlouhé číslo
// pryč), z podrobností projdou jen povolené klíče se správným tvarem
// (api/_denik.js — stejné čištění jako u serverových zápisů). kdo
// i kdo_jmeno jsou VŽDY prázdné — v deníku je to „bez přihlášení
// (neověřeno)". IP adresa se nikam neukládá, slouží jen brzdě v paměti.
//
// ODPOVĚDI (appka podle nich ví, co dál):
//   204       zapsáno
//   400/403/413  zahodit (nikdy neprojde) — appka záznam označí _anon
//   429       počkat podle Retry-After
//   5xx       zkusit později (databáze neodpověděla, deník ještě není)
// BRZDA: 30 požadavků za 10 min z jedné adresy a 600 za 10 min na instanci.
// Paměť brzdy žije jen v jedné instanci funkce, skutečný strop drží
// databáze (supabase-migrace-chyby-appky-strop.sql: 300 záznamů bez
// přihlášení za hodinu). Funguje i bez té migrace.
// Do logu Vercelu jde jen stav a kód odpovědi databáze, nikdy tělo
// (u porušeného pravidla obsahuje celý řádek).
// vercel.json ani sw.js se kvůli tomu nemění: api/ je vyjmuté z přepisu
// na appku a service worker POST ani /api/ nepouští do paměti.
// CommonJS (module.exports) — repozitář nemá "type":"module".
// =====================================================================

const D = require('./_denik.js');

const MAX_TELO = 8192;
const MAX_ZAZNAMU = 10;

// Druhy, které smí přijít bez přihlášení. JEDEN SEZNAM pro celou appku
// (kritika 2): raný odchyt v subbau_final.html (POVOLENE), jádro deníku
// (DN_ANON) a tady. Přidává se sem, ne jinam.
//   js-chyba, js-neosetrena, zdroj-nenacten, start-*  raný odchyt, appka se nerozjela
//   prihlaseni, heslo-obnova, registrace(-profil)     přihlašovací obrazovka
//   odkaz-z-emailu, relace-znovu, relace-nefunguje    přihlášení nejde obnovit
//   podpis-firmy                                       stránka ?sign= pro firmu
//   klient                                             odkaz pro odběratele (klient.html)
//   sw                                                 service worker (chyba před přihlášením)
const DRUHY = new Set([
  'js-chyba', 'js-neosetrena', 'zdroj-nenacten',
  'start-knihovna', 'start-nedobehl', 'start-brzda',
  'prihlaseni', 'heslo-obnova', 'registrace', 'registrace-profil',
  'odkaz-z-emailu', 'relace-znovu', 'relace-nefunguje', 'podpis-firmy',
  'klient', 'sw',
]);

const ipKlienta = (req) =>
  String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'neznama';

// Přišel požadavek z naší stránky? Origin (nebo Referer) musí mít stejný
// host jako požadavek. Stránka s <meta name="referrer" content="no-referrer">
// (klient.html) posílá Origin „null" a žádný Referer — tam rozhodne
// Sec-Fetch-Site, kterou nastavuje prohlížeč sám.
function zNasiStranky(req) {
  const h = req.headers || {};
  const host = String(h.host || '');
  if (!host) return false;
  const odkud = String(h.origin && h.origin !== 'null' ? h.origin : (h.referer || ''));
  if (odkud) {
    try { return new URL(odkud).host === host; } catch (e) { return false; }
  }
  return String(h['sec-fetch-site'] || '') === 'same-origin';
}

const bajtu = (s) => Buffer.byteLength(String(s), 'utf8');

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, chyba: 'metoda' });
      return;
    }
    if (!zNasiStranky(req)) { res.status(403).json({ ok: false, chyba: 'cizi_stranka' }); return; }

    const delka = Number((req.headers && req.headers['content-length']) || 0);
    if (delka > MAX_TELO) { res.status(413).json({ ok: false, chyba: 'velke' }); return; }

    const zaS = D.zaKolikSekund('chyba:' + ipKlienta(req), 30) || D.zaKolikSekund('chyba:vse', 600);
    if (zaS) { res.setHeader('Retry-After', String(zaS)); res.status(429).json({ ok: false, chyba: 'moc' }); return; }

    const klic = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!klic) { res.status(503).json({ ok: false, chyba: 'nedostupne' }); return; }

    // Vercel tělo s Content-Type application/json rozbalí sám — u neplatného
    // JSON hodí výjimku už při čtení req.body.
    let telo;
    try {
      telo = req.body;
      if (typeof telo === 'string') {
        if (bajtu(telo) > MAX_TELO) { res.status(413).json({ ok: false, chyba: 'velke' }); return; }
        telo = JSON.parse(telo);
      } else if (Buffer.isBuffer(telo)) {
        if (telo.length > MAX_TELO) { res.status(413).json({ ok: false, chyba: 'velke' }); return; }
        telo = JSON.parse(telo.toString('utf8'));
      }
    } catch (e) { res.status(400).json({ ok: false, chyba: 'json' }); return; }
    let syrove = '';
    try { syrove = JSON.stringify(telo === undefined ? null : telo); } catch (e) { syrove = ''; }
    if (bajtu(syrove) > MAX_TELO) { res.status(413).json({ ok: false, chyba: 'velke' }); return; }

    const seznam = telo && Array.isArray(telo.zaznamy) ? telo.zaznamy : (telo && typeof telo === 'object' ? [telo] : []);
    const radky = seznam.slice(0, MAX_ZAZNAMU).map((z) => D.cistyZaznamBezPrihlaseni(z, DRUHY)).filter(Boolean);
    if (!radky.length) { res.status(400).json({ ok: false, chyba: 'nic_platneho' }); return; }

    const v = await D.vlozDoDeniku(radky, klic, 5000);
    if (v.ok) { res.status(204).end(); return; }
    console.error('[api/chyba] databáze odmítla:', v.stav, v.kod);
    // Deník v databázi ještě není (nebo mu chybí sloupec) → zkusit později.
    if (v.stav === 404 || /^(PGRST205|PGRST204|42P01|42703)$/.test(v.kod)) {
      res.status(503).json({ ok: false, chyba: 'neni_pripraveno' });
      return;
    }
    // Databáze řádek odmítla natrvalo (špatný tvar) → zahodit, jinak by ho
    // telefon posílal dokola. Klíč (401/403), přetížení (408/429) a 5xx → později.
    if (v.stav >= 400 && v.stav < 500 && ![401, 403, 408, 429].includes(v.stav)) {
      res.status(400).json({ ok: false, chyba: 'odmitnuto' });
      return;
    }
    res.status(502).json({ ok: false, chyba: 'nelze_ulozit' });
  } catch (e) {
    console.error('[api/chyba] neočekávaná chyba:', (e && e.name) || 'chyba');
    try { res.status(502).json({ ok: false, chyba: 'nelze_ulozit' }); } catch (x) { /* odpověď už odešla */ }
  }
};

module.exports.DRUHY = DRUHY;
