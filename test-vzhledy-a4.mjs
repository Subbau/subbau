// Změří, jestli se každý vzhled faktury vejde na list A4.
//
// PROČ: faktura se do PDF vkládá jako jeden obrázek a když je vyšší než list,
// zmenší se CELÁ — vyjede menší a s bílými pruhy po stranách. Na kontrole polí
// se to nepozná, protože všechny údaje na faktuře jsou. Vzhled 3 takhle tiše
// vyjížděl na 89 % a nikdo si toho nevšiml, dokud se na fakturu někdo nepodíval.
//
// Vykresluje se opravdovým prohlížečem, jinak by se výška jen odhadovala.
//   npm i puppeteer && node test-vzhledy-a4.mjs
import fs from 'fs'

const A4_S = 794, A4_V = 1123
const SOUBOR = process.argv[2] || 'subbau_final.html'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) {
  console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer')
  process.exit(2)
}

const src = fs.readFileSync(SOUBOR, 'utf8')
const blok = src.slice(src.indexOf('window.SABLONY_FAKTUR = window.SABLONY_FAKTUR'),
                       src.indexOf('function renderInvoice(d, lang'))
if (blok.length < 5000) { console.error('❌ Blok se šablonami se nenašel — zkouška NEPROBĚHLA'); process.exit(2) }

// Vzorová faktura se bere ze zkoušky polí, ať obě měří na týchž datech.
const zk = fs.readFileSync('test-vzhledy-faktur.mjs', 'utf8')
const data = await import('data:text/javascript,' + encodeURIComponent(
  zk.slice(zk.indexOf('const L = {'), zk.indexOf('const POVINNE'))
  + '\nexport { zaklad, polozkova, seZalohou, platce }'))
