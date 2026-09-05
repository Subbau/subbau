// Zkouška vzhledu u faktury. Kód se vytahuje PŘÍMO z appky, ne z kopie —
// jinak by zkouška ověřovala něco jiného, než co je nasazené.
import fs from 'fs'
const src = fs.readFileSync('nasazeni4/subbau_final.html', 'utf8')

function vytahni(od, doo) {
  const i = src.indexOf(od); if (i < 0) throw new Error('nenašel jsem: ' + od)
  const j = src.indexOf(doo, i + od.length); if (j < 0) throw new Error('nenašel jsem konec: ' + doo)
  return src.slice(i, j)
}

// ---- náhrada prohlížeče: jen tolik, kolik testovaný kód potřebuje ----
const prvky = new Map()
function prvek(id) {
  if (!prvky.has(id)) prvky.set(id, { id, style: {}, value: '', textContent: '', innerHTML: '', checked: false, disabled: false })
  return prvky.get(id)
}
const hlasky = []
const vykresleno = []

const kod = [
  vytahni('const NAZVY_VZHLEDU = {', '// Zavře náhled faktury.'),
  vytahni('function invoiceDataFromRow(r, extra)', '\nlet _invEditId'),
  vytahni('function invoiceRowFromLast(sentVia)', '\n// Nahraje PDF do složky'),
  vytahni('async function storeInvoiceRow(row)', '\nasync function zapisRadekFaktury'),
  vytahni('async function zapisRadekFaktury(row)', '\nfunction _invSendBusy'),
].join('\n')

const hlavicka = `
const document = { getElementById: (id) => ${'globalThis'}.__prvek(id) }
const window = globalThis.__okno
function showToast(t) { globalThis.__hlasky.push(t) }
function renderInvoice(d) { globalThis.__vykresleno.push(d); globalThis.__okno._lastInvoice = d; nastavRezimUkazky(!!d.ukazka) }
function closeInvoiceOverlay() {}
function _invFmtDate(iso) { return iso ? String(iso).slice(0,10) : '' }
let sb = globalThis.__sb
let _invEditId = null
let currentWorkerId = null, currentWorkerProfile = null
function invoiceSupplierAddress(p) { return (p && p.address) || '' }
function defaultInvoiceItem() { return 'Carpentry service' }
`
const paticka = `
export { NAZVY_VZHLEDU, naplnVyberVzhledu, nastavRezimUkazky, otevriUkazkuVzhledu,
         ukazVzhled, vzhledOJedenVpred, vzhledOJedenZpet, pouzitZobrazenyVzhled,
         invoiceDataFromRow, invoiceRowFromLast, storeInvoiceRow }
`
globalThis.__prvek = prvek
globalThis.__hlasky = hlasky
globalThis.__vykresleno = vykresleno
globalThis.__okno = {}
let zaznamZapisu = []
let sbChyba = null
globalThis.__sb = {
  from() {
    const api = {
      update(row) { zaznamZapisu.push({ typ: 'update', row }); return api },
      insert(row) { zaznamZapisu.push({ typ: 'insert', row }); return Promise.resolve({ error: sbChyba(row) }) },
      eq() { return api }, select() { return Promise.resolve({ data: [], error: sbChyba(zaznamZapisu.at(-1).row) }) },
    }
    return api
  },
}

const M = await import('data:text/javascript,' + encodeURIComponent(hlavicka + kod + paticka))

let chyb = 0
const ok = (podminka, popis) => { if (!podminka) { chyb++; console.log('  ❌ ' + popis) } else console.log('  ✅ ' + popis) }

console.log('── appka opravdu přepíná režim ukázky ──')
// Napodobenina výš dělá totéž co renderInvoice. Tady ověřím, že to renderInvoice
// dělá doopravdy — jinak by DOM zkoušky níž měřily jen moji napodobeninu.
const telo = src.slice(src.indexOf('function renderInvoice(d, lang'), src.indexOf('function invoiceFileName'))
ok(/nastavRezimUkazky\(!!d\.ukazka\)/.test(telo), 'renderInvoice na konci přepne režim podle d.ukazka')
ok(/if \(window\._lastInvoice\?\.ukazka\)/.test(src.slice(src.indexOf('async function sendInvoiceToSubbau'), src.indexOf('async function sendInvoiceToSubbau') + 900)),
   'odeslání do SubBau ukázku odmítne')
ok(/if \(window\._lastInvoice\?\.ukazka\)/.test(src.slice(src.indexOf('async function emailInvoiceToSubbau'), src.indexOf('async function emailInvoiceToSubbau') + 900)),
   'odeslání e-mailem ukázku odmítne')
ok(/if \(window\._lastInvoice\?\.ukazka\)/.test(src.slice(src.indexOf('async function saveInvoicePdf'), src.indexOf('async function saveInvoicePdf') + 500)),
   'uložení PDF ukázku odmítne')

