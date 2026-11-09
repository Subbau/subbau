// =====================================================================
// UKÁZKOVÁ VERZE — pruh nahoře a přepínač rolí
//
// Zájemce si přepne mezi pohledem šéfa a pohledem pracovníka na mobilu.
// Ten druhý obvykle rozhoduje: šéf chce vidět, jestli to jeho lidi zvládnou.
// =====================================================================

(function () {
  'use strict';
  function start() {
    const U = window.__demoUcty;
    if (!U || !window.__demoPrihlas) return;

    // Přihlášení se stalo už při startu (prihlas-hned.js) — tady jen
    // zjistíme, který pohled je zapnutý, ať se označí správné tlačítko.
    let role = 'sef';
    try { role = localStorage.getItem('demo-role') || 'sef' } catch (e) {}

    // Přepínač pohledů (majitel 9. 11. 2026): spodní černý pruh s nápisem „UKÁZKA — Vymyšlená data“ je pryč,
    // tlačítka jsou na Dashboardu (pohled vedení). V pohledu pracovníka žádný dashboard není, tam je malé
    // tlačítko vpravo nahoře, ať se jde vrátit.
    const TLACITKA =
      '<button id="demo-sef">Pohled vedení</button>' +
      '<button id="demo-prac">Pohled pracovníka</button>' +
      '<button id="demo-reset" title="Vrátit ukázku do původního stavu">Začít znovu</button>';
    const styl = document.createElement('style');
    styl.textContent =
      '#demo-prepinac{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}' +
      '#demo-prepinac button,#demo-zpet{font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 13px;' +
      'border-radius:9px;border:1px solid #d9d2c8;background:#fff;color:#211D1A;cursor:pointer}' +
      '#demo-prepinac button.aktivni{background:#E8A13A;color:#211D1A;border-color:#E8A13A}' +
      '#demo-zpet{position:fixed;top:8px;right:8px;z-index:99999;background:#211D1A;color:#fff;border-color:#4a443e;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.3)}' +
      '@media print{#demo-prepinac,#demo-zpet{display:none}}';
    document.head.appendChild(styl);
    function vlozPrepinac() {
      const dash = document.getElementById('v-dashboard');
      if (!dash || document.getElementById('demo-prepinac')) return;
      const blok = document.createElement('div');
      blok.id = 'demo-prepinac';
      blok.innerHTML = TLACITKA;
      dash.insertBefore(blok, dash.firstChild);
      pripoj();
    }
    function oznac() {
      const sef = document.getElementById('demo-sef'), prac = document.getElementById('demo-prac');
      if (sef) sef.classList.toggle('aktivni', role === 'sef');
      if (prac) prac.classList.toggle('aktivni', role === 'pracovnik');
    }
    function prepni(nova) {
      if (nova === role) return;
      try { localStorage.setItem('demo-role', nova) } catch (e) {}
      // Načteme stránku znovu. Appka se startuje jednou při otevření
      // a přepnout roli za běhu by znamenalo sáhnout jí do útrob —
      // to je přesně ta cesta, kterou se rozbíjí ostrá verze.
      location.reload();
    }
    function pripoj() {
      const sef = document.getElementById('demo-sef'), prac = document.getElementById('demo-prac'), reset = document.getElementById('demo-reset');
      if (sef) sef.onclick = () => prepni('sef');
      if (prac) prac.onclick = () => prepni('pracovnik');
      if (reset) reset.onclick = () => {
        try { localStorage.removeItem('demo-role') } catch (e) {}
        location.reload();
      };
      oznac();
    }
    if (role === 'pracovnik') {
      const zpet = document.createElement('button');
      zpet.id = 'demo-zpet';
      zpet.textContent = 'Pohled vedení';
      zpet.onclick = () => prepni('sef');
      document.body.appendChild(zpet);
    } else {
      // Dashboard se do stránky vykreslí až po přihlášení — vložit, jakmile existuje, a hlídat, kdyby ho appka přepsala.
      vlozPrepinac();
      setInterval(vlozPrepinac, 1000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
