// Generování PDF výkazů má vlastní heslo — do appky může mít přístup víc lidí
// a ne každý má vidět, kdo kolik odpracoval. Dokud ale žádný přístup zadaný
// není, nesmí to nikomu překážet.
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
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-pristup-export-pdf.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód a migrace')
ok(/create table if not exists public\.export_access/.test(migrace), 'migrace zakládá tabulku přístupů')
ok(/password_hash text not null/.test(migrace), 'heslo se ukládá jen jako otisk')
ok(/enable row level security/.test(migrace) && /export_access_admin/.test(migrace), 'spravovat to smí jen správce')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'běží v transakci')
ok(/async function odemkniExportPdf/.test(zdroj), 'appka umí odemknout generování')
ok(/if \(!await odemkniExportPdf\(\)\)/.test(zdroj), 'a PDF za tým se bez toho nevygeneruje')
ok(/function addExportAccess/.test(zdroj) && /function removeExportAccess/.test(zdroj), 'přístupy jdou přidat i odebrat')
ok(!/TAKOVA_FUNKCE_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Jak se to chová')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  // prompt() v prohlížeči bez okna vrací null — obsloužíme ho sami
  let odpovedi = []
  p.on('dialog', async d => {
    if (d.type() === 'prompt') { const v = odpovedi.shift(); try { await d.accept(v == null ? '' : v) } catch (e) {} }
    else { try { await d.accept() } catch (e) {} }
  })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.odemkniExportPdf === 'function', { timeout: 20000 })

  // a) nikdo v seznamu → nezamyká se nic
  const bezPristupu = await p.evaluate(async () => {
    try { sessionStorage.removeItem('exportPdfUnlocked') } catch (e) {}
    await sb.from('export_access').delete().neq('email', '')
    return await odemkniExportPdf()
  })
  ok(bezPristupu === true, 'dokud nikdo v seznamu není, generování se nezamyká')

  // b) přidáme přístup → chce heslo
  await p.evaluate(async () => {
    try { sessionStorage.removeItem('exportPdfUnlocked') } catch (e) {}
    const h = await sha256Hex('tajne123')
    await sb.from('export_access').insert({ id: 'ea-zk-1', email: 'sef@ukazka.cz', password_hash: h, created_at: new Date().toISOString() })
  })

  // špatné heslo
  await p.evaluate(() => { try { sessionStorage.removeItem('exportPdfUnlocked') } catch (e) {} })
  odpovedi = ['sef@ukazka.cz', 'spatne']
  await p.evaluate(v => { window.__odp = v }, odpovedi)
  const spatne = await p.evaluate(async () => {
    const toasty = []; window.showToast = m => toasty.push(String(m))
    const r = await odemkniExportPdf()
    return { r, toasty }
  })
  ok(spatne.r === false, 'se špatným heslem se PDF nevygeneruje')
  ok(spatne.toasty.some(t => /Nesprávný/.test(t)), 'a řekne se to')

  // správné heslo
  odpovedi = ['sef@ukazka.cz', 'tajne123']
  const spravne = await p.evaluate(async () => {
    try { sessionStorage.removeItem('exportPdfUnlocked') } catch (e) {}
    window.showToast = () => {}
    return await odemkniExportPdf()
  })
  ok(spravne === true, 'se správným heslem to projde')

  const podruhe = await p.evaluate(async () => await odemkniExportPdf())
  ok(podruhe === true, 'a podruhé už se neptá (pamatuje si to do zavření appky)')

  await p.evaluate(async () => { await sb.from('export_access').delete().eq('id', 'ea-zk-1') })
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Generování PDF je pod heslem')
process.exit(chyby ? 1 : 0)
