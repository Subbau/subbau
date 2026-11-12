// =====================================================================
// DENÍK CHYB NA SERVERU — společné čištění a zápis (2. 11. 2026)
//
// PROČ: majitel 2. 11. 2026 — „v tom deníku to musí hlídat úplně všechno …
// jakoukoliv chybu napříč aplikací to musí zaznamenat, abychom to dokázali
// spravovat". Serverové funkce (api/*.js) běží mimo telefon. Když spadne
// zápis z odkazu pro odběratele, odeslání faktury e-mailem nebo ranní
// hlídač dokladů (cron — ten nikdo nesleduje, jeho výstup končí jen v logu
// Vercelu), appka o tom neví a v deníku chyb by nebylo nic.
//
// CO TU JE:
//   • zapisChybuServeru(funkce, zprava, detail) — zapíše chybu serverovým
//     klíčem do chyby_appky: kdo prázdné, kde = server|<funkce>. Volá se
//     jen ve větvích catch a 5xx, NE u očekávaných odpovědí 4xx (špatný
//     tvar dat, cizí pracovník…) a ne u limitů překladů.
//   • čištění, které používá i /api/chyba (zápis z telefonu bez přihlášení):
//     obojí musí čistit stejně — e-mail, odkaz, klíč, uuid, IBAN, rodné
//     číslo, telefon a dlouhé číslo pryč; z podrobností projdou jen povolené
//     klíče se správným tvarem.
//
// Podtržítko na začátku jména = Vercel z toho nedělá adresu (/api/_denik
// neexistuje); funkce si soubor jen načtou přes require.
//
// NIKDY NEHÁZÍ a odpověď funkce zdrží nejvýš o 2,5 s (zápis se čeká, protože
// Vercel funkci po odeslání odpovědi může zmrazit a nedokončený zápis by se
// ztratil). Paměť brzdy žije jen v jedné instanci funkce; skutečný strop drží
// databáze (supabase-migrace-chyby-appky-strop.sql: serverové zápisy mají
// vlastní rozpočet 300 za hodinu, ať je spam přes /api/chyba nevytlačí).
// CommonJS (module.exports) — repozitář nemá "type":"module".
// =====================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ceefzlkjnrclfpmhgdmr.supabase.co';

// Tvar místa: druh (malá písmena, číslice, pomlčka) a nepovinně |cíl (jméno
// tabulky, koše, funkce, hostu, sekce, souboru — nikdy hodnota).
const TVAR_KDE = /^([a-z0-9-]{2,40})(\|[A-Za-z0-9_.\/:-]{1,60})?$/;

