// Poloha při odchodu: zaznamená se, ale vidí ji POUZE správce v docházce.
// Do výkazů ani do odkazu pro odběratele se nesmí dostat — tam platí adresa
// z příchodu. Smysl: poznat, když někdo odejde ze stavby dřív a odchod
// odklikne až jinde.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const UKAZKA = path.join(D, 'ukazka.html')
const API = fs.readFileSync(path.join(D, 'api', 'klient-dochazka.js'), 'utf8')
function stejnaVerze() {
  const v = s => (fs.readFileSync(s, 'utf8').match(/SUBBAU_VERZE\s*=\s*'([^']+)'/) || [])[1]
  const a = v(APP), b = v(UKAZKA)
  if (!a || a !== b) { console.error(`❌ ukázka je stará (appka ${a}, ukázka ${b}) — spusť node ukazka/generuj.mjs`); process.exit(1) }
}
const zdroj = fs.readFileSync(APP, 'utf8')
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-gps-pri-odchodu.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Migrace a kód')
ok(/add column if not exists odchod_lat/.test(migrace) && /odchod_adresa\s+text/.test(migrace),
   'migrace přidává sloupce pro polohu při odchodu')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'běží v transakci')
ok(/function zachytPolohuOdchodu/.test(zdroj), 'appka polohu při odchodu zachytává')
ok((zdroj.match(/zachytPolohuOdchodu\(/g) || []).length === 3,
   'a volá se na obou cestách odchodu (přímý i s dopsáním popisu)')
ok(/function odchodPolohaHtml/.test(zdroj), 'a ukazuje ji')

console.log('\n2) NESMÍ TO NIKAM UNIKNOUT')
ok(!/odchod_/.test(API), 'odkaz pro odběratele o té poloze vůbec neví')
ok((zdroj.match(/odchodPolohaHtml\(/g) || []).length === 2,
   'zobrazuje se jen na JEDNOM místě (definice + jediné volání)')
{
  // PDF výkazy staví HTML kolem attDisplaySite — tam se to volat nesmí
  const mistaPDF = ['async function generateTeamAttendancePdf', 'async function exportWorkerKW']
  let cisto = true
  for (const m of mistaPDF) {
    const i = zdroj.indexOf(m)
    if (i < 0) continue
    if (/odchod_|odchodPolohaHtml/.test(zdroj.slice(i, i + 30000))) cisto = false
  }
  ok(cisto, 'v PDF výkazech se poloha při odchodu nikde nepoužívá')
}
ok(/Vidí to jen SubBau/.test(zdroj), 'a je u toho napsané, že to vidí jen SubBau')
ok(!/TAHLE_VETA_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n3) Jak to vypadá správci v kartě pracovníka')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.odchodPolohaHtml === 'function', { timeout: 20000 })

  const v = await p.evaluate(() => {
    const bezPolohy = odchodPolohaHtml({ location_address: 'Ahornallee 9, Berlin' })
    const stejne = odchodPolohaHtml({ location_address: 'Ahornallee 9, Berlin',
      odchod_adresa: 'Ahornallee 9, Berlin', odchod_lat: 52.5, odchod_lng: 13.4 })
    const jinde = odchodPolohaHtml({ location_address: 'Ahornallee 9, Berlin',
      odchod_adresa: 'Hlavní 1, Praha', odchod_lat: 50.08, odchod_lng: 14.43 })
    return { bezPolohy, stejne, jinde }
  })

  ok(v.bezPolohy === '', 'u dne bez zachycené polohy se nic nepřidává')
  ok(/odchod:/.test(v.stejne) && /Ahornallee 9, Berlin/.test(v.stejne), 'když odešel tam, kde přišel, poloha se ukáže v klidu')
  ok(/var\(--text3\)/.test(v.stejne) && !/⚠️/.test(v.stejne), 'a není u toho vykřičník')
  ok(/⚠️/.test(v.jinde) && /var\(--red\)/.test(v.jinde),
     'když odešel JINDE, svítí to červeně s vykřičníkem')
  ok(/google\.com\/maps\?q=50\.08,14\.43/.test(v.jinde), 'a jde kliknout na mapu')
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Poloha při odchodu je vidět jen správci')
process.exit(chyby ? 1 : 0)
