// Dvě věci, na které si stěžovala kancelář:
//   1) tlačítko „Uložit změny" reagovalo jen v jednom bodě
//   2) adresu stavby nešlo přepsat
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
ok(/position:sticky;bottom:-28px/.test(zdroj), 'lišta s tlačítky je přilepená ke spodku okna')
ok(!/if \(siteWrap\) siteWrap\.style\.display = 'none'/.test(zdroj), 'pole Stavba se už nikde neschovává')
ok(/dotknuto !== '1'\) siteEl\.value/.test(zdroj), 'rozepsanou adresu nepřepíše dotaz, co doběhne později')
ok(!/TOHLE_V_KODU_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) V prohlížeči — na nižším displeji, kde to vadilo')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  await p.setViewport({ width: 1400, height: 820 })   // nižší obrazovka, tam to zlobilo
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.editAttRecord === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    const { data: dny } = await sb.from('attendance').select('*')
      .not('check_out', 'is', null).not('location_address', 'is', null).limit(1)
    const den = (dny || [])[0] || (await sb.from('attendance').select('*').not('check_out', 'is', null).limit(1)).data[0]
    // ať má ten den GPS adresu — dřív se kvůli ní pole Stavba schovalo
    await sb.from('attendance').update({ location_address: 'GPS Testovací 1, München', address_source: 'gps' }).eq('id', den.id)
    editAttRecord(den.id, String(den.work_date).slice(0, 10), '07:00', '16:00', '11:00', '11:30')
    await new Promise(r => setTimeout(r, 1800))

    const btn = [...document.querySelectorAll('#edit-att-modal button')].find(x => /Uložit změny/.test(x.textContent || ''))
    const rc = btn.getBoundingClientRect()
    const body = []
    for (const dy of [0.15, 0.5, 0.85]) for (const dx of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const el = document.elementFromPoint(rc.left + rc.width * dx, rc.top + rc.height * dy)
      body.push(!!el && (el === btn || btn.contains(el)))
    }

    const site = document.getElementById('edit-att-site')
    const viditelne = site && site.offsetParent !== null
    // zkus adresu přepsat a uložit
    site.value = 'Ručně přepsaná stavba'
    site.dispatchEvent(new Event('input'))
    await saveEditAttRecord()
    await new Promise(r => setTimeout(r, 1500))
    const z = (await sb.from('attendance').select('*').eq('id', den.id)).data[0]
    return { vsudeKlikatelne: body.every(Boolean), kolikBodu: body.length,
             poleViditelne: !!viditelne, ulozeno: z.construction_site,
             tlacitkoVOkne: rc.top >= 0 && rc.bottom <= innerHeight }
  })

  ok(v.tlacitkoVOkne === true, 'tlačítko je celé v okně, ne pod ohybem')
  ok(v.vsudeKlikatelne === true, `a reaguje po celé ploše (${v.kolikBodu} bodů)`)
  ok(v.poleViditelne === true, 'pole Stavba je vidět i u dne, který má GPS adresu')
  ok(v.ulozeno === 'Ručně přepsaná stavba', `a ručně zapsaná adresa se uloží (${v.ulozeno})`)
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Tlačítko jde zmáčknout a adresa přepsat')
process.exit(chyby ? 1 : 0)