// ── zkracování ───────────────────────────────────────────────────────
// Jediné místo, kde se text zkracuje. Nerozřízne dvojici surrogate (emoji
// na hranici 500 znaků), zahodí osamělé půlky i znak \u0000 — Postgres
// takový text v jsonb odmítne (22P05) a celá dávka by spadla.
function rez(text, n) {
  const s = String(text == null ? '' : text);
  let ven = '';
  for (let i = 0; i < s.length && ven.length < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        if (ven.length + 2 > n) break;
        ven += s[i] + s[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    ven += s[i];
  }
  return ven;
}

// ── čištění volného textu ────────────────────────────────────────────
// Pořadí je důležité: nejdřív adresy (nesou e-maily a klíče v parametrech),
// pak e-mail, klíče, uuid, čísla účtů a nakonec každé dlouhé číslo.
function cisti(text, n) {
  const s = String(text == null ? '' : text).slice(0, 4000)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\b(?:https?|ftp|file|blob|data|mailto):[^\s"'<>)]*/gi, '_adresa_')
    .replace(/[^\s@<>()"',;:/]{1,64}@[^\s@<>()"',;:/]{1,255}\.[A-Za-z]{2,}/g, '_email_')
    .replace(/\beyJ[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*){1,2}/g, '_klic_')
    .replace(/\b(Bearer|apikey)\s*[:=]?\s*\S+/gi, '$1 _klic_')
    // Relativní adresa s tajným parametrem (odkaz pro odběratele ?t=…, ?sign=…).
    .replace(/([?&](?:t|token|access_token|refresh_token|sign|code|key|apikey|secret)=)[^&#\s"'<>)]*/gi, '$1_klic_')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '_id_')
    // Dlouhý náhodný řetězec s písmeny i číslicemi (token odkazu, klíč).
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}/g, '_klic_')
    .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gi, '_cislo_')
    .replace(/\b\d{6}\s*\/\s*\d{3,4}\b/g, '_cislo_')
    .replace(/\b\d{2,6}-\d{2,10}\/\d{4}\b/g, '_cislo_')
    .replace(/\+\d{1,3}[\s-]?\d{2,4}(?:[\s-]?\d{2,4}){2,4}/g, '_cislo_')
    .replace(/\b\d{3}[ -]\d{3}[ -]\d{3}\b/g, '_cislo_')
    .replace(/\d{6,}/g, '_cislo_');
  return rez(s, n);
}

// ── povolené podrobnosti ─────────────────────────────────────────────
// Klíč → kontrola tvaru (vrací hodnotu, nebo undefined = zahodit).
// Hodnoty, které nejsou volný text (stav, kód, jméno souboru…), se nečistí,
// jen se ověří tvar — jinak by čistič rozbil i to, co nic tajného nenese.
const RET = (n, vzor) => (v) => (typeof v === 'string' && v.length <= n && (!vzor || vzor.test(v)) ? v : undefined);
const CELE = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
// Číslo z měření (ms, s) se zaokrouhlí a ořízne; nesmysl (NaN, text) se zahodí.
const CISLO = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined);
const ANO_NE = (v) => (typeof v === 'boolean' ? v : undefined);
const CAS = (v) => (typeof v === 'string' && v.length <= 30 && !Number.isNaN(Date.parse(v)) ? v : undefined);
const TEXT = (n) => (v) => (typeof v === 'string' ? cisti(v, n) : undefined);
const KOD = RET(60, /^[\w.:-]+$/);
const STAV = CELE(0, 999);
// Kolikrát se to stalo — počet nad strop se ořízne, ne zahodí (zacyklení
// v telefonu je přesně to, co má deník ukázat).
const POCET = (v) => (Number.isInteger(v) && v >= 1 ? Math.min(v, 1000000) : undefined);
// Pohlcené automatické řádky (souvisi): jen místo, stav a kód, nejvýš 5.
const SOUVISI = (v) => {
  if (!Array.isArray(v)) return undefined;
  const ven = [];
  for (const x of v.slice(0, 5)) {
    if (!x || typeof x !== 'object') continue;
    const kde = String(x.kde || '');
    if (!TVAR_KDE.test(kde)) continue;
    const o = { kde };
    if (STAV(x.stav) !== undefined) o.stav = x.stav;
    if (KOD(x.kod) !== undefined) o.kod = x.kod;
    ven.push(o);
  }
  return ven.length ? ven : undefined;
};
// Původní chyba (surova) — z ní projde jen kód a stav, nikdy text.
const SUROVA = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {};
  if (KOD(v.kod) !== undefined) o.kod = v.kod;
  if (STAV(v.stav) !== undefined) o.stav = v.stav;
  return Object.keys(o).length ? o : undefined;
};
// Počty podržených řádků podle druhu (relace-nefunguje): druh → počet, nejvýš 20.
const POCTY = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {};
  for (const [k, n] of Object.entries(v).slice(0, 20)) {
    if (TVAR_KDE.test(k) && Number.isInteger(n) && n >= 0) o[k] = Math.min(n, 1000000);
  }
  return Object.keys(o).length ? o : undefined;
};
// Poslední klik (akce): jen jméno funkce z onclick a id prvku.
const AKCE = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {};
  if (RET(60, /^[\w$.]+$/)(v.fce) !== undefined) o.fce = v.fce;
  if (RET(60, /^[\w-]+$/)(v.id) !== undefined) o.id = v.id;
  if (CISLO(0, 600000)(v.msPred) !== undefined) o.msPred = CISLO(0, 600000)(v.msPred);
  return Object.keys(o).length ? o : undefined;
};

