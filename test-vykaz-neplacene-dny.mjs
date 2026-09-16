// Den označený „nedostane zaplaceno" má být ve výkazu vidět, ALE jeho hodiny
// musí v součtu zůstat — podle nich se fakturuje odběrateli. Kdyby se
// odečítaly, nesedělo by to, co podepsal Bauleiter, s naší fakturou.
// Označení je naše vnitřní věc, proto jde před odesláním ven vypnout.
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
ok(/function denJePlaceny\(r\) \{\s*\n\s*return !\(r && r\.bez_vyplaty\)/.test(zdroj), 'placenost dne řeší jedno místo')
ok(/function denMaProvizi\(r\) \{\s*\n\s*return !\(r && r\.bez_provize_den\)/.test(zdroj), 'provize za den taky')
ok(/function znackyVyjimekDne/.test(zdroj), 'a značky k dni se skládají na jednom místě')
ok(!/denSePocita|hodinyDoVykazu/.test(zdroj), 'hodiny se ze součtu neodečítají — podle nich se fakturuje')
ok(/tag: 'NEPLAC'/.test(zdroj), 'značky jdou před tiskem vypnout')
ok(!/ZNACKA_KTERA_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Výkaz za tým — všechny kombinace')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
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
    const tyden = document.getElementById('team-pdf-week-' + tymId)?.value
    if (!tyden) return { chyba: 'u týmu není žádný týden' }
    const [kw, rok] = tyden.split('/').map(Number)

    const soucet = (h) => [...h.matchAll(/font-size:14px;text-align:center">([\d.]+)<\/td>/g)]
      .map(x => Number(x[1])).reduce((a, c) => a + c, 0)
    const vykaz = async () => {
      html = ''
      try { await generateTeamAttendancePdf(tymId, 'Test') } catch (e) {}
      await new Promise(r => setTimeout(r, 1200))
      return html
    }

    const { data: clenove } = await sb.from('profiles').select('id').eq('team_id', tymId)
    const idsTymu = new Set((clenove || []).map(x => x.id))
    const { data: dny } = await sb.from('attendance').select('*')
      .eq('kw', kw).eq('kw_year', rok).not('total_hours', 'is', null).order('work_date')
    const den = (dny || []).find(d => Number(d.total_hours) > 0 && idsTymu.has(d.worker_id))
    if (!den) return { chyba: 'v tom týdnu není žádný den s hodinami' }

    const nastav = async (bv, bp) => {
      await sb.from('attendance').update({ bez_vyplaty: bv, bez_provize_den: bp }).eq('id', den.id)
      const h = await vykaz()
      return { neplaceno: /NEPLACENO/.test(h), bezProvize: /BEZ PROVIZE/.test(h),
               textOn: /nedostane zaplaceno/.test(h), textMy: /nedostaneme provizi/.test(h),
               soucet: soucet(h),
               bezZnacek: h.replace(/<!--NEPLAC-START-->[\s\S]*?<!--NEPLAC-END-->/g, '') }
    }

    const nic = await nastav(false, false)
    const jenOn = await nastav(true, false)
    const jenMy = await nastav(false, true)
    const oba = await nastav(true, true)
    await sb.from('attendance').update({ bez_vyplaty: false, bez_provize_den: false }).eq('id', den.id)
    window.showPrintPreview = puvodni
    return { hodinyDne: Number(den.total_hours), nic, jenOn, jenMy, oba }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.nic.soucet > 0, `kontrolní měření: výkaz se vygeneroval (${v.nic.soucet} h)`)
    ok(!v.nic.neplaceno && !v.nic.bezProvize, 'kontrolní měření: bez výjimek tam žádná značka není')

    ok(v.jenOn.neplaceno && !v.jenOn.bezProvize, 'ON nedostane zaplaceno → jen NEPLACENO')
    ok(v.jenOn.textOn && !v.jenOn.textMy, 'a poznámka mluví jen o něm')

    ok(!v.jenMy.neplaceno && v.jenMy.bezProvize, 'MY nedostaneme provizi → jen BEZ PROVIZE')
    ok(v.jenMy.textMy && !v.jenMy.textOn, 'a poznámka mluví jen o nás')

    ok(v.oba.neplaceno && v.oba.bezProvize, 'NEDOSTANE NIKDO → jsou vidět obě značky')
    ok(v.oba.textOn && v.oba.textMy, 'a poznámka vypisuje obě')

    const stejne = [v.nic, v.jenOn, v.jenMy, v.oba].map(x => x.soucet)
    ok(new Set(stejne).size === 1,
       `součet se u žádné kombinace nezměnil (${stejne.join(' / ')} h) — fakturuje se podle odpracovaných`)
    ok(!/NEPLACENO|BEZ PROVIZE|nedostane zaplaceno|nedostaneme provizi/.test(v.oba.bezZnacek),
       'zaškrtávátkem v náhledu všechny značky i poznámka zmizí (kopie pro odběratele)')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Neplacené dny jsou ve výkazu označené, ale hodiny v součtu zůstávají')
process.exit(chyby ? 1 : 0)
