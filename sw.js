// SubBau service worker
// Network-first: vždy se snaží o čerstvá data ze sítě.
// Cachuje hlavní stránku jako offline záložku — to Chrome vyžaduje pro instalaci PWA.

const CACHE = 'subbau-v3'

// Při instalaci ulož hlavní stránku. Každou URL zvlášť, ať jedna chyba nezhodí instalaci.
self.addEventListener('install', event => {
  self.skipWaiting()  // aktivuj hned, ať je SW připravený pro instalaci
  event.waitUntil(
    caches.open(CACHE).then(async cache => {
      try { await cache.add('/') } catch (e) {}
      try { await cache.add('/manifest.json') } catch (e) {}
    })
  )
})

// Po aktivaci převezmi kontrolu nad stránkou hned
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // ukliď staré cache
      const keys = await caches.keys()
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      // převezmi kontrolu nad otevřenými kartami
      await self.clients.claim()
    })()
  )
})

// Network-first pro navigaci, s offline záložkou
self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return  // cizí domény (Supabase, CDN) neřešíme

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone()
          caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {})
          return resp
        })
        .catch(() => caches.match('/').then(r => r || Response.error()))
    )
    return
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  )
})
