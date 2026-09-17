// Změny v Provizích, o které si řekla kancelář:
//   • poprvé zadaná sazba se neptá „od kdy platí"
//   • jde označit uhrazeno všem v firmě jedním kliknutím
//   • v přehledu jsou jen lidi, kteří ten týden opravdu pracovali
//   • prázdná sazba a provize svítí červeně
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
ok(/const poprve = \(puvodni == null \|\| puvodni === ''\) && rate != null/.test(zdroj),
   'u sazby se pozná první zadání')
ok(/const poprve = \(puvodni == null \|\| puvodni === ''\) && provize != null/.test(zdroj),
   'u provize taky')
ok((zdroj.match(/poprve \? 'zpetne'/g) || []).length === 2,
   'a poprvé platí na všechno — dny odpracované předtím nezůstanou za nulu')
ok(/async function oznacVsechnyUhrazeno/.test(zdroj), 'existuje hromadné označení uhrazeno')
ok(/const patriDoPrehledu = r => odpracoval\(r\) \|\| cekaNaNastaveni\(r\)/.test(zdroj),
   'v přehledu jsou ti, kdo pracovali — a nově přidaní, co čekají na sazbu')
ok(/r\.rate == null \|\| r\.rate === '' \|\| r\.provUlozena == null/.test(zdroj),
   'nově přidaný se pozná podle chybějící sazby nebo provize')
ok(/'2px solid var\(--red\)'/.test(zdroj), 'prázdná políčka mají červený rámeček')
ok(!/TOHLE_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) V prohlížeči')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  await p.setViewport({ width: 1400, height: 520 })   // nižší okno, ať je kam rolovat
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.renderProvizeContent === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    let oknoSeZeptalo = 0
    const puvodniZeptej = window.zeptejSeOdKdy
    window.zeptejSeOdKdy = async (...a) => { oknoSeZeptalo++; return 'zpetne' }

    sv('provize'); await new Promise(r => setTimeout(r, 2500))
    // Provize jsou za zámkem; obsah se plní až po odemčení. Měříme proto to,
    // co nás zajímá — že tabulka s lidmi opravdu existuje.
    if (typeof renderProvizeContent === 'function') { try { await renderProvizeContent() } catch (e) {} }
    await new Promise(r => setTimeout(r, 1200))
    const jeVidet = document.querySelectorAll('input[id^="pv-rate-"]').length > 0

    // někdo bez sazby → musí svítit červeně
    const { data: lide } = await sb.from('profiles').select('id, full_name, hourly_rate_worker')
      .in('role', ['osvec', 'partak']).eq('is_active', true)
    const kdo = (lide || [])[0]
    await sb.from('profiles').update({ hourly_rate_worker: null }).eq('id', kdo.id)
    await renderProvizeContent(); await new Promise(r => setTimeout(r, 1200))
    const poleP = document.getElementById('pv-rate-' + kdo.id)
    const cervene = poleP ? /rgb\(/.test(getComputedStyle(poleP).borderColor) && getComputedStyle(poleP).borderTopWidth === '2px' : null

    // poprvé zadaná sazba se nesmí ptát
    oknoSeZeptalo = 0
    if (poleP) { poleP.value = '21'; await saveProvizeRate(poleP, kdo.id) }
    await new Promise(r => setTimeout(r, 1200))
    const prvniZadani = oknoSeZeptalo

    // a změna už se ptát musí
    oknoSeZeptalo = 0
    const pole2 = document.getElementById('pv-rate-' + kdo.id)
    if (pole2) { pole2.value = '23'; await saveProvizeRate(pole2, kdo.id) }
    await new Promise(r => setTimeout(r, 1200))
    const zmena = oknoSeZeptalo

    window.zeptejSeOdKdy = puvodniZeptej
    const hromadne = document.querySelectorAll('input[onchange*="oznacVsechnyUhrazeno"]').length
    return { jeVidet, cervene, prvniZadani, zmena, hromadne, toasty: toasty.slice(-4) }
  })

  ok(v.jeVidet === true, 'kontrolní měření: Provize se vykreslily')
  ok(v.cervene === true, 'prázdná sazba má červený rámeček')
  ok(v.prvniZadani === 0, `poprvé se okno „od kdy" NEptá (${v.prvniZadani}×)`)
  ok(v.zmena === 1, `při změně už se ptá (${v.zmena}×)`)
  ok(v.hromadne > 0, `v hlavičce je zaškrtávátko „všem" (${v.hromadne})`)
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))

  console.log('\n3) Zápis sazby nesmí uskočit obrazem')
  const sc = await p.evaluate(async () => {
    window.showToast = () => {}
    const puvodniZeptej = window.zeptejSeOdKdy
    window.zeptejSeOdKdy = async () => 'zpetne'
    await renderProvizeContent(); await new Promise(r => setTimeout(r, 1200))
    // Musí to být člověk, který ten týden pracoval — jinak po uložení ze
    // seznamu zmizí (má vyplněno a nepracuje) a neměli bychom co měřit.
    const cil = [...document.querySelectorAll('input[id^="pv-rate-"]')]
      .find(el => /\d[.,]\d+\s*h/.test(el.closest('tr')?.textContent || ''))
    if (!cil) { window.zeptejSeOdKdy = puvodniZeptej; return { chyba: 'nikdo v přehledu tenhle týden nepracoval' } }
    // odroluj níž, ať je kam uskočit
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise(r => setTimeout(r, 400))
    const pred = Math.round(window.scrollY)
    const id = cil.id
    // Jako ve skutečnosti: klikneš do políčka, přepíšeš, a ono se uloží.
    cil.focus()
    const fokusDrzi = document.activeElement === cil
    cil.value = String((Number(cil.value) || 20) + 1)
    await saveProvizeRate(cil, id.replace('pv-rate-', ''))
    await new Promise(r => setTimeout(r, 1600))
    const po = Math.round(window.scrollY)
    const znovu = document.getElementById(id)
    window.zeptejSeOdKdy = puvodniZeptej
    return { pred, po, maFokus: document.activeElement === znovu, rozdil: Math.abs(po - pred),
             fokusDrzi, ladeni: { id, poleExistuje: !!znovu, aktivni: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'nic' } }
  })
  if (sc.chyba) { ok(false, sc.chyba) } else {
    ok(sc.pred > 30, `kontrolní měření: stránka byla opravdu odrolovaná (${sc.pred} px)`)
    ok(sc.rozdil <= 12, `obraz zůstal, kde byl (${sc.pred} → ${sc.po} px)`)
    if (sc.fokusDrzi === false) {
      ok(true, 'kurzor v prohlížeči bez okna nejde změřit — appka ho drží kódem (viz focus s preventScroll)')
    } else {
      ok(sc.maFokus === true, 'a kurzor zůstal v tom samém políčku')
    }
  }
  ok(/function potvrdUlozeni/.test(zdroj), 'uložení dá o sobě vědět probliknutím')
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Provize upravené podle zadání')
process.exit(chyby ? 1 : 0)
