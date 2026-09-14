// Upozornění na dashboardu „Dlouhá pracovní doba — po 20:30".
// Nesmí se dát schovat. Zmizí jedině tím, že den 19:00 překračovat přestane —
// a po znovunačtení se nevrátí.
//
//   npm i puppeteer && node test-dlouhy-den.mjs
import fs from 'fs'
import path from 'path'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) { console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer'); process.exit(2) }

function stejnaVerze(appka, ukazka) {
  const ver = t => (t.match(/SUBBAU_VERZE\s*=\s*'([^']*)'/) || [])[1] || null
  const a = ver(fs.readFileSync(appka, 'utf8')), u = ver(fs.readFileSync(ukazka, 'utf8'))
  if (!a || !u) { console.error('❌ Nenašel jsem verzi — zkouška NEPROBĚHLA'); process.exit(2) }
  if (a !== u) { console.error('❌ Ukázka je starší než appka. Spusťte: node ukazka/generuj.mjs'); process.exit(2) }
}

const APP = process.argv[2] || 'subbau_final.html'
const UKAZKA = process.argv[3] || 'ukazka.html'
stejnaVerze(APP, UKAZKA)
const src = fs.readFileSync(APP, 'utf8')

let chyb = 0
const ok = (b, t) => { if (!b) { chyb++; console.log('  ❌ ' + t) } else console.log('  ✅ ' + t) }

console.log('── skrývání je pryč ──')
ok(!/function dismissLongDayAlert/.test(src), 'funkce na skrytí upozornění už neexistuje')
ok(!/function resetLongDayAlerts/.test(src), 'ani obnovení skrytých')
ok(!/_longDayDismissed/.test(src), 'appka si žádná skrytá upozornění nepamatuje')
ok(/function opravDlouhyDen/.test(src), 'místo toho je tlačítko Opravit')

const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1500, height: 1000 })
const chybyStranky = []
p.on('pageerror', e => chybyStranky.push(e.message.slice(0, 140)))
await p.goto('file://' + path.resolve(UKAZKA), { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const v = await p.evaluate(async () => {
  const out = {}
  const { data: dny } = await sb.from('attendance').select('*')
    .not('check_out', 'is', null).order('work_date', { ascending: false }).limit(1)
  const d = (dny || [])[0]
  if (!d) return { chyba: 'v ukázce není žádný uzavřený den' }

  // uděláme z něj dlouhý den
  await sb.from('attendance').update({ check_out: '21:15:00', total_hours: 13 }).eq('id', d.id)
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  const box = document.getElementById('dash-unclosed-shifts')
  const txt = () => (box.textContent || '').replace(/\s+/g, ' ').trim()
  out.ukazalo = { videt: box.style.display, jeTamPo19: /po 20:30/.test(txt()),
    maOpravit: !!box.querySelector('button[onclick*="opravDlouhyDen"]'),
    maSkryvani: /Vyřízeno|Skryto|Obnovit skryté|Zobrazit skryté/.test(txt()) }

  // tlačítko Opravit otevře přesně ten den
  box.querySelector('button[onclick*="opravDlouhyDen"]').click()
  await new Promise(r => setTimeout(r, 1100))
  out.opravit = { okno: document.getElementById('edit-att-modal')?.style.display,
                  den: document.getElementById('edit-att-date')?.value,
                  spravnyDen: document.getElementById('edit-att-date')?.value === String(d.work_date).slice(0, 10) }

  // opravíme a upozornění musí zmizet — samo, bez odklikávání
  setEditTime('co', '16:00')
  await saveEditAttRecord(); await new Promise(r => setTimeout(r, 1300))
  out.poOprave = { videt: box.style.display, text: txt().slice(0, 40) }
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  out.poZnovunacteni = { videt: box.style.display, text: txt().slice(0, 40) }

  // ── někteří lidi opravdu dělají do osmi: uložení správcem = potvrzení ──
  await sb.from('attendance').update({ check_out: '21:15:00', total_hours: 13, dlouhy_den_potvrzen: null }).eq('id', d.id)
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  out.pred20 = box.style.display
  box.querySelector('button[onclick*="opravDlouhyDen"]').click()
  await new Promise(r => setTimeout(r, 1100))
  out.predvyplneno = document.getElementById('edit-att-co-t')?.value
  // správce NIC nemění, jen uloží — tím ty časy potvrdí
  await saveEditAttRecord(); await new Promise(r => setTimeout(r, 1300))
  const z = (await sb.from('attendance').select('*').eq('id', d.id)).data[0]
  out.potvrzeni = { odchod: z.check_out, znacka: z.dlouhy_den_potvrzen, upozorneni: box.style.display }
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  out.potvrzeniPoZnovunacteni = box.style.display
  // když se ten den znovu změní, potvrzení neplatí
  await sb.from('attendance').update({ check_out: '21:45:00', total_hours: 14.2 }).eq('id', d.id)
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  out.poDalsiZmene = box.style.display
  await sb.from('attendance').update({ dlouhy_den_potvrzen: null }).eq('id', d.id)

  // a když je den zase dlouhý, upozornění se vrátí (pravda se neschovává)
  await sb.from('attendance').update({ check_out: '21:00:00', total_hours: 13.5 }).eq('id', d.id)
  await loadLongDayAlert(); await new Promise(r => setTimeout(r, 400))
  out.kdyzZaseDlouhy = { videt: box.style.display, jeTamPo19: /po 20:30/.test(txt()) }
  await sb.from('attendance').update({ check_out: d.check_out, total_hours: d.total_hours }).eq('id', d.id)
  return out
})
await b.close()

if (v.chyba) { chyb++; console.log('  ❌ ' + v.chyba) }
else {
  console.log('\n── v prohlížeči ──')
  ok(v.ukazalo.videt === 'block' && v.ukazalo.jeTamPo19, 'dlouhý den se na dashboardu ukáže')
  ok(!v.ukazalo.maSkryvani, 'není tam nic o skrývání ani vyřizování')
  ok(v.ukazalo.maOpravit, 'je tam tlačítko Opravit')
  ok(v.opravit.okno === 'flex', 'Opravit otevře úpravu docházky')
  ok(v.opravit.spravnyDen, 'a rovnou ten správný den (' + v.opravit.den + ')')
  ok(v.poOprave.videt === 'none', 'po opravě upozornění samo zmizí')
  ok(v.poZnovunacteni.videt === 'none', 'a po znovunačtení se nevrátí')
  ok(v.kdyzZaseDlouhy.videt === 'block' && v.kdyzZaseDlouhy.jeTamPo19,
     'když je den zase dlouhý, upozornění se objeví (nic se nezametlo)')

  console.log('\n── kdo opravdu dělá do osmi ──')
  ok(v.pred20 === 'block', 'den do 21:15 se napřed ukáže')
  ok(v.predvyplneno === '21:15', 'Opravit otevře ten den s jeho časy (' + v.predvyplneno + ')')
  ok(v.potvrzeni.odchod === '21:15:00', 'správce časy nemění, jen uloží')
  ok(v.potvrzeni.znacka && v.potvrzeni.znacka.endsWith('|21:15'),
     'uložením se ty časy potvrdí (' + v.potvrzeni.znacka + ')')
  ok(v.potvrzeni.upozorneni === 'none', 'a upozornění zmizí, i když den po 20:30 pořád končí')
  ok(v.potvrzeniPoZnovunacteni === 'none', 'po znovunačtení se nevrátí')
  ok(v.poDalsiZmene === 'block', 'když se ten den znovu změní, potvrzení padá a upozornění se vrátí')
}
ok(!chybyStranky.filter(x => !/favicon/i.test(x)).length, 'na stránce nenastala chyba')

console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['hlídání skrývání', () => /function dismissLongDayAlert/.test(src)],
  ['tlačítko Opravit', () => !/function opravDlouhyDen/.test(src)],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ UPOZORNĚNÍ MIZÍ OPRAVOU, NE SKRÝVÁNÍM')
process.exit(chyb ? 1 : 0)
