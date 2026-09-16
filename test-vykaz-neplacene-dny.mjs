// Den označený „nedostane zaplaceno" má ve výkazu ZŮSTAT vidět (pracovník tam
// ten den byl), ale jeho hodiny se nesmí počítat do součtu. A musí být napsané,
// že se nepočítají — jinak si toho vedoucí při podpisu nevšimne.
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
ok(/function denSePocita\(r\) \{\s*\n\s*return !\(r && r\.bez_vyplaty\)/.test(zdroj),
   'o započítání dne rozhoduje jedno místo')
ok((zdroj.match(/denSePocita\(/g) || []).length >= 6, 'a ptají se ho všechny výkazy')
ok(!/NEPOCITA_SE_NIKDE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Výkaz za tým')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.generateTeamAttendancePdf === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    let html = ''
    const puvodni = window.showPrintPreview
    window.showPrintPreview = (h) => { html = String(h || '') }
    sv('tymy'); await new Promise(r => setTimeout(r, 2000))
    const tlac = document.querySelector('[onclick*="generateTeamAttendancePdf"]')
    const tymId = (tlac?.getAttribute('onclick') || '').match(/generateTeamAttendancePdf\('([^']+)'/)?.[1]
    const sel = document.getElementById('team-pdf-week-' + tymId)
    const tyden = sel?.value
    if (!tyden) return { chyba: 'u týmu není žádný týden' }
    const [kw, rok] = tyden.split('/').map(Number)

    const soucet = (h) => {
      const m = [...h.matchAll(/font-size:14px;text-align:center">([\d.]+)<\/td>/g)].map(x => Number(x[1]))
      return m.reduce((a, c) => a + c, 0)
    }
    const vykaz = async () => {
      html = ''
      try { await generateTeamAttendancePdf(tymId, 'Test') } catch (e) {}
      await new Promise(r => setTimeout(r, 1200))
      return html
    }

    const pred = await vykaz()
    // označ jeden odpracovaný den jako neplacený
    // Musí to být den NĚKOHO Z TOHO TÝMU, jinak se ve výkazu vůbec neobjeví.
    const { data: clenove } = await sb.from('profiles').select('id').eq('team_id', tymId)
    const idsTymu = new Set((clenove || []).map(x => x.id))
    const { data: dny } = await sb.from('attendance').select('*')
      .eq('kw', kw).eq('kw_year', rok).not('total_hours', 'is', null).order('work_date')
    const den = (dny || []).find(d => Number(d.total_hours) > 0 && idsTymu.has(d.worker_id))
    if (!den) return { chyba: 'v tom týdnu není žádný den s hodinami' }
    await sb.from('attendance').update({ bez_vyplaty: true }).eq('id', den.id)
    const po = await vykaz()
    await sb.from('attendance').update({ bez_vyplaty: false }).eq('id', den.id)
    const zpet = await vykaz()
    window.showPrintPreview = puvodni

    return { hodinyDne: Number(den.total_hours),
             soucetPred: soucet(pred), soucetPo: soucet(po), soucetZpet: soucet(zpet),
             maNeplaceno: /NEPLACENO/.test(po), melNeplacenoPred: /NEPLACENO/.test(pred),
             maVetu: /do součtu se nepočítají/.test(po),
             denJeVidet: po.length > 500 }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.soucetPred > 0, `kontrolní měření: výkaz se vygeneroval a má součet (${v.soucetPred} h)`)
    ok(v.melNeplacenoPred === false, 'kontrolní měření: před označením tam žádné NEPLACENO není')
    ok(v.maNeplaceno === true, 'označený den je ve výkazu vidět a je u něj NEPLACENO')
    ok(v.maVetu === true, 'a je napsané, že se tyhle dny do součtu nepočítají')
    const rozdil = Math.round((v.soucetPred - v.soucetPo) * 100) / 100
    ok(rozdil === Math.round(v.hodinyDne * 100) / 100,
       `součet klesl přesně o hodiny toho dne (${v.soucetPred} → ${v.soucetPo}, den měl ${v.hodinyDne} h)`)
    ok(v.soucetZpet === v.soucetPred, `po odškrtnutí se součet vrátí (${v.soucetZpet})`)
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Neplacené dny se ve výkazu nepočítají, ale jsou vidět')
process.exit(chyby ? 1 : 0)
