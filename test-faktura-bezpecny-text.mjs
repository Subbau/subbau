// Ověří, že text, který na fakturu píše člověk (jméno firmy, adresa, číslo
// faktury, IBAN), se do dokladu jen VYPÍŠE a nevloží se jako HTML.
//
// PROČ: šablony vzhledů skládají fakturu z řetězců. Lomená závorka v názvu
// firmy by rozhodila celý doklad — a od chvíle, kdy si číslo faktury píše
// pracovník sám, je to text jako každý jiný.
//
//   npm i puppeteer && node test-faktura-bezpecny-text.mjs
import fs from 'fs'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) { console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer'); process.exit(2) }

const src = fs.readFileSync(process.argv[2] || 'subbau_final.html', 'utf8')
const vezmi = (a, b) => {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length)
  if (i < 0 || j < 0) throw new Error('nenašel jsem ' + a)
  return src.slice(i, j)
}
const kod = [
  vezmi('const INVOICE_COLORS = [', '// Uvolní barvu pracovníka'),
  vezmi('window.SABLONY_FAKTUR = window.SABLONY_FAKTUR', 'function renderInvoice(d, lang'),
  vezmi('function renderInvoice(d, lang', '\nfunction invoiceFileName'),
].join('\n')

const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 794, height: 1123 })
await p.setContent('<!doctype html><meta charset="utf-8">')

const vysledky = await p.evaluate((kod) => {
  document.body.innerHTML = '<div id="invoice-overlay" style="display:none"></div><div id="invoice-content"></div>'
  Object.assign(window, { showToast(){}, fitInvoicePreview(){}, updateInvoiceSendUi(){}, nastavRezimUkazky(){},
    mnozstviPolozky: pol => Number(pol.mnozstvi) || 0, _invSentNote: '', _invZoom: 'fit' })
  new Function(kod + '\n;window.__r = renderInvoice')()
  const ZLE = '<img src=x onerror=alert(1)>Firma & syn "s.r.o." <iframe src=x></iframe>'
  const out = []
  for (const vzhled of [1,2,3,4,5,6,7,8,9,10]) {
    window.__r({ invoiceNum: ZLE, crmCode: ZLE, invoiceColorIdx: 0, designIdx: vzhled,
      today: '01.01.2026', dueDate: '08.01.2026', dueDays: 7,
      workerName: ZLE, workerAddr: ZLE + '\nDruhý řádek', workerIC: '1', workerVat: 'CZ1', isVatPayer: true,
      workerEmail: ZLE, workerPhone: ZLE, iban: ZLE, swift: ZLE,
      serviceDesc: ZLE, serviceDescTrans: '', serviceDescSub: '',
      periodFrom: '01.01.2026', periodTo: '07.01.2026',
      totalHours: 10, rate: 23, totalAmount: 230, cashPaid: 5, cashPaidNote: ZLE,
      customer: { name: ZLE, address: ZLE, id: '2', vatId: 'DE2' },
      items: [{ popis: ZLE, mnozstvi: 1, cena: 10 }],
      week: 1, year: 2026, workerId: 'w', byAdmin: false }, 'en')
    const el = document.getElementById('invoice-content')
    out.push({ vzhled,
      vlozeno: el.querySelectorAll('img, script, iframe, object, embed').length,
      textVidet: el.textContent.includes('Firma & syn') })
  }
  return out
}, kod)

// Kontrolní vzorek: vložení téhož textu bez ošetření musí zkouška odhalit.
const kontrola = await p.evaluate(() => {
  const el = document.getElementById('invoice-content')
  el.insertAdjacentHTML('beforeend', '<img src=x>')
  return el.querySelectorAll('img, script, iframe, object, embed').length
})
await b.close()

let chyb = 0
for (const v of vysledky) {
  const dobre = v.vlozeno === 0 && v.textVidet
  if (!dobre) chyb++
  console.log(`  ${dobre ? '✅' : '❌'} vzhled ${String(v.vzhled).padStart(2)} — vložených značek: ${v.vlozeno}, text vidět: ${v.textVidet}`)
}
const umiSelhat = kontrola > 0
console.log(umiSelhat ? '  ✅ kontrolní vzorek: neošetřený text by se poznal'
                      : '  ❌ kontrolní vzorek NEPROŠEL — zkouška nic neměří')
if (!umiSelhat) chyb++
console.log(chyb ? `\n❌ ${chyb} vzhledů pustí do dokladu HTML` : '\n✅ NEBEZPEČNÝ TEXT SE VŠUDE JEN VYPÍŠE')
process.exit(chyb ? 1 : 0)
