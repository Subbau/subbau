// Stahované soubory se mají jmenovat německy — jdou účetní do Německa
// a nikdo je nemá přepisovat ručně.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const UKAZKA = path.join(D, 'ukazka.html')
function stejnaVerze() {
  const v = s => (fs.readFileSync(s, 'utf8').match(/SUBBAU_VERZE\s*=\s*'([^']+)'/) || [])[1]
  const a = v(APP), b = v(UKAZKA)
  if (!a || a !== b) { console.error(`❌ ukázka je stará (appka ${a}, ukázka ${b}) — spusť node ukazka/generuj.mjs`); process.exit(1) }
}
const zdroj = fs.readFileSync(APP, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód')
ok(/const name = 'Rechnung_' \+ cis/.test(zdroj), 'faktura se stahuje jako Rechnung_číslo_jméno')
ok(!/const name = 'Faktura_'/.test(zdroj), 'a už ne česky')
ok(/function docLabelDe/.test(zdroj), 'doklady mají německé názvy')
ok(/downloadOneDoc\(url, label, docType, jmeno\)/.test(zdroj), 'stahování dokladu zná typ i jméno')
ok(!/TAKOVY_NAZEV_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Jak se ty soubory pojmenují')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.docLabelDe === 'function', { timeout: 20000 })

  const v = await p.evaluate(() => ({
    op: docLabelDe('op'), zivnost: docLabelDe('zivnost'), a1: docLabelDe('a1'),
    ridicak: docLabelDe('ridicak'), pas: docLabelDe('pas'), freistellung: docLabelDe('freistellung'),
    neznamy: docLabelDe('neco_co_neexistuje'),
    nazev: bezpecnyNazevSouboru('Řehoř Čížek-Vlk'),
    prazdny: bezpecnyNazevSouboru('')
  }))
  ok(v.op === 'Personalausweis', `občanka → ${v.op}`)
  ok(v.zivnost === 'Gewerbeschein', `živnosťák → ${v.zivnost}`)
  ok(v.a1 === 'A1-Bescheinigung', `A1 → ${v.a1}`)
  ok(v.ridicak === 'Fuehrerschein', `řidičák → ${v.ridicak}`)
  ok(v.pas === 'Reisepass', `pas → ${v.pas}`)
  ok(v.freistellung === 'Freistellungsbescheinigung', `freistellung → ${v.freistellung}`)
  ok(v.neznamy === 'Dokument', 'neznámý typ nespadne, jmenuje se Dokument')
  ok(v.nazev === 'Rehor_Cizek_Vlk', `háčky a pomlčky z názvu zmizí (${v.nazev})`)
  ok(v.prazdny === '', 'kontrolní měření: prázdný vstup dá prázdno, ne nesmysl')
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Soubory se stahují s německými názvy')
process.exit(chyby ? 1 : 0)
