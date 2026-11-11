// SubBau PWA service worker
// Strategie: NETWORK-FIRST — vždy zkusí stáhnout aktuální verzi z internetu,
// a jen když není síť, sáhne do cache. Tím appka nikdy nedrží "starou verzi".
// Verzi zvyš při každém větším nasazení (nebo klidně datum).
// Číslo verze úložiště. Když se zvedne, prohlížeč při aktivaci SMAŽE všechno
// staré (viz 'activate' níže). Zvedněte ho pokaždé, když je podezření, že si
// někdo drží poškozenou kopii appky — je to jediný způsob, jak mu ji zahodit
// na dálku, aniž by sám mazal data v prohlížeči.
const CACHE = 'subbau-v230';
const LIMIT_SITE = 3500;   // ms — jak dlouho se při otevření appky čeká na síť, než se ukáže uložená verze

self.addEventListener('install', (event) => {
  // Nová verze se má aktivovat hned, nečekat na zavření všech karet
  self.skipWaiting();
  // Hlavní stránka a knihovna se uloží HNED do nové paměti (audit Codexem 6. 11. 2026):
  // dřív byla nová paměť při aktivaci prázdná a stará se smazala, takže telefon, který
  // se na slabém signálu neměl odkud dočíst, zůstal bez jediné funkční kopie appky.
  // Neuložení instalaci nezablokuje (bez sítě se nová verze jen nepřipraví).
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await Promise.all(['/', '/supabase.js'].map((u) => cache.add(u).catch(() => {})));
    } catch (e) { /* kopie se doplní při prvním načtení */ }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Smaž staré cache kromě aktuální — ale JEN když už nová má hlavní stránku i knihovnu.
    // Jinak se stará (jediná funkční) kopie nechá do příští aktualizace.
    const keys = await caches.keys();
    let novaMaStranku = false;
    try {
      const nova = await caches.open(CACHE);
      // Stránka I knihovna — jinak by se smazala jediná funkční kopie knihovny (Codex 6. 11. 2026).
      novaMaStranku = !!(await nova.match('/')) && !!(await nova.match('/supabase.js'));
    } catch (e) { /* stará zůstane */ }
    if (novaMaStranku) await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Umožni stránce vynutit převzetí nové verze
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  // Stránka se ozvala → podržené chyby (viz níž) jí můžou odejít.
  swVypustChyby();
});

