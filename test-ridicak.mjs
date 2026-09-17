// Řidičský průkaz je nově mezi povinnými doklady (obě strany). Kdo ho nemá,
// zaškrtne „nejsem držitelem" a appka ho po něm přestane chtít.
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
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-ridicak.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód a migrace')
ok(/id:'ridicak'.*label:'Řidičský průkaz'.*required:true/.test(zdroj), 'řidičák je povinný doklad')
ok(/id:'ridicak'[^}]*twoSides:true/.test(zdroj), 'a chce se po obou stranách')
ok(/function povinneDokladyPro/.test(zdroj), 'povinné doklady se počítají pro konkrétního člověka')
ok((zdroj.match(/povinneDokladyPro\(/g) || []).length >= 4, 'a ptá se na to pracovník i správce')
ok(/add column if not exists bez_ridicaku boolean not null default false/.test(migrace), 'migrace přidává prohlášení')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'a běží v transakci')
ok(/function prohlasBezRidicaku/.test(zdroj), 'pracovník si to může zaškrtnout')
ok(/data\[0\]\.bez_ridicaku !== nema/.test(zdroj), 'a appka si ověří, že se to opravdu uložilo')
ok(!/TAHLE_VEC_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Jak se to chová')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.povinneDokladyPro === 'function', { timeout: 20000 })

  const v = await p.evaluate(() => {
    const beznyClovek = povinneDokladyPro({ id: 'x' })
    const bezRidicaku = povinneDokladyPro({ id: 'x', bez_ridicaku: true })
    const stareProfily = povinneDokladyPro({ id: 'x', bez_ridicaku: undefined })
    return {
      beznyMaRidicak: beznyClovek.includes('ridicak'),
      bezRidicakuNema: !bezRidicaku.includes('ridicak'),
      stareProfilyMaji: stareProfily.includes('ridicak'),
      ostatniZustaly: ['op', 'zivnost', 'a1'].every(t => bezRidicaku.includes(t)),
      popisek: (typeof docLabel === 'function') ? docLabel('ridicak') : ''
    }
  })
  ok(v.beznyMaRidicak === true, 'běžně se řidičák vyžaduje')
  ok(v.bezRidicakuNema === true, 'kdo prohlásí, že ho nemá, po tom se nechce')
  ok(v.stareProfilyMaji === true, 'bez spuštěné migrace se chce po všech (výchozí stav)')
  ok(v.ostatniZustaly === true, 'a ostatní povinné doklady zůstávají')
  ok(v.popisek === 'Řidičský průkaz', `doklad se jmenuje správně („${v.popisek}")`)
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Řidičák se vyžaduje, kdo ho nemá to řekne')
process.exit(chyby ? 1 : 0)
