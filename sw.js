// SubBau service worker
// Network-first strategie: vždy se snaží o čerstvá data ze sítě.
// Hlavní stránku (shell) si ukládá do cache jako záložku pro případ
// výpadku sítě — to Android (Chrome) vyžaduje, aby nabídl instalaci PWA.

const CACHE = 'subbau-v2'
const OFFLINE_URLS = ['/', '/index.html', '/manifest.json']

// Při instalaci ulož hlavní stránku do cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(OFFLINE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

// Po aktivaci ukliď staré cache a převezmi kontrolu
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Network-first: zkus síť, při neúspěchu vrať z cache (jen pro navigaci/HTML)
self.addEventListener('fetch', event => {
  const req = event.request

  // Jen GET požadavky řešíme; ostatní (POST do databáze atd.) necháme být
  if (req.method !== 'GET') return

  // Požadavky na jiné domény (Supabase, CDN) neřešíme — jdou rovnou na síť
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Navigace (otevření stránky): network-first s offline záložkou
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone()
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {})
          return resp
        })
        .catch(() => caches.match(req).then(r => r || caches.match('/')))
    )
    return
  }

  // Ostatní GET (vlastní statické soubory): zkus síť, fallback cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  )
})