console.log('\n── vzhled se pamatuje u faktury ──')
globalThis.__okno._lastInvoice = { workerId: 'w1', invoiceNum: '202601', designIdx: 7 }
ok(M.invoiceRowFromLast('app').design_idx === 7, 'vystavená faktura si uloží číslo vzhledu (7)')
globalThis.__okno._lastInvoice = { workerId: 'w1', invoiceNum: '202601' }
ok(M.invoiceRowFromLast('app').design_idx === 1, 'bez volby se uloží vzhled 1')

console.log('\n── při čtení má faktura přednost před profilem ──')
ok(M.invoiceDataFromRow({ design_idx: 4 }, { designIdx: 9 }).designIdx === 4,
   'faktura vystavená ve vzhledu 4 se ve vzhledu 4 i vykreslí, i když má člověk v profilu 9')
ok(M.invoiceDataFromRow({ design_idx: null }, { designIdx: 9 }).designIdx === 9,
   'stará faktura bez uloženého vzhledu spadne na profil (9)')
ok(M.invoiceDataFromRow({}, {}).designIdx === 1, 'když není nic, je to vzhled 1')

console.log('\n── zápis se nesmí zaseknout na chybějícím sloupci ──')
zaznamZapisu = []; sbChyba = (row) => ('design_idx' in row) ? { message: 'column worker_invoices.design_idx does not exist' } : null
const vysl = await M.storeInvoiceRow({ worker_id: 'w1', invoice_number: '202601', design_idx: 5 })
ok(vysl === null, 'faktura se uloží i bez spuštěné migrace')
ok(zaznamZapisu.some(z => !('design_idx' in z.row)), 'druhý pokus jde bez sloupce se vzhledem')
zaznamZapisu = []; sbChyba = () => null
ok(await M.storeInvoiceRow({ worker_id: 'w1', invoice_number: '202601', design_idx: 5 }) === null
   && zaznamZapisu.every(z => z.row.design_idx === 5), 'se spuštěnou migrací se vzhled uloží napoprvé')

console.log('\n── ukázka vzhledu ──')
M.otevriUkazkuVzhledu({ invoiceNum: '202601' }, 3, null, '')
ok(vykresleno.at(-1).designIdx === 3 && vykresleno.at(-1).ukazka === true, 'ukázka se vykreslí ve zvoleném vzhledu')
ok(prvek('invoice-actions').style.display === 'none', 'lišta s odesláním je v ukázce schovaná')
ok(prvek('invoice-design-bar').style.display === 'block', 'místo ní je přepínač vzhledů')
ok(prvek('invoice-title').textContent.includes('Ukázka'), 'nadpis říká, že jde o ukázku')
M.vzhledOJedenVpred(); ok(vykresleno.at(-1).designIdx === 4, 'šipka vpřed přepne na 4')
M.ukazVzhled(10); M.vzhledOJedenVpred(); ok(vykresleno.at(-1).designIdx === 1, 'z desítky se přetočí na jedničku')
M.ukazVzhled(1); M.vzhledOJedenZpet(); ok(vykresleno.at(-1).designIdx === 10, 'z jedničky zpět na desítku')
M.ukazVzhled(99); ok(vykresleno.at(-1).designIdx === 10, 'mimo rozsah se ořízne na 10')
M.ukazVzhled(-5); ok(vykresleno.at(-1).designIdx === 1, 'mimo rozsah se ořízne na 1')
M.nastavRezimUkazky(false)
ok(prvek('invoice-actions').style.display === '' && prvek('invoice-design-bar').style.display === 'none',
   'po vypnutí ukázky je zpátky lišta s odesláním')

console.log('\n── nabídka vzhledů ──')
const sel = prvek('test-sel'); M.naplnVyberVzhledu(sel, 6)
ok((sel.innerHTML.match(/<option/g) || []).length === 10, 'v nabídce je všech deset vzhledů')
ok(sel.value === '6', 'předvybraný je ten uložený')
ok(Object.keys(M.NAZVY_VZHLEDU).length === 10, 'názvů vzhledů je deset')

console.log(chyb ? `\n❌ ${chyb} chyb` : '\n✅ VZHLED U FAKTURY FUNGUJE')

// ── KONTROLNÍ VZORKY: každá kontrola musí umět selhat ──
console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['přednost faktury před profilem',
   () => M.invoiceDataFromRow({ design_idx: 4 }, { designIdx: 9 }).designIdx === 9],
  ['skrytí odesílací lišty',
   () => { prvek('invoice-actions').style.display = 'blok-navic'; return prvek('invoice-actions').style.display === 'none' }],
  ['zdrojová kontrola volání v renderInvoice',
   () => /nastavRezimUkazky\(!!d\.NEEXISTUJE\)/.test(telo)],
  ['ořez mimo rozsah',
   () => { M.otevriUkazkuVzhledu({}, 1, null, ''); M.ukazVzhled(99); return vykresleno.at(-1).designIdx === 99 }],
]
let umiSelhat = 0
for (const [popis, f] of kontroly) {
  const prosloBySpatne = f()
  if (!prosloBySpatne) { umiSelhat++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, zkouška chybu NEODHALÍ')
}
if (umiSelhat !== kontroly.length) chyb++
process.exit(chyb ? 1 : 0)
