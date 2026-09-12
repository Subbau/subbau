// Nahrávání vícelistého dokladu správcem. Appka slibuje pět listů — a musí
// jich pět opravdu uložit, i když je správce vybírá PO JEDNOM ze souborů.
// Přesně tak to dělají, a dřív každý další výběr ten předchozí přemazal,
// takže z dokladu zůstaly dvě strany.
//
//   npm i puppeteer && node test-doklady-listy.mjs
import fs from 'fs'
import path from 'path'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) { console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer'); process.exit(2) }

// POJISTKA: ukázka se generuje z appky. Když se nepřegeneruje, běžela by
// zkouška na starém kódu a tvrdila by nesmysly — to se už jednou stalo.
function stejnaVerze(appka, ukazka) {
  const ver = t => (t.match(/SUBBAU_VERZE\s*=\s*'([^']*)'/) || [])[1] || null
  const a = ver(fs.readFileSync(appka, 'utf8')), u = ver(fs.readFileSync(ukazka, 'utf8'))
  if (!a || !u) { console.error('❌ Nenašel jsem verzi — zkouška NEPROBĚHLA'); process.exit(2) }
  if (a !== u) {
    console.error('❌ Ukázka je starší než appka — zkouška NEPROBĚHLA.')
    console.error('   appka:  ' + a)
    console.error('   ukázka: ' + u)
    console.error('   Spusťte: node ukazka/generuj.mjs')
    process.exit(2)
  }
}


const APP = process.argv[2] || 'subbau_final.html'
const UKAZKA = process.argv[3] || 'ukazka.html'
stejnaVerze(APP, UKAZKA)
const src = fs.readFileSync(APP, 'utf8')

let chyb = 0
const ok = (b, t) => { if (!b) { chyb++; console.log('  ❌ ' + t) } else console.log('  ✅ ' + t) }

const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1400, height: 1000 })
const chybyStranky = []
p.on('pageerror', e => chybyStranky.push(e.message.slice(0, 150)))
await p.goto('file://' + path.resolve(UKAZKA), { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const v = await p.evaluate(async () => {
  const { data: lide } = await sb.from('profiles').select('*').in('role', ['osvec', 'partak']).limit(1)
  const kdo = (lide || [])[0]
  if (!kdo) return { chyba: 'nenašel jsem pracovníka' }
  await openWorkerModal(kdo.id); await new Promise(r => setTimeout(r, 700))
  wdTab('dokumenty', document.querySelector('.wd-tab[onclick*="dokumenty"]'))
  await new Promise(r => setTimeout(r, 400))
  openUploadForWorker(); await new Promise(r => setTimeout(r, 300))
  const typ = document.getElementById('admin-upload-doc-type')
  if (!typ) return { chyba: 'formulář nahrávání není v DOM' }
  typ.value = 'a1'; adminDocTypeChange()

  const soubor = n => new File([new Blob(['x'.repeat(40)])], n, { type: 'image/jpeg' })
  const dej = (vstup, jmeno) => {
    const dt = new DataTransfer(); dt.items.add(soubor(jmeno))
    vstup.files = dt.files
    adminFileSelect(vstup, vstup.id.includes('file1') || vstup.id.includes('cam1') ? 1 : 2)
  }

  dej(document.getElementById('admin-upload-file1'), 'list1.jpg')

  // JÁDRO ZKOUŠKY: čtyři další listy vybrané po jednom, jak to dělá správce
  const vstup2 = document.getElementById('admin-upload-file2')
  const rustSeznamu = []
  for (const jmeno of ['list2.jpg', 'list3.jpg', 'list4.jpg', 'list5.jpg']) {
    dej(vstup2, jmeno)
    rustSeznamu.push((document.getElementById('admin-upload-list2')?.textContent || '').match(/\. list/g)?.length || 0)
  }
  const popisek = (document.getElementById('admin-side2-label')?.textContent || '').trim()

  // odebrání jednoho listu křížkem
  adminOdeberList(1)
  const poOdebrani = (document.getElementById('admin-upload-list2')?.textContent || '').match(/\. list/g)?.length || 0
  dej(vstup2, 'list6.jpg')   // doplníme zpátky na čtyři

  const pred = (await sb.from('documents').select('id').eq('worker_id', kdo.id)).data?.length || 0
  document.getElementById('admin-upload-valid-until').value = '2027-12-31'
  await uploadDocumentForWorker(); await new Promise(r => setTimeout(r, 1500))
  const po = (await sb.from('documents').select('id, file_name').eq('worker_id', kdo.id)).data || []
  return { rustSeznamu, popisek, poOdebrani, pribylo: po.length - pred,
           nazvy: po.slice(-5).map(d => d.file_name) }
})
await b.close()

if (v.chyba) { chyb++; console.log('  ❌ ' + v.chyba) }
else {
  console.log('── výběr listů po jednom ──')
  ok(JSON.stringify(v.rustSeznamu) === '[1,2,3,4]',
     'každý další výběr PŘIBUDE, nepřemaže předchozí (' + v.rustSeznamu.join(' → ') + ')')
  ok(/vybráno 4/.test(v.popisek), 'popisek hlásí, kolik listů je vybráno: „' + v.popisek + '"')
  ok(v.poOdebrani === 3, 'křížek jeden list odebere (zbyly ' + v.poOdebrani + ')')
  console.log('\n── uložení ──')
  ok(v.pribylo === 5, 'uloží se všech pět listů (uloženo ' + v.pribylo + ')')
  ok(v.nazvy.some(n => /strana 5/.test(n)), 'poslední list je označený jako 5. strana')
}
const vazne = chybyStranky.filter(x => !/favicon/i.test(x))
ok(!vazne.length, 'na stránce nenastala chyba' + (vazne.length ? ': ' + vazne[0] : ''))

console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['přidávání listů', () => /vybrane = prichozi\.length \? adminUploadFiles2\.concat/.test(src) === false],
  ['křížek u listu', () => !/function adminOdeberList/.test(src)],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ VÍCELISTÝ DOKLAD SE ULOŽÍ CELÝ')
process.exit(chyb ? 1 : 0)
