// Kalendář: tři týdny dopředu místo dvou, a hlavně — ať přestane blikat.
// Blikání dělalo tiché obnovování každých 60 s, které kalendář překreslilo
// celý znovu, i když se nezměnilo vůbec nic.
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
ok(/end\.setDate\(start\.getDate\(\)\+20\)/.test(zdroj), 'načítají se tři týdny, ne dva')
ok(/const week3Start = new Date\(start\); week3Start\.setDate\(start\.getDate\(\)\+14\)/.test(zdroj),
   'třetí týden začíná o 14 dní později')
ok(/buildWeekTable\(week3Start\)/.test(zdroj), 'a opravdu se vykresluje')
ok(/Za dva týdny/.test(zdroj), 'má svůj nadpis')
ok(/async function renderCalendar\(tichy\)/.test(zdroj), 'kalendář umí tichý režim')
ok(/if \(!tichy\) content\.innerHTML = '<div style="text-align:center;color:var\(--text3\);padding:20px">Načítám/.test(zdroj),
   'v tichém režimu se neukazuje „Načítám…" (to bylo to bliknutí)')
ok(/renderCalendar\(true\)/.test(zdroj), 'tiché obnovování ho volá tiše')
ok(/function zapisKalendar/.test(zdroj) && /el\.__kalHtml === html/.test(zdroj),
   'stejný obsah se do stránky vůbec nezapisuje')
ok((zdroj.match(/zapisKalendar\(content/g) || []).length >= 3,
   'všechna místa, která kalendář kreslí, jdou přes tu pojistku')
ok(/padding:5px 10px;\$\{indent\}/.test(zdroj), 'řádky pracovníků jsou užší')
ok(/border-radius:6px;padding:6px 1px/.test(zdroj), 'a buňky dnů taky')
ok(/border-bottom:3px solid var\(--amber/.test(zdroj), 'čára pod firmou je výraznější')
ok(!/TAKOVY_KOD_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — opravdu se nepřekresluje nadarmo')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 25000 })
  await p.waitForFunction(() => typeof window.zapisKalendar === 'function', { timeout: 20000 })

  const v = await p.evaluate(() => {
    const out = {}
    const el = document.createElement('div')
    document.body.appendChild(el)

    zapisKalendar(el, '<b>ahoj</b>')
    const prvni = el.firstChild
    out.zapsalo = el.innerHTML

    // Druhý zápis TÉHOŽ obsahu nesmí sáhnout na DOM — poznáme to podle toho,
    // že uzel zůstane doslova tentýž objekt, ne nově vytvořený.
    zapisKalendar(el, '<b>ahoj</b>')
    out.stejnyUzel = (el.firstChild === prvni)

    // Jiný obsah se zapsat MUSÍ, jinak by kalendář zamrzl na starých datech.
    zapisKalendar(el, '<b>nazdar</b>')
    out.zmenilo = el.innerHTML
    out.jinyUzel = (el.firstChild !== prvni)

    el.remove()
    return out
  })

  ok(v.zapsalo === '<b>ahoj</b>', 'první zápis projde')
  ok(v.stejnyUzel === true, 'stejný obsah podruhé už nic nepřepisuje — tady bylo to blikání')
  ok(v.zmenilo === '<b>nazdar</b>' && v.jinyUzel === true,
     'změněný obsah se zapíše (kontrolní měření — jinak by kalendář zamrzl)')
  ok(padky.length === 0, 'stránka nespadla' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Kalendář: tři týdny a bez blikání')
process.exit(chyby ? 1 : 0)