const POVOLENE = {
  v: CELE(1, 9), t: RET(10, /^(chyba|varovani|udalost)$/),
  verze: RET(40, /^[\w .:-]*$/), sekce: RET(60, /^[\w.\/:-]*$/), role: RET(20, /^[\w-]*$/),
  zar: RET(40, /^[\p{L}\p{N} .·()_-]*$/u), ua: TEXT(300),
  zPlochy: ANO_NE, online: ANO_NE, vid: RET(10, /^(visible|hidden|prerender)$/),
  vznikla: CAS, poprve: CAS, naposled: CAS, msOdStartu: CISLO(0, 1e9), pocet: POCET,
  zalozka: RET(5, /^[a-z0-9]+$/), zarId: RET(12, /^[a-z0-9]{6,12}$/), _id: RET(16, /^[A-Za-z0-9]{4,16}$/),
  soubor: RET(80, /^[\w.@-]+$/), radek: CELE(0, 1e7), sloupec: CELE(0, 1e7), stack: TEXT(1500),
  kod: KOD, stav: STAV, metoda: RET(7, /^[A-Z]+$/),
  // Zkrácený e-mail jen s opravdovou doménou (tečka + koncovka z písmen) —
  // „Hes…@2024" je heslo napsané do pole e-mail, ne adresa (2. 11. 2026).
  email: RET(70, /^[^@\s]{1,3}…@(?:[a-z0-9-]{1,63}\.){1,5}[a-z]{2,24}$/i), ucet: RET(36, /^[0-9a-f-]{36}$/i),
  trida: RET(20, /^[a-z-]+$/), duvod: RET(40, /^[\w-]+$/), typ: RET(20, /^[\w-]+$/),
  error_code: KOD, pokusu: CELE(0, 100000), minut: CELE(0, 1000000),
  skriptDobehl: ANO_NE, jadro: ANO_NE, knihovna: ANO_NE, rane: ANO_NE, pred: ANO_NE,
  souhrn: ANO_NE, odeslanoPozdeji: ANO_NE,
  cizichSkriptu: CELE(0, 1e6), obrazku: CELE(0, 1e6),
  dialog: RET(40, /^[\w-]+$/), poNavratuS: CISLO(0, 1e7), ms: CISLO(0, 1e9),
  hlaska: TEXT(300), souvisi: SOUVISI, surova: SUROVA, pocty: POCTY, akce: AKCE,
  // Jen serverové zápisy (zapisChybuServeru): který krok funkce selhal a kolik čeho.
  krok: RET(40, /^[\w-]+$/), sluzba: RET(20, /^[\w-]+$/),
  problemu: CELE(0, 1e6), chyb: CELE(0, 1e6), neodeslano: CELE(0, 1e6),
};

function cistyDetail(d) {
  const ven = {};
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    for (const [k, v] of Object.entries(d).slice(0, 60)) {
      if (!Object.prototype.hasOwnProperty.call(POVOLENE, k)) continue;
      const c = POVOLENE[k](v);
      if (c !== undefined) ven[k] = c;
    }
  }
  return ven;
}

// ── brzda v paměti instance ──────────────────────────────────────────
const HITS = new Map();
// 0 = pustit; jinak za kolik sekund se uvolní místo (pro Retry-After).
function zaKolikSekund(klic, max, oknoMs = 10 * 60 * 1000) {
  const ted = Date.now();
  const cerstve = (HITS.get(klic) || []).filter((t) => ted - t < oknoMs);
  if (cerstve.length >= max) {
    HITS.set(klic, cerstve);
    return Math.max(1, Math.ceil((cerstve[0] + oknoMs - ted) / 1000));
  }
  cerstve.push(ted);
  HITS.set(klic, cerstve);
  if (HITS.size > 5000) HITS.clear();
  return 0;
}

// ── zápis do databáze ────────────────────────────────────────────────
// Vrací { ok, stav, kod } — nikdy nehází. Tělo odpovědi se nečte dál než
// na kód: u porušeného pravidla obsahuje celý řádek.
async function vlozDoDeniku(radky, klic, limitMs) {
  const ac = new AbortController();
  const casovac = setTimeout(() => ac.abort(), limitMs || 5000);
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/chyby_appky', {
      method: 'POST',
      headers: { apikey: klic, Authorization: 'Bearer ' + klic, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(radky),
      signal: ac.signal,
    });
    if (r.ok) return { ok: true, stav: r.status, kod: '' };
    let kod = '';
    try { kod = kodZTela(await r.text()); } catch (e) { kod = ''; }
    return { ok: false, stav: r.status, kod };
  } catch (e) {
    return { ok: false, stav: 0, kod: String((e && e.name) || 'chyba').slice(0, 40) };
  } finally {
    clearTimeout(casovac);
  }
}

// Z těla chybové odpovědi (Supabase, Brevo) jen kód — nikdy zpráva ani
// podrobnosti, ty nesou data (jméno, e-mail, celý řádek).
// Přednost má slovní kód: Supabase Auth posílá code: 422 (jen číslo stavu)
// a skutečný důvod v error_code (email_exists); PostgREST má code PGRST…/42501.
function kodZTela(text) {
  try {
    const j = JSON.parse(String(text || ''));
    if (!j || typeof j !== 'object') return '';
    const kandidati = ['error_code', 'code', 'error', 'statusCode'].map((k) => (j[k] != null ? String(j[k]) : ''))
      .filter((v) => /^[\w.:-]{1,40}$/.test(v));
    return kandidati.find((v) => !/^\d+$/.test(v)) || kandidati[0] || '';
  } catch (e) { /* tělo není JSON — kód není */ }
  return '';
}

