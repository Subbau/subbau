// SubBau PWA service worker
// Strategie: NETWORK-FIRST — vždy zkusí stáhnout aktuální verzi z internetu,
// a jen když není síť, sáhne do cache. Tím appka nikdy nedrží "starou verzi".
// Verzi zvyš při každém větším nasazení (nebo klidně datum).
const CACHE = 'subbau-v38';

self.addEventListener('install', (event) => {
  // Nová verze se má aktivovat hned, nečekat na zavření všech karet
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Smaž všechny staré cache kromě aktuální
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Umožni stránce vynutit převzetí nové verze
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Jen GET požadavky; POST/PUT (Supabase) necháme projít přímo na síť
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Požadavky na jiné domény (Supabase API, CDN, mapy…) neřešíme — přímo na síť
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // NETWORK-FIRST: zkus síť
      const fresh = await fetch(req);
      // Ulož kopii do cache pro offline
      try {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      } catch (e) {}
      return fresh;
    } catch (e) {
      // Offline → zkus cache
      const cached = await caches.match(req);
      if (cached) return cached;
      // Pro navigaci (otevření appky) offline vrať aspoň hlavní stránku z cache
      if (req.mode === 'navigate') {
        const fallback = await caches.match('/');
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