// DENÍK CHYB (2. 11. 2026, majitel: „jakoukoliv chybu napříč aplikací to musí
// zaznamenat"). Chyba uvnitř service workeru (tenhle soubor) se jinak nikde
// neukáže — nemá stránku, konzoli nikdo nevidí a do databáze sám nepíše
// (neví, kdo je přihlášený). Pošle ji proto JEDNOMU otevřenému oknu appky jako
// zprávu {typ:'sw-chyba', druh, kde:'sw|<druh>', zprava, detail}; stránka
// (posluchač navigator.serviceWorker 'message') ji zapíše do deníku chyb.
// Druhy: js-chyba (chyba v kódu SW), js-neosetrena (neošetřený slib),
// ulozeni (kopie appky se neuložila do paměti telefonu — třeba plná paměť
// na iPhonu; offline pak běží stará verze).
// Bez otevřeného okna se chyba podrží v paměti (nejvýš 10, stejná se jen
// počítá) a odejde s první zprávou od stránky. Na tom, co se ukládá do
// mezipaměti a odkud se appka bere, se NIC nemění.
const SW_CHYBY = [];
function swSoubor(u, nahradni) {
  u = String(u || '').split('#')[0].split('?')[0];
  return (u.split('/').pop() || nahradni || 'sw.js').slice(0, 80);
}
function swChyba(druh, zprava, detail) {
  try {
    const kde = 'sw|' + druh;
    const text = String(zprava == null ? '' : zprava).slice(0, 500);
    const stejna = SW_CHYBY.find((x) => x.kde === kde && x.zprava === text);
    if (stejna) {
      stejna.detail.pocet = (stejna.detail.pocet || 1) + 1;
      stejna.detail.naposled = new Date().toISOString();
    } else {
      SW_CHYBY.push({ typ: 'sw-chyba', druh, kde, zprava: text,
        detail: Object.assign({ t: 'chyba', cache: CACHE, vznikla: new Date().toISOString() }, detail || {}) });
      if (SW_CHYBY.length > 10) SW_CHYBY.shift();
    }
    swVypustChyby();
  } catch (e) { /* hlášení chyby nesmí service worker shodit */ }
}
async function swVypustChyby() {
  try {
    if (!SW_CHYBY.length) return;
    const okna = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!okna.length) return;
    // Jen jednomu oknu — se dvěma záložkami by se jinak zapsala dvakrát.
    const okno = okna.find((o) => o.focused) || okna.find((o) => o.visibilityState === 'visible') || okna[0];
    for (const zprava of SW_CHYBY.splice(0)) okno.postMessage(zprava);
  } catch (e) { /* bez okna to zkusí příští zpráva */ }
}
// Z adresy ve stacku zůstane jen jméno souboru a :řádek:sloupec (i když adresa
// nese ?v=… — jinak by se řádek ztratil spolu s parametrem).
const swStack = (s) => (s ? String(s).replace(/(?:https?|file):\/\/[^\s)]+/g, (m) => {
  const rs = /(?::\d+){1,2}$/.exec(m);
  return swSoubor(rs ? m.slice(0, rs.index) : m) + (rs ? rs[0] : '');
}).slice(0, 1500) : undefined);
self.addEventListener('error', (ev) => {
  const e = ev && ev.error;
  swChyba('js-chyba', e && e.name ? e.name + ': ' + e.message : (ev && ev.message) || 'chyba',
    { soubor: swSoubor(ev && ev.filename), radek: (ev && ev.lineno) || 0, sloupec: (ev && ev.colno) || 0, stack: swStack(e && e.stack) });
});
self.addEventListener('unhandledrejection', (ev) => {
  const r = ev && ev.reason;
  swChyba('js-neosetrena', r && r.message !== undefined ? (r.name ? r.name + ': ' : '') + r.message : String(r),
    { stack: swStack(r && r.stack) });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Jen GET požadavky; POST/PUT (Supabase) necháme projít přímo na síť
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Požadavky na jiné domény (Supabase API, CDN, mapy…) neřešíme — přímo na síť
  if (url.origin !== self.location.origin) return;
  // Serverové funkce a stránka pro odběratele se NIKDY neukládají do paměti.
  // Kdyby se uložily, klient by po zneplatnění odkazu koukal na data dál
  // z prohlížeče a tlačítko „Deaktivovat" by nefungovalo, jak slibuje.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/klient')
      || url.pathname.startsWith('/ukazka')) return;

  event.respondWith((async () => {
    // Výkon (1. 10. 2026): síť má přednost dál, ale u otevření appky čeká nejvýš
    // LIMIT_SITE ms. Na slabém signálu dřív appka visela tak dlouho, dokud síť
    // neodpověděla nebo úplně nespadla (desítky vteřin), i když měla v paměti
    // celou poslední verzi. Když síť odpoví později, kopie se jen tiše obnoví.
    const ulozit = fetch(req).then((fresh) => {
      if (fresh && fresh.ok && fresh.status === 200 && fresh.type === 'basic') {
        const kopieOdpovedi = fresh.clone()
        // Ukládá se na pozadí (odpověď jde stránce hned). Stejná verze (stejný ETag)
        // už v paměti je → nepřepisovat 2,6 MB při každém otevření appky.
        event.waitUntil((async () => {
          try {
            const cache = await caches.open(CACHE)
            const stara = await cache.match(req)
            const et = fresh.headers.get('etag')
            if (!(stara && et && stara.headers.get('etag') === et)) await cache.put(req, kopieOdpovedi)
          } catch (e) {
            // Kopie se neuložila (nejčastěji plná paměť) — ukládání se nemění,
            // jen se to ohlásí do deníku chyb (sw|ulozeni).
            swChyba('ulozeni', ((e && e.name) || 'chyba') + ': ' + ((e && e.message) || ''), { soubor: swSoubor(req.url, 'stranka') })
          }
        })())
      }
      return fresh
    })
    // Knihovna /supabase.js se načítá blokujícím <script> ještě před spuštěním appky —
    // na slabém signálu visela bez limitu, i když ji telefon měl v paměti (Codex 6. 11. 2026).
    // Dostává stejný limit jako otevření appky.
    if (req.mode === 'navigate' || url.pathname === '/supabase.js') {
      const kopie = await caches.match(req)
      if (kopie) {
        const limit = new Promise(ok => setTimeout(() => ok(null), LIMIT_SITE))
        const vitez = await Promise.race([ulozit.catch(() => null), limit])
        if (vitez) return vitez
        event.waitUntil(ulozit.catch(() => {}))
        return kopie
      }
    }
    try {
      // NETWORK-FIRST: zkus síť
      const fresh = await ulozit;
      // Ukládáme JEN odpověď, o které víme, že je celá a v pořádku. Dřív se
      // ukládalo cokoli — i chybová stránka nebo odpověď přerušená cestou.
      // Taková kopie zůstala v prohlížeči a při každém dalším spuštění se z ní
      // servírovala rozdrolená appka: holý nadpis, žádné styly, žádná pole.
      // Nepomohlo ani zavření okna, protože to nedrží stránka, ale prohlížeč.
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
