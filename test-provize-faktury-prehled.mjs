// Tři doplňky, o které si řekla kancelář:
//   • v Provizích u jména i podskupina (jako v Týmech)
//   • ve Fakturách vidět, v jakém vzhledu je faktura vystavená
//   • a upozornění, že se z ní odečetla záloha
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
ok(/sb\.from\('subteams'\)\.select\('id, name'\)/.test(zdroj), 'Provize si načtou podskupiny')
ok(/podskupina: w\.subteam_id/.test(zdroj), 'a přiřadí je k lidem')
ok(/🎨 vzhled \$\{Number\(r\.design_idx\) \|\| 1\}/.test(zdroj), 've Fakturách je číslo vzhledu')
ok(/💰 záloha/.test(zdroj), 'a upozornění na zálohu')
ok(/'zálohová faktura'/.test(zdroj) && /'na účet' : 'hotově'/.test(zdroj),
   'u zálohy je i odkud přišla')
ok(!/TAHLE_VEC_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) V prohlížeči')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.loadWorkerInvoices === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    // ── Faktury: nastav u jedné vzhled a zálohu, ať je co měřit
    const { data: fa } = await sb.from('worker_invoices').select('id').limit(1)
    const f = (fa || [])[0]
    let pred = '', po = ''
    if (f) {
      sv('faktury-archiv'); await new Promise(r => setTimeout(r, 2000))
      pred = document.getElementById('inv-table')?.textContent || ''
      await sb.from('worker_invoices').update({ design_idx: 7, cash_paid: 250, cash_paid_typ: 'ucet' }).eq('id', f.id)
      await loadWorkerInvoices(); await new Promise(r => setTimeout(r, 1500))
      po = document.getElementById('inv-table')?.textContent || ''
      await sb.from('worker_invoices').update({ design_idx: null, cash_paid: 0, cash_paid_typ: null }).eq('id', f.id)
    }

    // ── Provize: podskupina u jména
    try { sessionStorage.setItem('provizeUnlocked', 'sef@ukazka.cz') } catch (e) {}
    // V ukázce nikdo v podskupině není — jednu si vyrobíme, ať je co měřit.
    // Musí to být člověk, který tenhle týden pracoval, jinak v Provizích není.
    const kw = getKW()
    const { data: dnyT } = await sb.from('attendance').select('worker_id')
      .eq('kw', kw.week).eq('kw_year', kw.year).not('total_hours', 'is', null).limit(20)
    const kdoId = (dnyT || []).map(d => d.worker_id)[0]
    let jmenoPodskupiny = ''
    let puvodniSub = null
    if (kdoId) {
      const { data: prof } = await sb.from('profiles').select('id, team_id, subteam_id').eq('id', kdoId).limit(1)
      puvodniSub = prof?.[0]?.subteam_id ?? null
      let { data: sty } = await sb.from('subteams').select('id, name').limit(1)
      if (!sty || !sty.length) {
        await sb.from('subteams').insert({ id: 'zk-sub-1', name: 'Parta Cihly', team_id: prof?.[0]?.team_id || null, is_active: true })
        sty = [{ id: 'zk-sub-1', name: 'Parta Cihly' }]
      }
      jmenoPodskupiny = sty[0].name
      await sb.from('profiles').update({ subteam_id: sty[0].id }).eq('id', kdoId)
    }
    sv('provize'); await new Promise(r => setTimeout(r, 3000))
    const provizeText = document.getElementById('provize-content')?.textContent || ''

    if (kdoId) await sb.from('profiles').update({ subteam_id: puvodniSub }).eq('id', kdoId)
    return { maVzhled: /vzhled 7/.test(po), melVzhledPred: /vzhled 7/.test(pred),
             maZalohu: /záloha 250,00 € · na účet/.test(po),
             jmenoPodskupiny, maPodskupinu: !!jmenoPodskupiny && provizeText.includes(jmenoPodskupiny),
             provizeMaObsah: provizeText.length > 300 }
  })

  ok(v.melVzhledPred === false, 'kontrolní měření: před nastavením tam „vzhled 7" není')
  ok(v.maVzhled === true, 'v přehledu faktur je vidět číslo vzhledu')
  ok(v.maZalohu === true, 'i záloha a odkud přišla')
  ok(v.provizeMaObsah === true, 'kontrolní měření: Provize se vykreslily')
  if (v.jmenoPodskupiny) {
    ok(v.maPodskupinu === true, `u jména je podskupina („${v.jmenoPodskupiny}")`)
  } else {
    ok(true, 'v ukázce nikdo nemá podskupinu — nebylo co ověřit')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Podskupiny, vzhled i záloha jsou vidět')
process.exit(chyby ? 1 : 0)
