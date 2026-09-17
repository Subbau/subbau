// Peníze u firem se zaměstnanci. Nejdůležitější je, že se NESMÍ změnit
// ani cent u lidí, kteří pracují sami na sebe — proto se měří obojí:
// nejdřív stav bez firmy, pak s firmou, a porovná se.
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
ok(/const komuProvize = firmaId \|\| a\.worker_id/.test(zdroj), 'provize se počítá sazbou firmy')
ok(/const sazbaDen = \(firmaId \|\| a\.bez_vyplaty\)/.test(zdroj), 'zaměstnanec firmy nemá sazbu')
ok(/const penize = firmaId \? byWorker\[firmaId\] : bucket/.test(zdroj), 'peníze jdou firmě, hodiny pracovníkovi')
ok(/!r\.zamestnavatel$/m.test(zdroj) || /&& !r\.zamestnavatel/.test(zdroj), 'zaměstnanec nečeká na nastavení sazby')
ok(!/TAHLE_PROMENNA_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Spočítané peníze')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.renderProvizeContent === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    try { sessionStorage.setItem('provizeUnlocked', 'sef@ukazka.cz') } catch (e) {}

    const kw = getKW()
    const { data: dny } = await sb.from('attendance').select('worker_id, total_hours')
      .eq('kw', kw.week).eq('kw_year', kw.year).not('total_hours', 'is', null)
    // dva lidi, co tenhle týden pracovali
    const kdo = [...new Set((dny || []).map(d => d.worker_id))]
    if (kdo.length < 2) return { chyba: 'málo lidí s hodinami tenhle týden' }
    const firmaId = kdo[0], zamId = kdo[1]
    const hodinZam = (dny || []).filter(d => d.worker_id === zamId)
      .reduce((s2, d) => s2 + Number(d.total_hours || 0), 0)

    // ať mají obojí nastavenou provizi i sazbu
    await sb.from('worker_commissions').upsert({ worker_id: firmaId, provize: 4 }, { onConflict: 'worker_id' })
    await sb.from('worker_commissions').upsert({ worker_id: zamId, provize: 9 }, { onConflict: 'worker_id' })
    await sb.from('profiles').update({ hourly_rate_worker: 25, zamestnavatel_id: null, supplier_type: null }).eq('id', zamId)
    await sb.from('profiles').update({ zamestnavatel_id: null }).eq('id', firmaId)

    const cti = async () => {
      await renderProvizeContent(); await new Promise(r => setTimeout(r, 1300))
      const idx = window._provizeIndex || {}
      const cislo = (id2, pole) => {
        const el = document.getElementById(pole + id2)
        if (!el) return null
        return Number((el.textContent || '').replace(/[^\d,.-]/g, '').replace(',', '.'))
      }
      return {
        zamProvize: cislo(zamId, 'pv-w-'), zamVydelek: cislo(zamId, 'pv-e-'),
        firmaProvize: cislo(firmaId, 'pv-w-'),
        zamHodiny: (idx[zamId] || {}).hoursWeek ?? null
      }
    }

    const pred = await cti()

    // ── teď z prvního uděláme firmu a druhého pod ni zařadíme ──
    await sb.from('profiles').update({ supplier_type: 'sro', company_name: 'Stavby Novák s.r.o.' }).eq('id', firmaId)
    await sb.from('profiles').update({ zamestnavatel_id: firmaId }).eq('id', zamId)
    const po = await cti()

    // uklidit
    await sb.from('profiles').update({ supplier_type: null, company_name: null }).eq('id', firmaId)
    await sb.from('profiles').update({ zamestnavatel_id: null }).eq('id', zamId)
    const zpet = await cti()

    const text = document.getElementById('provize-content')?.textContent || ''
    return { pred, po, zpet, hodinZam, text: text.slice(0, 0),
             maPilulkuFirma: /🏢 firma/.test(document.getElementById('provize-content')?.innerHTML || ''),
             idFirmy: firmaId }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.pred.zamProvize > 0, `kontrolní měření: před zařazením má vlastní provizi (${v.pred.zamProvize} €)`)
    ok(v.pred.zamVydelek > 0, `a vlastní výdělek (${v.pred.zamVydelek} €)`)
    ok(v.po.zamProvize === 0, `po zařazení pod firmu má provizi 0 (${v.po.zamProvize} €)`)
    ok(v.po.zamVydelek === 0, `a výdělek 0 — platí ho firma (${v.po.zamVydelek} €)`)
    ok(v.po.zamHodiny === v.pred.zamHodiny,
       `ale hodiny mu zůstaly (${v.pred.zamHodiny} → ${v.po.zamHodiny} h)`)
    ok(v.po.firmaProvize > v.pred.firmaProvize,
       `firmě provize narostla o jeho hodiny (${v.pred.firmaProvize} € → ${v.po.firmaProvize} €)`)
    ok(v.zpet.zamProvize === v.pred.zamProvize && v.zpet.zamVydelek === v.pred.zamVydelek,
       'po vyřazení z firmy je všechno zpátky, jak bylo')
    ok(v.zpet.firmaProvize === v.pred.firmaProvize, 'i u firmy — ani cent navíc')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Zaměstnanci nemají peníze, provize jde firmě')
process.exit(chyby ? 1 : 0)
