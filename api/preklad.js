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
