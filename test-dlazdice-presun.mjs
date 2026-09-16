// Dlaždice z nástěnky se přesunuly do Provizí. Největší riziko bylo, že se
// z HTML smaže dlaždice, ale kód, který ji plní, zůstane — pak by celá
// nástěnka spadla i s tabulkou docházky a s hlídáním dokumentů. A protože se
// obnovuje i sama každou minutu, padalo by to pořád dokola.
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

console.log('\n1) Kód — dlaždice i jejich plnění jsou pryč')
for (const id of ['stat-workers', 'stat-hours', 'stat-hours-today', 'stat-teams', 'stat-docs']) {
  ok(!new RegExp(`getElementById\\('${id}'\\)`).test(zdroj), `nikdo už neplní ${id}`)
}
ok(!/id="stat-workers"|id="stat-hours"|id="stat-teams"/.test(zdroj), 'a v HTML ty dlaždice nejsou')
ok(/id="doc-alerts-count"/.test(zdroj), 'v nadpisu dokumentů je místo na číslovku')
ok(/souhrn\.hWeek/.test(zdroj) && /souhrn\.hMonth/.test(zdroj), 'Provize sčítají hodiny za týden i měsíc')
ok(/dnesPoFirmach/.test(zdroj), 'a hodiny dnes i po firmách')
ok(!/TAHLE_DLAZDICE_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Nástěnka se musí načíst celá')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.loadDashboard === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    let spadlo = ''
    sv('dashboard'); await new Promise(r => setTimeout(r, 1200))
    try { await loadDashboard() } catch (e) { spadlo = String(e && e.message) }
    await new Promise(r => setTimeout(r, 1500))
    const tabulka = document.getElementById('dash-attendance')
    const nadpisDoklady = document.getElementById('doc-alerts-count')
    return {
      spadlo,
      tabulkaMaRadky: !!tabulka && tabulka.querySelectorAll('tr').length > 0,
      zbyleDlazdice: document.querySelectorAll('#admin-stats .sc').length,
      cislovka: nadpisDoklady ? nadpisDoklady.textContent.trim() : null,
      kartaDokladu: document.getElementById('doc-alerts-card')?.style.display
    }
  })

  ok(v.spadlo === '', 'načtení nástěnky nespadlo' + (v.spadlo ? ' — ' + v.spadlo : ''))
  ok(v.tabulkaMaRadky === true, 'a tabulka „Poslední záznamy docházky" se naplnila')
  ok(v.zbyleDlazdice === 0, `nahoře nezůstala žádná osamocená dlaždice (${v.zbyleDlazdice})`)
  if (v.kartaDokladu === 'block') {
    ok(/polo/.test(v.cislovka || '') && /\d/.test(v.cislovka || ''), `v nadpisu dokumentů je číslovka („${v.cislovka}")`)
  } else {
    ok(true, 'v ukázce nikomu nechybí doklad — číslovka se nemá co ukázat')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))

  console.log('\n3) Hodiny se objevily v Provizích')
  const pv = await p.evaluate(async () => {
    window.showToast = () => {}
    sv('provize'); await new Promise(r => setTimeout(r, 2000))
    try { await renderProvizeContent() } catch (e) {}
    await new Promise(r => setTimeout(r, 1500))
    const t = (document.getElementById('provize-content')?.textContent || '').replace(/\s+/g, ' ')
    return { maHodinyDnes: /Hodiny dnes/.test(t), maTyden: /Hodiny tento týden/.test(t),
             maMesic: /Hodiny tento měsíc/.test(t), maTymy: /Týmy aktivní/.test(t),
             maCislo: /\d+[.,]\d\s*h/.test(t) }
  })
  ok(pv.maHodinyDnes, 'je tam „Hodiny dnes"')
  ok(pv.maTyden, 'i „Hodiny tento týden"')
  ok(pv.maMesic, 'i „Hodiny tento měsíc"')
  ok(pv.maTymy, 'i „Týmy aktivní"')
  ok(pv.maCislo, 'a jsou u nich opravdová čísla v hodinách')
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Dlaždice přesunuté, nástěnka se načte celá')
process.exit(chyby ? 1 : 0)
