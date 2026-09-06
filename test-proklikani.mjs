// Skutečné proklikání appky v prohlížeči. Používá ukázkovou verzi, protože
// ta běží bez serveru a s vymyšlenými daty — ale je to TÁŽ appka.
import puppeteer from 'puppeteer'
import path from 'path'
const SOUBOR = 'file://' + path.resolve('../nasazeni4/ukazka.html')
const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 900 })
const chybyKonzole = []
p.on('pageerror', e => chybyKonzole.push('pageerror: ' + e.message))
p.on('console', m => { if (m.type() === 'error') chybyKonzole.push('console: ' + m.text().slice(0, 160)) })

let chyb = 0
const ok = (b_, t) => { if (!b_) { chyb++; console.log('  ❌ ' + t) } else console.log('  ✅ ' + t) }

await p.goto(SOUBOR, { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const start = await p.evaluate(() => ({
  app: getComputedStyle(document.getElementById('app')).display,
  login: getComputedStyle(document.getElementById('login')).display,
  verze: typeof SUBBAU_VERZE !== 'undefined' ? SUBBAU_VERZE : null,
}))
ok(start.app === 'block' && start.login === 'none', 'appka naběhne rovnou dovnitř (bez přihlášení)')
ok(!!start.verze, 'verze je načtená: ' + (start.verze || '—'))

// ── ukázka vzhledů faktury ──
const vzhledy = await p.evaluate(async () => {
  const { data: lide } = await sb.from('profiles').select('*').in('role', ['osvec','partak']).limit(1)
  const kdo = (lide || [])[0]
  if (!kdo) return { chyba: 'nenašel jsem žádného pracovníka' }
  if (typeof openWorkerModal !== 'function') return { chyba: 'openWorkerModal chybí' }
  await openWorkerModal(kdo.id)
  await new Promise(r => setTimeout(r, 900))
  if (typeof ukazVzhledyPracovnika !== 'function') return { chyba: 'ukazVzhledyPracovnika chybí' }
  await ukazVzhledyPracovnika()
  await new Promise(r => setTimeout(r, 600))
  const stav = () => ({
    prekryv: document.getElementById('invoice-overlay').style.display,
    akce: document.getElementById('invoice-actions').style.display,
    lista: document.getElementById('invoice-design-bar').style.display,
    nadpis: document.getElementById('invoice-title').textContent,
    jmenoVzhledu: document.getElementById('invoice-design-name').textContent,
    barvicek: document.getElementById('invoice-design-colors').children.length,
    stranka: !!document.getElementById('invoice-page'),
    idx: (window._ukazkaVzhledu || {}).idx,
  })
  const prvni = stav()
  // prolistovat všech deset a u každého ověřit, že se list vykreslil
  const vysky = []
  for (let i = 1; i <= 10; i++) {
    ukazVzhled(i)
    const el = document.getElementById('invoice-page')
    vysky.push(el ? Math.round(el.getBoundingClientRect().height) : 0)
  }
  // přehodit barvu
  ukazBarvu(5)
  const poBarve = stav()
  const barvaVKodu = document.getElementById('invoice-content').innerHTML.includes(INVOICE_COLORS[5])
  closeInvoiceOverlay()
  const poZavreni = stav()
  return { prvni, vysky, poBarve, barvaVKodu, poZavreni }
})

if (vzhledy.chyba) { chyb++; console.log('  ❌ ' + vzhledy.chyba) }
else {
  ok(vzhledy.prvni.prekryv === 'block', 'náhled se otevře')
  ok(vzhledy.prvni.akce === 'none', 'odesílací lišta je v ukázce schovaná')
  ok(vzhledy.prvni.lista === 'block', 'přepínač vzhledů je vidět')
  ok(vzhledy.prvni.nadpis.includes('Ukázka'), 'nadpis říká, že jde o ukázku')
  ok(vzhledy.prvni.barvicek === 16, 'vzorník má šestnáct barev (' + vzhledy.prvni.barvicek + ')')
  ok(vzhledy.vysky.every(v => v > 900), 'všech deset vzhledů se vykreslilo (' + vzhledy.vysky.join(',') + ')')
  ok(vzhledy.barvaVKodu, 'přehození barvy se propíše do faktury')
  ok(vzhledy.poZavreni.akce === '' && vzhledy.poZavreni.lista === 'none',
     'po zavření je appka zpátky v normálu (odesílací lišta zpět)')
}

await b.close()
const vazne = chybyKonzole.filter(x => !/favicon|Failed to load resource/i.test(x))
if (vazne.length) { chyb++; console.log('  ❌ chyby v konzoli:'); vazne.slice(0,5).forEach(x => console.log('      ' + x)) }
else console.log('  ✅ v konzoli žádná chyba')
console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ PROKLIKÁNO, VŠECHNO FUNGUJE')
process.exit(chyb ? 1 : 0)