// Kód z výjimky: z chyby Supabase („Supabase 500: {…}"), z vlastní chyby
// s e.kod / e.stav, jinak jméno (AbortError, TypeError).
function kodVyjimky(e) {
  if (!e) return '';
  if (e.kod && /^[\w.:-]{1,40}$/.test(String(e.kod))) return String(e.kod);
  const m = /\{[\s\S]*\}/.exec(String(e.message || ''));
  const zTela = m ? kodZTela(m[0]) : '';
  if (zTela) return zTela;
  return String(e.name || 'Error').replace(/[^\w.:-]/g, '').slice(0, 40);
}
function stavVyjimky(e) {
  if (!e) return undefined;
  if (Number.isInteger(e.stav)) return e.stav;
  const m = /\b(?:Supabase|db|Brevo|podpis) (\d{3})\b/.exec(String(e.message || ''));
  return m ? Number(m[1]) : undefined;
}

// Opakovaná stejná chyba se do minuty jen počítá a přičte se k dalšímu zápisu.
const POSLEDNI = new Map();

async function zapisChybuServeru(funkce, zprava, detail) {
  try {
    const klic = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!klic) return false;
    const f = String(funkce || '').replace(/[^A-Za-z0-9_.\/:-]/g, '').slice(0, 60) || 'neznama';
    const kde = 'server|' + f;
    const veta = cisti(zprava, 500);
    const klicSlouceni = kde + '|' + veta.replace(/\d/g, '#').slice(0, 100);
    const ted = Date.now();
    const minule = POSLEDNI.get(klicSlouceni);
    if (minule && ted - minule.kdy < 60000) { minule.navic++; return false; }
    if (zaKolikSekund('server:' + f, 20)) return false;
    const navic = minule ? minule.navic : 0;
    const zaznam = { kdy: ted, navic: 0 };
    POSLEDNI.set(klicSlouceni, zaznam);
    if (POSLEDNI.size > 500) POSLEDNI.clear();
    const d = cistyDetail(detail);
    d.v = 1;
    d.t = detail && detail.t === 'varovani' ? 'varovani' : 'chyba';
    d.zdroj = 'server';
    d.sekce = 'server';
    d.funkce = f;
    d.vznikla = new Date(ted).toISOString();
    if (navic > 0) d.pocet = Math.min((d.pocet || 1) + navic, 1000000);
    const commit = String(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7);
    if (/^[0-9a-f]{7}$/.test(commit)) d.verze = 'server ' + commit;
    const v = await vlozDoDeniku([{ kdo: null, kdo_jmeno: null, kde, zprava: veta, detail: d }], klic, 2500);
    if (!v.ok) {
      console.error('[deník chyb] serverový zápis se nepovedl:', v.stav, v.kod);
      // Neúspěšný zápis nesmí potlačit další pokus: značka se vrátí a čekající počet zůstane.
      zaznam.kdy = 0;
      zaznam.navic += navic;
    }
    return v.ok;
  } catch (e) {
    return false;
  }
}

// Strop počtu výskytů u zápisu bez přihlášení. Počet tvrdí telefon (nebo kdokoli
// s vlastní hlavičkou Origin) a nic ho neověří. Prohlížeč deníku řadí skupiny
// podle součtu výskytů — šest požadavků s pocet 1 000 000 by jinak vytlačilo
// skutečné chyby přihlášených lidí za „Ukázat všech" (2. 11. 2026, oponentura).
// 50 pořád řekne „hodně"; skutečné zacyklení před přihlášením to neschová.
const POCET_BEZ_PRIHLASENI = 50;

// Záznam z telefonu bez přihlášení (/api/chyba) → řádek pro databázi,
// nebo null, když druh není na seznamu nebo místo nemá správný tvar.
function cistyZaznamBezPrihlaseni(z, druhy) {
  if (!z || typeof z !== 'object' || Array.isArray(z)) return null;
  const kde = String(z.kde || '');
  const m = TVAR_KDE.exec(kde);
  if (!m || !druhy.has(m[1])) return null;
  const d = cistyDetail(z.detail);
  if (d.pocet !== undefined) d.pocet = Math.min(d.pocet, POCET_BEZ_PRIHLASENI);
  // _id řádku (slučování dvojího odeslání v prohlížeči deníku) smí ležet
  // u záznamu i v podrobnostech.
  if (d._id === undefined && POVOLENE._id(z._id) !== undefined) d._id = z._id;
  d.anon = true;
  d.zdroj = 'api/chyba';
  return { kdo: null, kdo_jmeno: null, kde, zprava: cisti(z.zprava, 500), detail: d };
}

module.exports = {
  TVAR_KDE, rez, cisti, cistyDetail, cistyZaznamBezPrihlaseni, zaKolikSekund,
  vlozDoDeniku, kodZTela, kodVyjimky, stavVyjimky, zapisChybuServeru,
};
