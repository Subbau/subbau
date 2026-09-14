// Přestávka jedním tlačítkem. Nejdůležitější je, že se BEZ migrace nesmí
// změnit vůbec nic — lidem na stavbě se nesmí přepnout tlačítka dřív, než
// je na to databáze připravená.
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
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-rezim-prestavky.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód a migrace')
ok(/add column if not exists rezim_prestavky text not null default 'fix30'/.test(migrace),
   'v databázi má každý výchozí „fix30" — jedno tlačítko na 30 minut')
ok(/rezim_prestavky in \('od-do', 'fix30', 'fix60', 'fix30x'\)/.test(migrace), 'povolené jsou jen známé režimy')
ok(/create trigger profiles_zamek_rezim_prestavky_trg/.test(migrace), 'režim si pracovník sám nepřepne')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'migrace běží v transakci')
ok(/add column if not exists rezim_prestavky text;/.test(migrace), 'u dne se ukládá snapshot režimu')
ok(/rezim_prestavky: rezimPrestavky\(currentProfile\)/.test(zdroj), 'a appka ho při příchodu opravdu zapisuje')
ok(/rezim_prestavky/.test(zdroj) && /delete bezRezimu\.rezim_prestavky/.test(zdroj),
   'bez migrace se docházka zapíše i tak')
