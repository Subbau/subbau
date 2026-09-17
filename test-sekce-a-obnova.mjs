// Dvě věci, co otravovaly denně:
//   • Přístupy po druhém otevření zůstaly na „Načítám…"
//   • znovunačtení stránky vždycky hodilo správce na nástěnku
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
ok(/delete tbody\.dataset\.accessHtml/.test(zdroj), 'poznámka o obsahu se zahodí spolu s „Načítám…"')
ok(/const POSLEDNI_SEKCE/.test(zdroj) && /function obnovPosledniSekci/.test(zdroj), 'appka si pamatuje otevřenou sekci')
ok(!/TAHLE_SEKCE_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Přístupy se musí načíst i podruhé')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.sv === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    const radku = () => document.querySelectorAll('#access-table tr').length
    const nacita = () => /Načítám/.test(document.getElementById('access-table')?.textContent || '')
    sv('pristupy'); await new Promise(r => setTimeout(r, 2200))
    const a = { radku: radku(), nacita: nacita() }
    sv('faktury'); await new Promise(r => setTimeout(r, 1200))
    sv('pristupy'); await new Promise(r => setTimeout(r, 2200))
    const b2 = { radku: radku(), nacita: nacita() }
    sv('smlouvy'); await new Promise(r => setTimeout(r, 1200))
    sv('pristupy'); await new Promise(r => setTimeout(r, 2200))
    const c = { radku: radku(), nacita: nacita() }
    return { a, b: b2, c }
  })
  ok(v.a.radku > 1 && !v.a.nacita, `napoprvé se Přístupy načtou (${v.a.radku} řádků)`)
  ok(v.b.radku > 1 && !v.b.nacita, `a napodruhé taky (${v.b.radku} řádků)`)
  ok(v.c.radku > 1 && !v.c.nacita, `i napotřetí (${v.c.radku} řádků)`)
  ok(v.b.radku === v.a.radku, 'a je jich pořád stejně')

  console.log('\n3) Po znovunačtení zůstat tam, kde jsem skončil')
  await p.evaluate(() => { sv('tymy') })
  await new Promise(r => setTimeout(r, 1500))
  await p.reload({ waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.sv === 'function', { timeout: 20000 })
  await new Promise(r => setTimeout(r, 3500))
  const kde = await p.evaluate(() => {
    const on = document.querySelector('#app .view.on')
    const nav = document.querySelector('.sb-a.on')
    return { sekce: on ? on.id : null, navText: (nav?.textContent || '').trim().slice(0, 20) }
  })
  ok(kde.sekce === 'v-tymy', `po obnovení jsem zpátky v Týmech (${kde.sekce})`)
  ok(/Týmy|Skupiny/i.test(kde.navText), `a v nabídce svítí ta správná položka („${kde.navText}")`)

  // kontrolní měření: z nástěnky se nikam neskáče
  await p.evaluate(() => { sv('dashboard') })
  await new Promise(r => setTimeout(r, 1200))
  await p.reload({ waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.sv === 'function', { timeout: 20000 })
  await new Promise(r => setTimeout(r, 3000))
  const kde2 = await p.evaluate(() => document.querySelector('#app .view.on')?.id)
  ok(kde2 === 'v-dashboard', `kontrolní měření: z nástěnky zůstanu na nástěnce (${kde2})`)
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Přístupy se načtou vždy a obnovení mě nechá, kde jsem byl')
process.exit(chyby ? 1 : 0)