// Hustotu sazby počítá appka v renderInvoice. Vzorec se čte PŘÍMO Z NÍ, ať se
// zkouška nemůže rozejít s tím, co se doopravdy tiskne.
const vzorec = src.slice(src.indexOf('const naplnFaktury = jePolozkova'), src.indexOf('const V = {'))
if (!/stupenHustoty/.test(vzorec)) { console.error('❌ Vzorec hustoty se nenašel — zkouška NEPROBĚHLA'); process.exit(2) }
const meze = [...vzorec.matchAll(/naplnFaktury >= (\d+) \? (\d+)/g)].map(m => [Number(m[1]), Number(m[2])])
const rada = (jmeno) => {
  const m = src.match(new RegExp(jmeno + ": \\[([^\\]]+)\\]"))
  return m[1].split(',').map(x => x.trim().replace(/'/g, ''))
}
const RADEK = rada('radekY'), PISMO = rada('pismoPolozky'), MEZERA = rada('mezera')
function sHustotou(V) {
  const p = V.jePolozkova ? V.polozky : []
  const napln = V.jePolozkova
    ? p.reduce((s, x) => s + 1 + Math.floor(String(x.popis || '').length / 55), 0) : 1
  let st = 0
  for (const [mez, stupen] of meze) if (napln >= mez) { st = stupen; break }
  return { ...V, radekY: RADEK[st], pismoPolozky: PISMO[st], mezera: MEZERA[st], husto: st > 0 }
}

// Vedle běžných faktur se měří i ty nabité — právě na nich vzhledy přetékaly.
const dlouhy = (V) => {
  const z = structuredClone(V)
  z.dodavatel.jmeno = 'Stavební a montážní společnost Vrchlavský a synové s.r.o.'
  z.dodavatel.adresa = 'Nádražní třída 1247/12b\nBudějovické Předměstí\n370 01 České Budějovice\nČeská republika'
  z.dodavatel.email = 'fakturace@stavebni-montazni-spolecnost.cz'
  z.dodavatel.telefon = '+420 777 111 222'
  z.odberatel.jmeno = 'Treskower Zimmermann und Dachdecker Gesellschaft mbH'
  z.odberatel.adresa = 'Ahornallee 9, Gewerbegebiet Nord\n16818 Märkisch Linden / OT Werder\nBrandenburg\nBundesrepublik Deutschland'
  z.jePolozkova = true
  z.zalohaJe = true; z.zaloha = '500.00'; z.zalohaPozn = 'vyplaceno v hotovosti 20.08.2026'
  z.celkem = '920.00'; z.kUhrade = '420.00'
  return z
}
const sPolozkami = (V, kolik, popis) => {
  const z = dlouhy(V)
  z.polozky = Array.from({ length: kolik }, (_, i) =>
    ({ popis: popis(i), mnozstvi: '12.5', cena: '23.00', castka: '287.50' }))
  return z
}
const KRATKE = ['Zednické práce','Montáž sádrokartonu','Betonáž základů','Tesařské práce','Pokrývačské práce',
                'Zateplení fasády','Obklady a dlažby','Omítky vnitřní','Úklid staveniště','Doprava materiálu']

const VARIANTY = {
  'běžná': data.zaklad, 'položková': data.polozkova,
  'se zálohou': data.seZalohou, 'plátce DPH': data.platce,
  // šest položek s dlouhými popisy — na tomhle přetékalo pět vzhledů
  'nabitá': sPolozkami(data.platce, 6, i => KRATKE[i] + ' — vyzdívky z pórobetonových tvárnic tl. 300 mm'),
  // deset položek, tedy strop, co appka na fakturu pustí
  'plná': sPolozkami(data.platce, 10, i => KRATKE[i]),
  // deset položek a ke každé dlouhý popis — nad tohle se faktura nedostane
  'krajní': sPolozkami(data.platce, 10, i => 'Zednické práce — vyzdívky z pórobetonových tvárnic tl. 300 mm včetně překladů, etapa ' + (i+1)),
}

const prohlizec = await puppeteer.launch({ args: ['--no-sandbox'] })
const list = await prohlizec.newPage()
await list.setViewport({ width: A4_S, height: A4_V })

let chyb = 0
for (const n of [2,3,4,5,6,7,8,9,10]) {
  const potize = []
  for (const [jmeno, syrove] of Object.entries(VARIANTY)) {
    const V = sHustotou(syrove)
    const html = await list.evaluate((blok, V, n) => {
      const w = {}; new Function('window', blok)(w)
      return w.SABLONY_FAKTUR[n](V)
    }, blok, V, n)
    await list.setContent(`<!doctype html><html><head><meta charset="utf-8">
      <style>*{margin:0;padding:0;box-sizing:border-box}body{width:794px;background:#fff}</style>
      </head><body>${html}</body></html>`, { waitUntil: 'load' })
    const m = await list.evaluate(() => {
      const p = document.getElementById('invoice-page')
      const r = p.getBoundingClientRect()
      let dno = 0, prava = 0, pretekle = 0
      p.querySelectorAll('*').forEach(el => {
        const b = el.getBoundingClientRect()
        if (b.bottom > dno) dno = b.bottom
        if (b.right > prava) prava = b.right
        if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1) pretekle++
      })
      return { vyska: Math.round(Math.max(r.height, dno)), sirka: Math.round(r.width),
               prava: Math.round(prava), pretekle }
    })
    if (m.sirka !== A4_S) potize.push(`${jmeno}: šířka ${m.sirka} místo ${A4_S}`)
    if (m.vyska > A4_V) potize.push(`${jmeno}: vysoké ${m.vyska} px — do PDF se zmenší na ${Math.round(A4_V/m.vyska*100)} %`)
    if (m.prava > A4_S + 1) potize.push(`${jmeno}: přetéká vpravo o ${m.prava - A4_S} px`)
    if (m.pretekle) potize.push(`${jmeno}: ${m.pretekle}× text nevejde do svého rámečku`)
  }
  if (potize.length) { chyb++; console.log(`  ❌ vzhled ${n}: ${potize.slice(0,2).join(' | ')}`) }
  else console.log(`  ✅ vzhled ${n}`)
}

// Kontrolní vzorek — ať vím, že měření umí selhat.
const kontrola = await list.evaluate(() => {
  document.body.innerHTML = '<div id="invoice-page" style="width:794px;height:1600px"></div>'
  return Math.round(document.getElementById('invoice-page').getBoundingClientRect().height)
})
await prohlizec.close()
const umiSelhat = kontrola > A4_V
console.log(umiSelhat ? '  ✅ kontrolní vzorek: příliš vysoký list se pozná'
                      : '  ❌ kontrolní vzorek NEPROŠEL — měření nic neměří')
if (!umiSelhat) chyb++

console.log(chyb ? `\n❌ ${chyb} vzhledů se nevejde na A4` : '\n✅ VŠECHNY VZHLEDY SE VEJDOU NA A4')
process.exit(chyb ? 1 : 0)
