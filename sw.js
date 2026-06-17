// SubBau service worker — minimální, jen aby šla aplikace nainstalovat na plochu.
// Záměrně NEcachuje aplikaci offline: appka potřebuje živá data z databáze,
// takže vždy jdeme na síť. Tím se vyhneme zobrazení zastaralých dat.

const VERSION = 'subbau-v1'

self.addEventListener('install', event => {
  // Aktivuj nový SW hned, ať se uživatelům nezasekne stará verze
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  // Převezmi kontrolu nad otevřenými kartami
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', event => {
  // Vždy ze sítě (network-first, bez offline cache).
  // Když síť selže, prohlížeč ukáže svou standardní chybu — to je OK,
  // appka stejně bez internetu nefunguje (potřebuje databázi).
  return
})