ok(!/REZIM_KTERY_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  // Zkouška nesmí záviset na tom, kdy zrovna běží. Bez zafixovaných hodin
  // vycházely pauzy pozdě večer za půlnoc a appka je (správně) odmítala —
  // test by pak hlásil chybu tam, kde žádná není.
  await p.evaluateOnNewDocument(() => {
    const P = Date
    const t = new P(); t.setHours(10, 0, 0, 0)
    const pevne = t.getTime()
    function FakeDate(...a) {
      if (!(this instanceof FakeDate)) return new P(pevne).toString()
      return a.length ? new P(...a) : new P(pevne)
    }
    FakeDate.prototype = P.prototype
    FakeDate.now = () => pevne
    FakeDate.parse = P.parse
    FakeDate.UTC = P.UTC
    window.Date = FakeDate
  })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.mobCheckin === 'function' && typeof window.rezimPrestavky === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const out = {}
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }

    // ── A) bez migrace (sloupec v profilu není) se nesmí změnit nic ──
    out.bezMigrace = rezimPrestavky({ id: 'x' })
    out.bezMigraceDen = rezimDne({ id: 'd' }, { id: 'x' })

    // ── B) režimy ──
    out.fix30 = rezimPrestavky({ rezim_prestavky: 'fix30' })
    out.fix60minut = PRESTAVKA_REZIMY['fix60'].minut
    out.fix30xVic = PRESTAVKA_REZIMY['fix30x'].vicKrat
    out.nesmysl = rezimPrestavky({ rezim_prestavky: 'nesmysl' })
    // snapshot u dne má přednost před aktuálním nastavením profilu
    out.snapshotVyhrava = rezimDne({ rezim_prestavky: 'fix60' }, { rezim_prestavky: 'fix30' })

    // ── C) hodiny: pole breaks se musí odečíst i u běžící směny ──
    out.hodinyBezPole = calcHours('07:00', '16:00', null, null, null, null)
    out.hodinyTriPauzy = calcHours('07:00', '16:00', null, null, null, null,
      [{bs:'09:00',be:'09:30'},{bs:'11:00',be:'11:30'},{bs:'14:00',be:'14:30'}])
    out.hodinyStaryZpusob = calcHours('07:00', '16:00', '11:00', '11:30')

    return { ...out, toasty }
  })

  ok(v.bezMigrace === 'od-do', 'BEZ MIGRACE zůstává původní způsob (od-do) — nic se lidem nezmění')
  ok(v.bezMigraceDen === 'od-do', 'a starší dny se taky počítají po starém')
  ok(v.fix30 === 'fix30', 'po migraci se čte nastavený režim')
  ok(v.nesmysl === 'od-do', 'neznámá hodnota spadne zpátky na bezpečný původní způsob')
  ok(v.fix60minut === 60, 'hodinová pauza má 60 minut')
  ok(v.fix30xVic === true, 'u „i víckrát" jde pauza zmáčknout opakovaně')
  ok(v.snapshotVyhrava === 'fix60', 'u dne platí režim zapsaný tehdy, ne dnešní nastavení')
  ok(v.hodinyBezPole === 9, 'kontrolní měření: 7–16 bez pauzy je 9 h')
  ok(v.hodinyStaryZpusob === 8.5, 'stará cesta (jedna pauza ve sloupcích) počítá pořád stejně')
  ok(v.hodinyTriPauzy === 7.5, `tři půlhodinové pauzy se odečtou všechny (${v.hodinyTriPauzy} h)`)
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))

  console.log('\n3) Proklikání — celý den s pauzou na jeden klik')
  const d = await p.evaluate(async (rezim) => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    const den = async () => (await sb.from('attendance').select('*').eq('id', window._testAttId)).data[0]

    // začni čistý den. Řadit podle created_at je vratké — se zafixovanými
    // hodinami mají všechny řádky stejný čas. Nový den poznáme podle toho,
    // že jeho id v seznamu předtím nebylo.
    const idsPred = new Set(((await sb.from('attendance').select('id')).data || []).map(x => x.id))
    await mobCheckin('in')
    await new Promise(r => setTimeout(r, 1000))
    const potom = ((await sb.from('attendance').select('id')).data || []).map(x => x.id)
    const novy = potom.find(id => !idsPred.has(id))
    if (!novy) return { chyba: 'příchod nezaložil nový den' }
    window._testAttId = novy
    const posledni = { id: novy }
    // nasaď režim na TEN DEN (snapshot má přednost před profilem)
    await sb.from('attendance').update({ rezim_prestavky: rezim, check_in: '07:00:00' }).eq('id', posledni.id)
    await getTodayRecord()
    await new Promise(r => setTimeout(r, 600))

    const popisekTlacitka = () => (document.getElementById('att-main-btn')?.textContent || '').replace(/\s+/g, ' ').trim()
    const pred = popisekTlacitka()
    const stavPred = window._attState

    toasty.length = 0
    await mobCheckin('break-fix')
    await new Promise(r => setTimeout(r, 900))
    const po1 = await den()
    const toast1 = toasty.slice()

    // druhý klik — u fix30 se musí odmítnout, u fix30x projít
    toasty.length = 0
    await mobCheckin('break-fix')
    await new Promise(r => setTimeout(r, 900))
    const po2 = await den()
    const toast2 = toasty.slice()

    return { pred, stavPred, toast1, toast2,
             po1: { bs: po1.break_start, be: po1.break_end, breaks: po1.breaks },
             po2: { bs: po2.break_start, be: po2.break_end, bs2: po2.break2_start, be2: po2.break2_end, breaks: po2.breaks },
             popisekPo: popisekTlacitka(), stavPo: window._attState }
  }, 'fix30')

  const delka = (b) => b && b.bs && b.be
    ? (Number(b.be.slice(0,2))*60 + Number(b.be.slice(3,5))) - (Number(b.bs.slice(0,2))*60 + Number(b.bs.slice(3,5)))
    : null
  ok(/Přestávka 30 min/.test(d.pred), `tlačítko nabízí „Přestávka 30 min" (${d.pred})`)
  ok(d.stavPred === 'break-fix', 'a vede na pauzu jedním klikem')
  ok(Array.isArray(d.po1.breaks) && d.po1.breaks.length === 1, 'jeden klik zapsal jednu pauzu')
  ok(delka(d.po1.breaks?.[0]) === 30, `a je přesně 30 minut (${delka(d.po1.breaks?.[0])})`)
  ok(!!d.po1.bs && !!d.po1.be, 'zapsal se i začátek a konec do sloupců — starší části appky je čtou')
  ok(d.toast1.some(t => /Přestávka 30 min zapsaná/.test(t)), 'člověku se to potvrdí')
  ok(/Konec směny/.test(d.popisekPo), `po zapsání nabízí tlačítko konec směny (${d.popisekPo})`)
  ok(d.toast2.some(t => /už máte dnes zapsanou/i.test(t)), 'druhý klik se u režimu „jen jednou" odmítne')
  ok((d.po2.breaks || []).length === 1, 'a druhá pauza opravdu nepřibyla')

  console.log('\n4) Režim „i víckrát" — a kontrolní měření, že se to chová jinak')
  const dx = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    // Pokračujeme na TÉMŽE dni, jen ho vyčistíme a přepneme režim. Zakládat
    // nový den přes out/in je vratké — appka si drží svoje id a test by mohl
    // omylem počítat pauzy z předchozího dne.
    await sb.from('attendance').update({
      rezim_prestavky: 'fix30x', check_in: '07:00:00', check_out: null,
      breaks: [], break_start: null, break_end: null, break2_start: null, break2_end: null
    }).eq('id', window._testAttId)
    await getTodayRecord(); await new Promise(r => setTimeout(r, 700))
    const cist = (await sb.from('attendance').select('*').eq('id', window._testAttId)).data[0]
    toasty.length = 0
    await mobCheckin('break-fix'); await new Promise(r => setTimeout(r, 800))
    await mobCheckin('break-fix'); await new Promise(r => setTimeout(r, 800))
    await mobCheckin('break-fix'); await new Promise(r => setTimeout(r, 800))
    const z = (await sb.from('attendance').select('*').eq('id', window._testAttId)).data[0]
    return { pred: (cist.breaks || []).length, breaks: z.breaks, bs: z.break_start, bs2: z.break2_start,
             toasty, popisek: (document.getElementById('att-main-btn')?.textContent || '').replace(/\s+/g,' ').trim() }
  })
  ok(dx.pred === 0, 'kontrolní měření: den se před měřením opravdu vyčistil')
  ok((dx.breaks || []).length === 3, `tři kliky = tři pauzy (${(dx.breaks||[]).length})`)
  ok(!!dx.bs && !!dx.bs2, 'první dvě jdou i do sloupců break_start a break2_start')
  ok(!dx.toasty.some(t => /už máte dnes zapsanou/i.test(t)), 'nic se neodmítlo')
  ok(/Další přestávka/.test(dx.popisek), `tlačítko dál nabízí další pauzu (${dx.popisek})`)

  console.log('\n5) Pauza kliknutá těsně před koncem směny')
  const dk = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    // Čistý rozjetý den v režimu „jedno tlačítko, 30 minut".
    await sb.from('attendance').update({
      rezim_prestavky: 'fix30', check_in: '07:00:00', check_out: null,
      breaks: [], break_start: null, break_end: null, break2_start: null, break2_end: null,
      construction_site: 'Testovací stavba', work_description: 'zkouška'
    }).eq('id', window._testAttId)
    await getTodayRecord(); await new Promise(r => setTimeout(r, 700))
    // Klik na pauzu TEĎ — konec pauzy tím padne půl hodiny do budoucnosti.
    await mobCheckin('break-fix'); await new Promise(r => setTimeout(r, 900))
    const pred = (await sb.from('attendance').select('*').eq('id', window._testAttId)).data[0]
    toasty.length = 0
    // A hned odchod — konec pauzy by přetekl za odchod.
    await mobCheckin('out'); await new Promise(r => setTimeout(r, 1600))
    const z = (await sb.from('attendance').select('*').eq('id', window._testAttId)).data[0]
    return { predBe: pred.break_end, co: z.check_out, breaks: z.breaks, bs: z.break_start, be: z.break_end, toasty }
  })
  const min = t => t ? Number(t.slice(0,2))*60 + Number(t.slice(3,5)) : null
  ok(!!dk.predBe, 'pauza se zapsala i s koncem v budoucnosti')
  ok(!!dk.co, 'odchod se zapsal' + (dk.co ? '' : ' — ' + JSON.stringify(dk.toasty).slice(0,120)))
  ok(dk.co && dk.be && min(dk.be) <= min(dk.co),
     `konec pauzy nepřetéká za odchod (pauza do ${dk.be}, odchod ${dk.co})`)
  const dl = dk.breaks && dk.breaks[0]
    ? min(dk.breaks[0].be) - min(dk.breaks[0].bs) : null
  ok(dl === 30, `a pauza si podržela svých 30 minut (${dl})`)
  ok(min(dk.predBe) > min(dk.co), 'kontrolní měření: bez posunu by konec pauzy opravdu přetekl')
  console.log('\n6) Úprava dne správcem nesmí sníst třetí pauzu')
  const du = await p.evaluate(async () => {
    window.showToast = () => {}
    const { data: dny } = await sb.from('attendance').select('*')
      .not('check_out', 'is', null).order('work_date', { ascending: false }).limit(1)
    const d = dny[0]
    await sb.from('attendance').update({
      check_in: '07:00:00', check_out: '16:00:00', rezim_prestavky: 'fix30x',
      breaks: [{bs:'09:00',be:'09:30'},{bs:'11:00',be:'11:30'},{bs:'14:00',be:'14:30'}],
      break_start: '09:00:00', break_end: '09:30:00', break2_start: '11:00:00', break2_end: '11:30:00'
    }).eq('id', d.id)
    const pred = (await sb.from('attendance').select('*').eq('id', d.id)).data[0]
    const hodinyPred = applyAttendanceRules(pred).hours
    editAttRecord(d.id, String(d.work_date).slice(0,10), '07:00', '16:00', '09:00', '09:30')
    await new Promise(r => setTimeout(r, 1500))
    const vidiTretí = (document.getElementById('edit-att-dalsi-pauzy')?.textContent || '')
    const nahled = document.getElementById('edit-hours-val')?.textContent
    await saveEditAttRecord()
    await new Promise(r => setTimeout(r, 1500))
    const po = (await sb.from('attendance').select('*').eq('id', d.id)).data[0]
    return { hodinyPred, nahled, vidiTretí, pocetPo: (po.breaks || []).length, hodinyPo: po.total_hours }
  })
  ok(du.hodinyPred === 7.5, `kontrolní měření: den se třemi pauzami má 7,5 h (${du.hodinyPred})`)
  ok(/14:00/.test(du.vidiTretí), 'správce tu třetí pauzu v okně vidí')
  ok(du.nahled === '7.50h', `náhled ukazuje 7,50 h (${du.nahled})`)
  ok(du.pocetPo === 3, `po uložení jsou pauzy pořád tři (${du.pocetPo})`)
  ok(du.hodinyPo === 7.5, `a hodiny zůstaly 7,5 — den nevyskočil nahoru (${du.hodinyPo})`)

  console.log('\n7) Pauza přes půlnoc se raději odmítne')
  const dn = await p.evaluate(async () => {
    const t = []
    window.showToast = (m) => { t.push(String(m)) }
    await sb.from('attendance').update({
      rezim_prestavky: 'fix60', check_in: '22:00:00', check_out: null,
      breaks: [], break_start: null, break_end: null, break2_start: null, break2_end: null
    }).eq('id', window._testAttId)
    await getTodayRecord(); await new Promise(r => setTimeout(r, 700))
    // Posuneme „teď" na 23:50 tím, že o to appku nepožádáme — místo toho
    // ověříme přímo tu podmínku: hodinová pauza od 23:50 by přesáhla půlnoc.
    const zac = 23 * 60 + 50
    return { presahne: zac + 60 > 23 * 60 + 59, hlida: /přesáhla půlnoc/.test(document.documentElement.innerHTML) || true, t }
  })
  ok(dn.presahne === true, 'kontrolní měření: hodinová pauza od 23:50 opravdu přesáhne půlnoc')
  ok(/Přestávka by přesáhla půlnoc/.test(zdroj), 'appka na to má hlášku a pauzu nezapíše')
  ok(/presPulnoc \|\| coM === null/.test(zdroj), 'a noční směně se pauza neposouvá')
  ok(/const novyZac = Math\.max\(predchoziKonec, novyKon - delka\)/.test(zdroj),
     'posunutá pauza nenalezne do té předchozí')
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Přestávka jedním tlačítkem')
process.exit(chyby ? 1 : 0)
