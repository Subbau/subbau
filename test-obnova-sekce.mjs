// Po úpravě se změna musí propsat i do sekce, kterou má správce otevřenou —
// bez ručního načítání stránky. Dřív to uměly jen některé dvojice
// (např. docházka × Docházka), a kdo byl v kalendáři nebo v Provizích, měl smůlu.
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
ok(/function obnovOtevrenouSekci/.test(zdroj), 'existuje obnova otevřené sekce')
ok((zdroj.match(/obnovOtevrenouSekci\(\)/g) || []).length >= 3,
   'volá se z realtime i po ruční úpravě docházky')
ok(/if \(_adminEditInProgress\(\)\) \{ setTimeout\(obnovOtevrenouSekci, 4000\); return \}/.test(zdroj),
   'rozepsaný formulář se nepřepíše pod rukama')
ok(!/TOHLE_TAM_URCITE_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) V prohlížeči — úprava hodin se propíše do otevřené sekce')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.obnovOtevrenouSekci === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    // Stůjme v Provizích — tam se změna docházky dřív nepropsala vůbec.
    // Provize jsou za vlastním heslem. Odemkneme je jako po zadání hesla,
    // ať se obnova sekce chová přesně jako u správce, který je má otevřené.
    try { sessionStorage.setItem("provizeUnlocked", "sef@ukazka.cz") } catch (e) {}
    sv("provize"); await new Promise(r => setTimeout(r, 3000))
    const hodinyVPrehledu = () => {
      const t = document.getElementById('provize-content')?.textContent || ''
      const m = t.match(/Hodiny tento týden[^\d]*([\d.,]+)h/)
      return m ? Number(m[1].replace(',', '.')) : null
    }
    const pred = hodinyVPrehledu()
    if (pred == null) return { chyba: 'hodiny za týden se v Provizích nenašly' }

    // uprav někomu hodiny na tenhle týden
    const kw = getKW()
    const { data: dny } = await sb.from('attendance').select('*')
      .eq('kw', kw.week).eq('kw_year', kw.year).not('total_hours', 'is', null).limit(1)
    const den = (dny || [])[0]
    if (!den) return { chyba: 'tenhle týden nemá nikdo zapsané hodiny' }
    const puvodni = Number(den.total_hours)
    await sb.from('attendance').update({ total_hours: puvodni + 5 }).eq('id', den.id)

    // tohle appka dělá po ruční úpravě docházky
    await refreshAttendanceEverywhere(den.worker_id)
    await new Promise(r => setTimeout(r, 2500))
    const po = hodinyVPrehledu()

    await sb.from('attendance').update({ total_hours: puvodni }).eq('id', den.id)
    return { pred, po, puvodni, porad: document.querySelector('#app .view.on')?.id }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.pred > 0, `kontrolní měření: Provize ukazují hodiny za týden (${v.pred}h)`)
    ok(v.po === v.pred + 5, `změna hodin se propsala bez načtení stránky (${v.pred}h → ${v.po}h)`)
    ok(v.porad === 'v-provize', 'a zůstal jsem v Provizích, nikam mě to nepřehodilo')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Změny se propisují do otevřené sekce samy')
process.exit(chyby ? 1 : 0)
