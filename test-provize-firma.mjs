// Uhrazená provize u nadpisu firmy: vlastní přehled o tom, že firma zaplatila
// SubBau. NESMÍ sahat na zaškrtávání u jednotlivých pracovníků.
//
// Appka se doopravdy spustí v prohlížeči (přes ukázkovou verzi, která běží bez
// serveru, ale je to týž kód) a sekce Provize se proklikne.
//
//   npm i puppeteer && node test-provize-firma.mjs
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

console.log('── uložení se týká jen firmy ──')
const fn = src.slice(src.indexOf('async function toggleProvizeFirma'), src.indexOf('async function toggleBezProvize'))
ok(fn.length > 200, 'funkce toggleProvizeFirma existuje')
ok(/provize_platby_firem/.test(fn), 'zapisuje do vlastní tabulky firem')
ok(!/provize_payments/.test(fn), 'NEsahá na uhrazení u pracovníků')
ok(!/syncInvoicePaidFromProvize/.test(fn), 'NEpřepisuje stav faktur pracovníků')
ok(/onConflict: 'firma,period_key'/.test(fn), 'jeden záznam na firmu a týden')

console.log('\n── v prohlížeči ──')
const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1400, height: 1000 })
const chybyStranky = []
p.on('pageerror', e => chybyStranky.push(e.message.slice(0, 140)))
await p.goto('file://' + path.resolve(UKAZKA), { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const v = await p.evaluate(async () => {
  sessionStorage.setItem('provizeUnlocked', 'ukazka')
  const sekce = document.getElementById('provize-content')
  if (!sekce) return { chyba: 'sekce provizí chybí' }
  sekce.style.display = 'block'
  const zamek = document.getElementById('provize-lock'); if (zamek) zamek.style.display = 'none'
  await renderProvizeContent()
  await new Promise(r => setTimeout(r, 500))

  const karta = () => [...sekce.querySelectorAll('.card')]
    .find(c => c.querySelector('h4')?.textContent.includes('🏢'))
  const stav = () => {
    const k = karta()
    const zask = k?.querySelector('input[onchange*="toggleProvizeFirma"]')
    return {
      je: !!zask, zaskrtnuto: !!zask?.checked,
      pozadiHlavicky: k?.querySelector('.card-h')?.getAttribute('style') || '',
      okraj: k?.getAttribute('style') || '',
      popisek: (k?.querySelector('label[title]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      lidiZaskrtnuto: [...sekce.querySelectorAll('input[onchange*="toggleProvizePaid"]')].map(x => x.checked).join(','),
    }
  }
  const pred = stav()

  // Červená = po splatnosti a nezaplaceno. Vrátíme se po týdnech, až na takový narazíme.
  let cervena = null
  for (let i = 0; i < 6 && !cervena; i++) {
    provizePrev(); await renderProvizeContent(); await new Promise(r => setTimeout(r, 300))
    const s2 = stav()
    if (/red/.test(s2.pozadiHlavicky)) cervena = s2
  }
  provizeToday(); await renderProvizeContent(); await new Promise(r => setTimeout(r, 400))

  const zask = karta().querySelector('input[onchange*="toggleProvizeFirma"]')
  zask.checked = true
  zask.dispatchEvent(new Event('change'))
  await new Promise(r => setTimeout(r, 800))
  const po = stav()
  return { pred, po, cervena }
})
await b.close()

if (v.chyba) { chyb++; console.log('  ❌ ' + v.chyba) }
else {
  ok(v.pred.je, 'u nadpisu firmy je zaškrtávátko')
  ok(/Uhrazená provize/.test(v.pred.popisek), 'je u něj napsáno „Uhrazená provize"')
  ok(!v.pred.zaskrtnuto, 'napoprvé není zaškrtnuté')
  ok(v.po.zaskrtnuto, 'po kliknutí zůstane zaškrtnuté')
  ok(/green/.test(v.po.pozadiHlavicky) || /green/.test(v.po.okraj), 'po zaškrtnutí je nadpis zelený')
  ok(!/red/.test(v.po.pozadiHlavicky), 'zelený nadpis už není červený')
  ok(!!v.cervena, 'u týdne po splatnosti je nadpis červený')
  ok(!v.cervena || /po splatnosti/.test(v.cervena.popisek), 'a je u něj napsáno „po splatnosti"')
  ok(!v.cervena || !/splatnost.*splatnost/.test(v.cervena.popisek), 'slovo splatnost se neopakuje')
  ok(v.pred.lidiZaskrtnuto === v.po.lidiZaskrtnuto,
     'zaškrtnutí u pracovníků se NEZMĚNILO (' + (v.pred.lidiZaskrtnuto.split(',').length) + ' lidí)')
}
const vazne = chybyStranky.filter(x => !/favicon/i.test(x))
ok(!vazne.length, 'na stránce nenastala chyba' + (vazne.length ? ': ' + vazne[0] : ''))

// Kontrolní vzorek: zkouška musí umět selhat.
console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['hlídání zápisu do tabulky pracovníků', () => /provize_payments/.test(fn)],
  ['hledání zaškrtávátka u firmy', () => /onchange="toggleProvizeFirmaNEEXISTUJE"/.test(src)],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ UHRAZENÁ PROVIZE U FIRMY FUNGUJE A LIDÍ SE NEDOTKNE')
process.exit(chyb ? 1 : 0)
