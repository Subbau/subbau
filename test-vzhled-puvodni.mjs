// Změří PŮVODNÍ vzhled 1 — ten není šablona, ale kód přímo v renderInvoice,
// takže ho ostatní zkoušky nevidí. Přitom ho má většina lidí.
// Spouští se opravdová renderInvoice, jen s náhradou okolí appky.
import fs from 'fs'; import puppeteer from 'puppeteer'
const src = fs.readFileSync('../nasazeni4/subbau_final.html', 'utf8')
const vezmi = (od, doo) => {
  const i = src.indexOf(od); const j = src.indexOf(doo, i + od.length)
  if (i < 0 || j < 0) throw new Error('nenašel: ' + od)
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

const VARIANTY = {
  'běžná': { items: null, hodin: 59.5 },
  'šest položek': { items: 6, dlouhe: true },
  'deset položek': { items: 10, dlouhe: false },
  'deset dlouhých': { items: 10, dlouhe: true },
}
let chyb = 0
for (const [jm, v] of Object.entries(VARIANTY)) {
  const vysl = await p.evaluate((kod, v) => {
    // stejné podmínky jako u ostatních vzhledů: nulové okraje, list široký A4
    document.head.insertAdjacentHTML('beforeend',
      '<style>*{margin:0;padding:0;box-sizing:border-box}body{width:794px;background:#fff}</style>')
    document.body.innerHTML = '<div id="invoice-overlay" style="display:none"></div><div id="invoice-content"></div>'
    // náhrada okolí appky — jen tolik, kolik renderInvoice potřebuje
    window.showToast = () => {}
    window.fitInvoicePreview = () => {}
    window.updateInvoiceSendUi = () => {}
    window.nastavRezimUkazky = () => {}
    window.mnozstviPolozky = (pol) => Number(pol.mnozstvi) || 0
    window._invSentNote = ''; window._invZoom = 'fit'
    try { new Function(kod + '\n; window.__render = renderInvoice')() }
    catch (e) { return { chyba: 'kód se nepodařilo spustit: ' + e.message } }
    const dlouhy = 'Zednické práce — vyzdívky z pórobetonových tvárnic tl. 300 mm včetně překladů'
    const d = {
      invoiceNum: '202614', crmCode: 'X12', invoiceColorIdx: 0, designIdx: 1,
      today: '29.08.2026', dueDate: '05.09.2026', dueDays: 7,
      workerName: 'Stavební a montážní společnost Vrchlavský a synové s.r.o.',
      workerAddr: 'Nádražní třída 1247/12b\nBudějovické Předměstí\n370 01 České Budějovice\nČeská republika',
      workerIC: '17398096', workerVat: 'CZ17398096', isVatPayer: true,
      workerEmail: 'fakturace@stavebni-montazni-spolecnost.cz', workerPhone: '+420 777 111 222',
      iban: 'CZ12 0600 0000 0002 5309 9571', swift: 'AGBACZPP',
      serviceDesc: 'Bricklaying work', serviceDescTrans: 'Zednické práce', serviceDescSub: 'KW 35/2026',
      periodFrom: '24.08.2026', periodTo: '30.08.2026',
      totalHours: v.hodin || 0, rate: 23, totalAmount: 1368.5,
      cashPaid: 500, cashPaidNote: 'vyplaceno v hotovosti 20.08.2026',
      customer: { name: 'Treskower Zimmermann und Dachdecker Gesellschaft mbH',
                  address: 'Ahornallee 9, Gewerbegebiet Nord\n16818 Märkisch Linden / OT Werder\nBrandenburg\nDeutschland',
                  id: '814135650', vatId: 'DE814135650' },
      items: v.items ? Array.from({ length: v.items }, (_, i) =>
        ({ popis: (v.dlouhe ? dlouhy + ', etapa ' + (i+1) : 'Zednické práce ' + (i+1)), mnozstvi: 12.5, cena: 23 })) : null,
      week: 35, year: 2026, workerId: 'w1', byAdmin: false, supplierType: 'sro',
    }
    try { window.__render(d, 'en') } catch (e) { return { chyba: 'renderInvoice spadla: ' + e.message } }
    const el = document.getElementById('invoice-page')
    if (!el) return { chyba: 'faktura se nevykreslila (chybí #invoice-page)' }
    const html = document.getElementById('invoice-content').innerHTML
    let dno = 0, pret = 0
    el.querySelectorAll('*').forEach(x => { const r = x.getBoundingClientRect()
      if (r.bottom > dno) dno = r.bottom
      if (x.children.length === 0 && x.scrollWidth > x.clientWidth + 1) pret++ })
    const r = el.getBoundingClientRect()
    return { v: Math.round(Math.max(r.height, dno)), s: Math.round(r.width), pret,
             nedef: /undefined|NaN/.test(html), maCastku: html.includes('1368.50') || html.includes('868.50') }
  }, kod, v)

  if (vysl.chyba) { chyb++; console.log(`  ❌ ${jm}: ${vysl.chyba}`); continue }
  const potize = []
  if (vysl.s !== 794) potize.push('šířka ' + vysl.s)
  if (vysl.v > 1123) potize.push('vysoké ' + vysl.v + ' px → do PDF se zmenší na ' + Math.round(1123/vysl.v*100) + ' %')
  if (vysl.pret) potize.push(vysl.pret + '× text nevejde do rámečku')
  if (vysl.nedef) potize.push('v HTML je undefined/NaN')
  if (!vysl.maCastku) potize.push('na faktuře chybí částka')
  if (potize.length) { chyb++; console.log(`  ❌ ${jm}: ${potize.join(' | ')}`) }
  else console.log(`  ✅ ${jm} — ${vysl.s}×${vysl.v} px`)
}
// Kontrolní vzorek — ať vím, že měření umí selhat: nafouknu písmo faktury
// a čekám, že to zkouška pozná.
const kontrola = await p.evaluate(() => {
  const el = document.getElementById('invoice-page')
  if (!el) return null
  // Nafouknutí písma na kořeni se do prvků s pevnou velikostí nepropíše —
  // proto do faktury přidáme kus, který ji doopravdy prodlouží.
  el.insertAdjacentHTML('beforeend', '<div style="height:500px"></div>')
  let dno = 0
  el.querySelectorAll('*').forEach(x => { const r = x.getBoundingClientRect(); if (r.bottom > dno) dno = r.bottom })
  return Math.round(Math.max(el.getBoundingClientRect().height, dno))
})
await b.close()
const umiSelhat = kontrola != null && kontrola > 1123
console.log(umiSelhat ? '  ✅ kontrolní vzorek: nafouknutá faktura se pozná (' + kontrola + ' px)'
                      : '  ❌ kontrolní vzorek NEPROŠEL — měření nic neměří')
if (!umiSelhat) chyb++
console.log(chyb ? `\n❌ původní vzhled má ${chyb} potíží` : '\n✅ PŮVODNÍ VZHLED JE V POŘÁDKU')
process.exit(chyb ? 1 : 0)
