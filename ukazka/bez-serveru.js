// =====================================================================
// UKÁZKOVÁ VERZE — ukázka nesmí volat serverové funkce
//
// Ukázka běží na stejné doméně jako ostrá appka, takže `fetch('/api/…')`
// by trefilo SKUTEČNÝ endpoint. Kdyby si zájemce v ukázce klikl na
// „Odeslat fakturu", odešel by opravdový e-mail z ostrého systému.
//
// Proto tu odchytáváme každý požadavek na /api/ a odpovídáme sami.
// Ven z prohlížeče nejde nic — kromě překladače popisu práce, který
// je neškodný a používá ho i ostrá appka.
// =====================================================================

(function () {
  'use strict';
  const puvodniFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (vstup, nastaveni) {
    let adresa = '';
    try { adresa = typeof vstup === 'string' ? vstup : (vstup && vstup.url) || ''; } catch (e) {}

    const naNasServer = /^\/api\//.test(adresa) ||
      (adresa.startsWith(location.origin + '/api/'));

    if (naNasServer) {
      console.info('[ukázka] požadavek na server odchycen, ven nic nejde:', adresa);
      const telo = { ok: true, ukazka: true,
                     info: 'V ukázce se nic neodesílá — je to jen předvedení.' };
      return Promise.resolve(new Response(JSON.stringify(telo), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return puvodniFetch ? puvodniFetch(vstup, nastaveni)
                        : Promise.reject(new Error('fetch není k dispozici'));
  };
})();
