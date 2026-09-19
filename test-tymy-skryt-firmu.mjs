// V Týmech jde firmu schovat — když ukazuju appku zákazníkovi, nesmí vidět
// ostatní firmy. Je to JEN zobrazení: data, výpočty ani výkazy to nemění.
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
ok(/function tymJeVidet\(id\) \{ return !skryteTymy\(\)\.has\(String\(id\)\) \}/.test(zdroj),
   'jedno místo rozhoduje, co je vidět')
ok(/function jenTatoFirma/.test(zdroj), 'jde nechat vidět jedinou firmu jedním kliknutím')
ok(/function ukazVsechnyTymy/.test(zdroj), 'a jedním kliknutím to vrátit')
ok(/lsSet\(TYMY_SKRYTE_KLIC/.test(zdroj) && /lsGet\(TYMY_SKRYTE_KLIC/.test(zdroj),
   'ukládá se přes bezpečné obaly (iPhone v anonymním okně jinak hází chybu)')
ok(/Všechny firmy jsou schované/.test(zdroj),
   'i když schová všechny, má se jak vrátit — jinak by v tom uvízl')
ok(/skryjTym\('\$\{t\.id\}'\)/.test(zdroj) && /jenTatoFirma\('\$\{t\.id\}'\)/.test(zdroj),
   'do atributů jde ID, ne název firmy (název s uvozovkou atribut rozbije)')
ok(!/JSON\.stringify\(cleanTeamName/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — schovat a vrátit doopravdy')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1500))

  const v = await p.evaluate(async () => {
    const sekce = document.getElementById('v-tymy')
    if (!sekce) return { chyba: 'sekce Týmy nenalezena' }
    document.querySelectorAll('.view').forEach(x => x.classList.remove('on'))
    sekce.classList.add('on'); sekce.style.display = 'block'
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    if (typeof loadTeams === 'function') await loadTeams()
    await new Promise(r => setTimeout(r, 800))

    const pocetFirem = () => document.querySelectorAll('#teams-list button[onclick^="skryjTym"]').length
    const out = { pred: pocetFirem() }

    // KLIKNI na „Schovat" u první firmy, jak by kliknul člověk
    const schovat = document.querySelector('#teams-list button[onclick^="skryjTym"]')
    out.atribut = schovat ? schovat.getAttribute('onclick') : ''
    if (schovat) schovat.click()
    await new Promise(r => setTimeout(r, 500))
    out.poSchovani = pocetFirem()
    out.pruzek = /Schováno/.test(document.getElementById('teams-list').textContent)

    // „Jen tuhle" u zbývající firmy
    const jen = document.querySelector('#teams-list button[onclick^="jenTatoFirma"]')
    if (jen) jen.click()
    await new Promise(r => setTimeout(r, 500))
    out.poJenTato = pocetFirem()

    // vrátit všechny
    if (typeof ukazVsechnyTymy === 'function') ukazVsechnyTymy()
    await new Promise(r => setTimeout(r, 500))
    out.poVraceni = pocetFirem()
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    return out
  })

  if (v.chyba) { chyby++; console.log('  ❌ ' + v.chyba) }
  else {
    ok(v.pred >= 2, `v Týmech je víc firem (${v.pred})`)
    ok(/^skryjTym\('[^']+'\)$/.test(v.atribut), 'atribut tlačítka je celý, ne useknutý')
    ok(v.poSchovani === v.pred - 1, `schováním jedna zmizela (${v.pred} → ${v.poSchovani})`)
    ok(v.pruzek, 'a je napsané, kolik jich je schovaných')
    ok(v.poJenTato === 1, `„Jen tuhle" nechá jedinou firmu (zbylo ${v.poJenTato})`)
    ok(v.poVraceni === v.pred, `„Ukázat všechny" je vrátí (${v.poJenTato} → ${v.poVraceni}) — kontrolní měření`)
    ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
  }
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Skrývání firem v Týmech funguje')
process.exit(chyby ? 1 : 0)
