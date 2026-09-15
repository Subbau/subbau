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

    const pruh = document.createElement('div');
    pruh.id = 'demo-pruh';
    pruh.innerHTML =
      '<span class="demo-stitek">UKÁZKA</span>' +
      '<span class="demo-text">Vymyšlená data · nic se neukládá</span>' +
      '<span class="demo-mezera"></span>' +
      '<button id="demo-sef">Pohled vedení</button>' +
      '<button id="demo-prac">Pohled pracovníka</button>' +
      '<button id="demo-reset" title="Vrátit ukázku do původního stavu">Začít znovu</button>';
    document.body.appendChild(pruh);

    const styl = document.createElement('style');
    styl.textContent =
      '#demo-pruh{position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#211D1A;color:#fff;' +
      'display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:13px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
      'box-shadow:0 -2px 14px rgba(0,0,0,.3);flex-wrap:wrap}' +
      '#demo-pruh .demo-stitek{background:#E8A13A;color:#211D1A;font-weight:800;padding:2px 9px;' +
      'border-radius:6px;font-size:11px;letter-spacing:.5px}' +
      '#demo-pruh .demo-text{color:#cfc7bd;font-size:12px}' +
      '#demo-pruh .demo-mezera{flex:1}' +
      '#demo-pruh button{font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 13px;' +
      'border-radius:9px;border:1px solid #4a443e;background:#2c2722;color:#fff;cursor:pointer}' +
      '#demo-pruh button.aktivni{background:#E8A13A;color:#211D1A;border-color:#E8A13A}' +
      'body{padding-bottom:56px!important}' +
      '@media print{#demo-pruh{display:none}body{padding-bottom:0!important}}';
    document.head.appendChild(styl);

    function oznac() {
      document.getElementById('demo-sef').classList.toggle('aktivni', role === 'sef');
      document.getElementById('demo-prac').classList.toggle('aktivni', role === 'pracovnik');
    }
    function prepni(nova) {
      if (nova === role) return;
      try { localStorage.setItem('demo-role', nova) } catch (e) {}
      // Načteme stránku znovu. Appka se startuje jednou při otevření
      // a přepnout roli za běhu by znamenalo sáhnout jí do útrob —
      // to je přesně ta cesta, kterou se rozbíjí ostrá verze.
      location.reload();
    }
    document.getElementById('demo-sef').onclick = () => prepni('sef');
    document.getElementById('demo-prac').onclick = () => prepni('pracovnik');
    document.getElementById('demo-reset').onclick = () => {
      try { localStorage.removeItem('demo-role') } catch (e) {}
      location.reload();
    };
    oznac();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
