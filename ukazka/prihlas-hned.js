// =====================================================================
// UKÁZKOVÁ VERZE — přihlášení hned při startu
//
// Musí se to stát TEĎ, ne až se načte stránka. Appka se totiž při startu
// zeptá `sb.auth.getSession()`, a když nikoho nenajde, ukáže přihlašovací
// obrazovku. Návštěvník ukázky žádné heslo nemá a nemá ho odkud vzít.
// =====================================================================

(function () {
  'use strict';
  const U = window.__demoUcty;
  if (!U || !window.__demoPrihlas) return;
  let role = 'sef';
  try { role = localStorage.getItem('demo-role') || 'sef' } catch (e) {}
  window.__demoPrihlas(role === 'pracovnik' ? U.pracovnik : U.sef);
})();
