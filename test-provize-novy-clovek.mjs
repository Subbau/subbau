// Kdo se přidá do skupiny, musí být hned v Provizích — i když ještě
// neodpracoval ani hodinu. Jinak není kde mu nastavit sazbu a provizi.
// Jakmile má obojí, ze seznamu zase zmizí jako ostatní.
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
ok(/const sazbaNenastavena = w\.hourly_rate_worker == null \|\| w\.hourly_rate_worker === ''/.test(zdroj),
   'appka rozlišuje „sazba nenastavená" od „sazba nula"')
ok(/const provizeNenastavena = provMap\[w\.id\] == null \|\| provMap\[w\.id\] === ''/.test(zdroj),
   'a u provize taky')
ok(/&& \(r\.sazbaNenastavena \|\| r\.provizeNenastavena\)/.test(zdroj),
   'podle toho se rozhoduje, kdo čeká na nastavení')
ok(/maFirmu: !!w\.team_id,/.test(zdroj),
   'stačí zařazení do skupiny — dřív se vyžadovala i navázaná firma')
ok(!/r\.rate == null \|\| r\.rate === ''/.test(zdroj),
   'starý způsob, který kvůli „|| 0" nikdy nezabral, je pryč')
ok(!/SAZBA_KTERA_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — přidám člověka do skupiny a musí naskočit')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1500))

  const v = await p.evaluate(async () => {
    const out = {}
    const sekce = document.getElementById('v-provize')
    if (!sekce) return { chyba: 'sekce Provize nenalezena' }
    document.querySelectorAll('.view').forEach(x => x.classList.remove('on'))
    sekce.classList.add('on'); sekce.style.display = 'block'
    const zamek = document.getElementById('provize-lock'); if (zamek) zamek.style.display = 'none'
    try { localStorage.removeItem(PROVIZE_FILTR_KLIC) } catch (e) {}

    const { data: tymy } = await sb.from('teams').select('id, name, company_id')
    const tym = (tymy || [])[0]
    out.mameTym = !!tym

    await renderProvizeContent()
    await new Promise(r => setTimeout(r, 700))
    out.predPridanim = sekce.textContent.includes('Zkušební Novák')

    const novyId = 'zkouska-novy-' + Date.now()
    await sb.from('profiles').insert({
      id: novyId, full_name: 'Zkušební Novák', role: 'osvec', is_active: true,
      team_id: tym ? tym.id : null, hourly_rate_worker: null
    })
    await renderProvizeContent()
    await new Promise(r => setTimeout(r, 700))
    out.poPridani = sekce.textContent.includes('Zkušební Novák')

    // jen sazba nestačí — dokud nemá i provizi, má zůstat vidět
    await sb.from('profiles').update({ hourly_rate_worker: 22 }).eq('id', novyId)
    await renderProvizeContent()
    await new Promise(r => setTimeout(r, 700))
    out.jenSazba = sekce.textContent.includes('Zkušební Novák')

    // teprve s obojím zmizí
    await sb.from('worker_commissions').upsert({ worker_id: novyId, provize: 3 }, { onConflict: 'worker_id' })
    await renderProvizeContent()
    await new Promise(r => setTimeout(r, 700))
    out.obojiNastaveno = sekce.textContent.includes('Zkušební Novák')
    return out
  })

  if (v.chyba) { chyby++; console.log('  ❌ ' + v.chyba) }
  else {
    ok(v.mameTym, 'v ukázce je aspoň jedna skupina')
    ok(v.predPridanim === false, 'před přidáním tam ten člověk není (kontrolní měření)')
    ok(v.poPridani === true, 'po zařazení do skupiny je v Provizích hned, bez jediné odpracované hodiny')
    ok(v.jenSazba === true, 'se samotnou sazbou tam zůstane — chybí mu ještě provize')
    ok(v.obojiNastaveno === false, 'až má sazbu i provizi, ze seznamu zmizí jako ostatní')
    ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
  }
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Nový člověk se v Provizích objeví hned')
process.exit(chyby ? 1 : 0)
