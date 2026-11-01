// =====================================================================
// PŘEKLAD POPISU PRÁCE PŘES NÁŠ SERVER (4. 10. 2026)
//
// Kancelář hlásila, že výkazy hodin nejsou přeložené. Appka se ptala Google
// překladače (a záložní MyMemory) PŘÍMO Z PROHLÍŽEČE — a z adresy kanceláře
// už nedostávala odpověď: stará verze posílala desítky dotazů najednou, Google
// takovou adresu na čas blokuje a MyMemory jí vyčerpala denní limit. Odsud
// (jiná adresa) se tytéž popisy přeložily za 3 s.
//
// Proto se appka i odkaz pro odběratele ptají nejdřív TADY a server se ptá
// služby za ně. Odpověď si pamatuje CDN Vercelu (s-maxage), takže tentýž
// popis se Googlu posílá jednou, ne při každém výkazu.
//
// ŽÁDNÝ OTEVŘENÝ PROXY: jen dvě služby a jen jejich překladové adresy,
// jen z naší domény. Ukládá se jen platný překlad — varovná věta MyMemory
// („MYMEMORY WARNING…", „PLEASE SELECT…") nebo chyba se nepamatuje.
// =====================================================================
const POVOLENE = [
  'https://translate.googleapis.com/translate_a/single?',
  'https://api.mymemory.translated.net/get?',
];

// Brzda proti zneužití jako volný neomezený relay (audit 16. 10. 2026):
// endpoint neměl žádné omezení počtu volání, na rozdíl od sesterských API
// funkcí (admin-update-worker, send-invoice), co ho už dávno mají. Stejný
// vzor, jen zkopírovaný sem.
//
// LIMIT 1500 DOTAZŮ ZA 10 MIN Z JEDNÉ ADRESY (1. 11. 2026). Původních 60
// nestačilo ani na jeden výkaz — majitel: „u některých dní … to není ve
// 3 jazycích, někdy je to jen česky, někdy německy". Appka na jeden NOVÝ
// popis volá běžně 2–3× (rozpoznání jazyka + každý další jazyk), nejhůř 9×
// (popis bez háčků od cizince: Google „auto", ověření z češtiny a z jeho
// jazyka, pak dva další jazyky — každé se zálohou MyMemory). Výkaz party za
// týden (15 lidí × 7 dní, každý popis jiný = 105 popisů) je běžně ~300,
// nejhůř 945 dotazů. Celá kancelář chodí z jedné adresy, takže 1500 = jeden
// nejhorší výkaz a rezerva na další. Opakované popisy vrací CDN z paměti
// a do limitu se nepočítají. Proti relay brzdí dál (v průměru 2,5 dotazu/s).
const LIMIT_DOTAZU = 1500;
const HITS = new Map();
// 0 = pustit; jinak za kolik sekund se uvolní místo (nejstarší dotaz vypadne
// z okna) — posílá se jako Retry-After.
function rateLimited(key, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const fresh = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    HITS.set(key, fresh);
    return Math.max(1, Math.ceil((fresh[0] + windowMs - now) / 1000));
  }
  fresh.push(now);
  HITS.set(key, fresh);
  if (HITS.size > 5000) HITS.clear();
  return 0;
}
const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
const NENI_PREKLAD = /MYMEMORY WARNING|QUERY LENGTH LIMIT|TRANSLATED\.NET|PLEASE SELECT|DISTINCT LANGUAGES|IS AN INVALID|INVALID (SOURCE|TARGET) LANGUAGE|NO QUERY SPECIFIED|LIMIT EXCEEDED/i;

// Je odpověď služby platný překlad, který smí CDN držet?
function lzePamatovat(url, telo) {
  try {
    const d = JSON.parse(telo);
    if (url.startsWith(POVOLENE[0])) return Array.isArray(d) && Array.isArray(d[0]);
    const t = String((d && d.responseData && d.responseData.translatedText) || '');
    return Number(d && d.responseStatus) === 200 && d.quotaFinished !== true && !!t && !NENI_PREKLAD.test(t);
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  const zaSekund = rateLimited(`preklad:${clientIp(req)}`, LIMIT_DOTAZU);
  if (zaSekund) {
    // Retry-After posílá JEN tenhle limit (odpovědi služeb jdou dál bez
    // hlaviček): appka podle něj pozná náš limit a nezkouší služby napřímo
    // — z kanceláře neodpovídají (1. 11. 2026).
    res.setHeader('Retry-After', String(zaSekund));
    res.status(429).json({ chyba: 'příliš mnoho požadavků' });
    return;
  }
  const url = String((req.query && req.query.u) || '');
  if (!POVOLENE.some((p) => url.startsWith(p)) || url.length > 8000) {
    res.status(400).json({ chyba: 'nepovolená adresa' });
    return;
  }
  // Jen z naší stránky (appka, odkaz pro odběratele i ukázka jsou na téže
  // doméně). Bez Origin/Referer (soukromé nastavení prohlížeče) se pouští.
  const host = String(req.headers.host || '');
  const odkud = String(req.headers.origin || req.headers.referer || '');
  if (odkud && host) {
    let odkudHost = '';
    try { odkudHost = new URL(odkud).host; } catch (e) {}
    if (odkudHost !== host) { res.status(403).json({ chyba: 'cizí stránka' }); return; }
  }
  const ac = new AbortController();
  const casovac = setTimeout(() => ac.abort(), 8000);
  try {
    const odp = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (SubBau dochazka)' } });
    const telo = await odp.text();
    const pamatovat = odp.ok && lzePamatovat(url, telo);
    res.setHeader('Cache-Control', pamatovat ? 'public, s-maxage=2592000, stale-while-revalidate=86400' : 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(odp.status).send(telo);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ chyba: String((e && e.message) || e) });
  } finally {
    clearTimeout(casovac);
  }
};
