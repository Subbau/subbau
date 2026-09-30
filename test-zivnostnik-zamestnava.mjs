// Šéfem může být i živnostník, ne jen s.r.o. (majitel 1. 10. 2026: „neumím zadat
// roli zaměstnance, nemůžu nikde najít… s.r.o. ten člověk nebo živnostník
// klidně, ale že ten člověk zaměstnává dalšího člověka"). Nastavuje se nahoře
// v Profilu karty — oběma směry — a faktura i provize jdou přes šéfa.
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
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 90000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.vyberZamestnance === 'function' && typeof window.renderProvizeContent === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => toasty.push(String(m))
    try { sessionStorage.setItem('provizeUnlocked', 'sef@ukazka.cz') } catch (e) {}
    const cekej = ms => new Promise(r => setTimeout(r, ms))
    const kw = getKW()
    const { data: dny } = await sb.from('attendance').select('worker_id, total_hours')
      .eq('kw', kw.week).eq('kw_year', kw.year).not('total_hours', 'is', null)
    const kdo = [...new Set((dny || []).map(d => d.worker_id))]
    if (kdo.length < 3) return { chyba: 'málo lidí s hodinami tenhle týden' }
    const [sefId, zamId, firmaId] = kdo
    const soucet = id => (dny || []).filter(d => d.worker_id === id).reduce((s, d) => s + Number(d.total_hours || 0), 0)
    const jmeno = async id => ((await sb.from('profiles').select('full_name').eq('id', id).maybeSingle()).data || {}).full_name
    const jmSefa = await jmeno(sefId), jmZam = await jmeno(zamId), jmFirmy = await jmeno(firmaId)
    // Výchozí stav: nikdo pod nikým, šéf je obyčejný živnostník, třetí je firma (s.r.o.)
    for (const id of kdo) await sb.from('profiles').update({ zamestnavatel_id: null }).eq('id', id)
    await sb.from('profiles').update({ supplier_type: null, company_name: null }).eq('id', sefId)
    await sb.from('profiles').update({ supplier_type: 'sro', company_name: 'Stavby Test s.r.o.' }).eq('id', firmaId)
    const radek = () => (document.getElementById('wd-zam-radek')?.textContent || '').replace(/\s+/g, ' ').trim()
    const radekVidet = () => getComputedStyle(document.getElementById('wd-zam-radek')).display !== 'none'
    const out = { jmSefa, jmZam }

    // 1) Karta šéfa: nahoře v Profilu je vidět, že pracuje sám na sebe, a jde to změnit
    await openWorkerModal(sefId); await cekej(1200)
    out.predVidet = radekVidet(); out.pred = radek()
    out.tlacitka = [...document.querySelectorAll('#wd-zam-radek button')].map(x => x.textContent.trim())

    // 2) „Zaměstnává někoho" → výběr lidí; firma (s.r.o.) ani on sám v nabídce nejsou
    await vyberZamestnance(sefId); await cekej(600)
    const ov = document.getElementById('zam-overlay')
    const volby = ov ? [...ov.querySelectorAll('[data-seznam] label')].map(l => ({ id: l.querySelector('input').value, text: l.textContent.replace(/\s+/g, ' ').trim() })) : []
    out.nabidkaMaZam = volby.some(o => o.id === zamId)
    out.nabidkaMaFirmu = volby.some(o => o.id === firmaId)
    out.nabidkaMaSebe = volby.some(o => o.id === sefId)
    // hledání
    const hl = ov?.querySelector('[data-hledat]')
    if (hl) { hl.value = String(jmZam).split(' ')[0].toLowerCase(); hl.dispatchEvent(new Event('input')) }
    out.poHledani = ov ? [...ov.querySelectorAll('[data-seznam] label')].filter(l => l.style.display !== 'none').length : 0
    const zaskrtni = ov?.querySelector(`[data-seznam] input[value="${zamId}"]`)
    if (zaskrtni) zaskrtni.checked = true
    ov?.querySelector('[data-ulozit]')?.click(); await cekej(1500)
    out.zapsano = ((await sb.from('profiles').select('zamestnavatel_id').eq('id', zamId).maybeSingle()).data || {}).zamestnavatel_id
    out.idSefa = sefId
    out.poUlozeni = radek()
    out.toastPoUlozeni = toasty.slice(-1)[0] || ''

    // 3) Karta zaměstnance: nahoře, pod kým pracuje
    await openWorkerModal(zamId); await cekej(1200)
    out.uZam = radek()
    // „Pod kým pracuje" (z Provizí i z karty) nabízí i živnostníka, firmu napřed
    await vyberSefa(zamId); await cekej(600)
    const so = document.getElementById('sef-overlay')
    out.sefVolby = so ? [...so.querySelectorAll('label')].map(l => l.textContent.replace(/\s+/g, ' ').trim()) : []
    so?.remove()
    // Zaměstnanec sám nikoho zaměstnávat nemůže
    toasty.length = 0
    await vyberZamestnance(zamId); await cekej(400)
    out.zamNemuze = !document.getElementById('zam-overlay') && /je sám zaměstnanec/.test(toasty.join(' '))
    document.getElementById('zam-overlay')?.remove()

    // 4) Záložka Fakturace u šéfa: nabídka zamčená a napsané, koho zaměstnává;
    //    v týdnech k faktuře jsou i hodiny zaměstnance
    await openWorkerModal(sefId); await cekej(1200)
    wdTab('finance', document.querySelector('.wd-tab[onclick*="finance"]')); await cekej(1800)
    out.fakturaceZamceno = document.getElementById('wd-zamestnavatel')?.disabled === true
    out.fakturaceInfo = document.getElementById('wd-zamestnavatel-info')?.textContent || ''
    const opt = [...(document.getElementById('wd-inv-week')?.options || [])].find(o => o.value === kw.week + '/' + kw.year)
    out.tydenText = opt ? opt.textContent : ''
    out.hSefa = soucet(sefId); out.hZam = soucet(zamId)
    const rows = await dochazkaProFakturu(sefId, kw.week, kw.year)
    out.fakturaLide = [...new Set(rows.map(r => r.worker_id))].sort()
    out.ocekavaniLide = [sefId, zamId].sort()

    // 5) Provize: u šéfa pilulka „zaměstnává", tlačítko „zaměstnanec?" u něj není
    closeWorkerModal && closeWorkerModal()
    await renderProvizeContent(); await cekej(1500)
    const trSefa = document.getElementById('pv-w-' + sefId)?.closest('tr')
    const trZam = document.getElementById('pv-w-' + zamId)?.closest('tr')
    out.provizePilulka = trSefa ? /zaměstnává 1 člověka/.test(trSefa.textContent) : false
    out.provizeBezTlacitka = trSefa ? ![...trSefa.querySelectorAll('button')].some(x => /zaměstnanec\?/.test(x.textContent)) : false
    out.provizeZamPodSefem = trZam ? /u firmy|platí ho firma/.test(trZam.textContent) : false

    // 6) Z karty šéfa zase odebrat
    await vyberZamestnance(sefId); await cekej(600)
    const ov2 = document.getElementById('zam-overlay')
    const z2 = ov2?.querySelector(`[data-seznam] input[value="${zamId}"]`)
    out.predOdebranimZaskrtnuto = !!(z2 && z2.checked)
    if (z2) z2.checked = false
    ov2?.querySelector('[data-ulozit]')?.click(); await cekej(1500)
    out.poOdebrani = ((await sb.from('profiles').select('zamestnavatel_id').eq('id', zamId).maybeSingle()).data || {}).zamestnavatel_id ?? null

    // uklidit
    await sb.from('profiles').update({ supplier_type: null, company_name: null }).eq('id', firmaId)
    return out
  })

  if (v.chyba) ok(false, v.chyba)
  else {
    console.log('\n1) Karta šéfa — nahoře v Profilu')
    ok(v.predVidet && /Pracuje sám na sebe/.test(v.pred), `je vidět „Pracuje sám na sebe" (${v.pred.slice(0, 60)})`)
    ok(v.tlacitka.some(t => /Pracuje pod někým/.test(t)) && v.tlacitka.some(t => /Zaměstnává někoho/.test(t)), 'a tlačítka oběma směry: ' + v.tlacitka.join(' | '))
    console.log('\n2) Výběr zaměstnanců')
    ok(v.nabidkaMaZam, 'nabídne ostatní pracovníky')
    ok(!v.nabidkaMaFirmu, 'firmu (s.r.o.) jako zaměstnance nenabídne')
    ok(!v.nabidkaMaSebe, 'ani jeho samotného')
    ok(v.poHledani >= 1, 'hledání jménem funguje')
    ok(v.zapsano === v.idSefa, 'zaškrtnutý se uloží pod šéfa-živnostníka')
    ok(/Zaměstnává 1 člověka/.test(v.poUlozeni) && v.poUlozeni.includes(v.jmZam), `řádek v kartě to hned ukáže (${v.poUlozeni.slice(0, 70)})`)
    console.log('\n3) Karta zaměstnance')
    ok(/Zaměstnanec — pracuje pod/.test(v.uZam) && v.uZam.includes(v.jmSefa) && /živnostník/.test(v.uZam), `ukáže, pod kým pracuje (${v.uZam.slice(0, 80)})`)
    const iFirma = v.sefVolby.findIndex(t => /Stavby Test s\.r\.o\./.test(t)), iSef = v.sefVolby.findIndex(t => t.includes(v.jmSefa) && /živnostník/.test(t))
    ok(iSef > 0 && iFirma > 0 && iFirma < iSef, 'výběr šéfa nabízí firmu i živnostníka, firmu napřed')
    ok(v.zamNemuze, 'zaměstnanec sám nikoho zaměstnávat nemůže')
    console.log('\n4) Faktura jde přes šéfa')
    ok(v.fakturaceZamceno && /Zaměstnává/.test(v.fakturaceInfo), `v záložce Fakturace je napsané, koho zaměstnává (${v.fakturaceInfo.slice(0, 50)})`)
    const cislo = t => { const m = String(t).match(/([\d.]+)h/); return m ? Number(m[1]) : null }
    ok(cislo(v.tydenText) !== null && Math.abs(cislo(v.tydenText) - (v.hSefa + v.hZam)) < 0.2, `v týdnech k faktuře jsou i hodiny zaměstnance (${v.tydenText.trim()} = ${v.hSefa} + ${v.hZam})`)
    ok(JSON.stringify(v.fakturaLide) === JSON.stringify(v.ocekavaniLide), 'faktura od správce počítá hodiny šéfa i zaměstnance')
    console.log('\n5) Provize')
    ok(v.provizePilulka, 'u šéfa je „👔 zaměstnává 1 člověka"')
    ok(v.provizeBezTlacitka, 'a nemá tlačítko „zaměstnanec?" (sám zaměstnancem být nemůže)')
    ok(v.provizeZamPodSefem, 'zaměstnanec má provizi jen jako podíl u šéfa, výdělek platí šéf')
    console.log('\n6) Zpátky')
    ok(v.predOdebranimZaskrtnuto && v.poOdebrani === null, 'odškrtnutím se zaměstnanec vrátí mezi OSVČ')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Šéfem může být i živnostník, nastaví se z obou karet')
process.exit(chyby ? 1 : 0)
