// =====================================================================
// UKÁZKOVÁ VERZE — bez pípání a vibrací
//
// Majitel 5. 10. 2026: při předvádění to nemá pípat. Vkládá se JEN do
// ukázky (až za appku, aby přepsalo její funkce); ostrá appka pípá dál.
// =====================================================================

(function () {
  'use strict';
  window.playAdminBeep = function () {};
  window.pipniPracovnikovi = function () {};
  try { navigator.vibrate = function () { return false } } catch (e) {}
})();
