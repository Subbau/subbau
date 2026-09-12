// Výjimka u jednoho dne docházky: pracovník nedostane zaplaceno, nebo my
// nedostaneme provizi, nebo se částka za den přepíše ručně.
//
//   npm i puppeteer && node test-den-bez-vyplaty.mjs
import fs from 'fs'
import path from 'path'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) { console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer'); process.exit(2) }

function stejnaVerze(appka, ukazka) {
  const ver = t => (t.match(/SUBBAU_VERZE\s*=\s*'([^']*)'/) || [])[1] || null
  const a = ver(fs.readFileSync(appka, 'utf8')), u = ver(fs.readFileSync(ukazka, 'utf8'))
  if (!a || !u) { console.error('❌ Nenašel jsem verzi — zkouška NEPROBĚHLA'); process.exit(2) }
  if (a !== u) {
    console.error('❌ Ukázka je starší než appka — zkouška NEPROBĚHLA. Spusťte: node ukazka/generuj.mjs')
    process.exit(2)
  }
}

const APP = process.argv[2] || 'subbau_final.html'
const UKAZKA = process.argv[3] || 'ukazka.html'
stejnaVerze(APP, UKAZKA)
const src = fs.readFileSync(APP, 'utf8')
const api = fs.readFileSync('api/klient-dochazka.js', 'utf8')

let chyb = 0
const ok = (b, t) => { if (!b) { chyb++; console.log('  ❌ ' + t) } else console.log('  ✅ ' + t) }

// ── 1. výpočet pro fakturu (čistá funkce, vytažená z appky) ──
console.log('── faktura ──')
const kod = src.slice(src.indexOf('function hodinyPodleSazeb'), src.indexOf('\n// Po změně sazby se musí přepočítat'))
const { hodinyPodleSazeb } = await import('data:text/javascript,'
  + encodeURIComponent(kod + '\nexport { hodinyPodleSazeb }'))
const sazba = () => 23

const bezny = hodinyPodleSazeb(
  [{ work_date: '2026-09-07', total_hours: 8 }, { work_date: '2026-09-08', total_hours: 8 }], sazba)
ok(bezny.hodiny === 16 && bezny.castka === 368, 'beze změny se počítá jako dosud (16 h, 368 €)')

const sVynechanym = hodinyPodleSazeb(
  [{ work_date: '2026-09-07', total_hours: 8 },
   { work_date: '2026-09-08', total_hours: 8, bez_vyplaty: true }], sazba)
ok(sVynechanym.hodiny === 8 && sVynechanym.castka === 184,
   'den „bez výplaty" vypadne z faktury i s hodinami (' + sVynechanym.hodiny + ' h, ' + sVynechanym.castka + ' €)')

const sPevnou = hodinyPodleSazeb(
  [{ work_date: '2026-09-07', total_hours: 8 },
   { work_date: '2026-09-08', total_hours: 8, vyplata_castka: 100 }], sazba)
ok(sPevnou.hodiny === 16 && sPevnou.castka === 284,
   'ručně přepsaná částka platí místo hodiny × sazba (' + sPevnou.castka + ' €)')
ok(sPevnou.skupiny.some(g => g.pevna && g.castka === 100),
   'den s pevnou částkou dostane na faktuře vlastní řádek')
ok(/rozpis\.skupiny\.length > 1 \|\| jePevna/.test(src),
   'faktura se rozepíše na řádky i když je pevná částka jen u jednoho dne')

// ── 2. provize a odkaz pro odběratele (čtení kódu) ──
console.log('\n── provize a odkaz pro odběratele ──')
ok(/bezProvize\.has\(a\.worker_id\) \|\| a\.bez_provize_den/.test(src), 'provize se u označeného dne nepočítá')
ok(/a\.bez_vyplaty\s*\n?\s*\?\s*0/.test(src) || /a\.bez_vyplaty[\s\S]{0,40}\?\s*0/.test(src),
   'výdělek pracovníka je u dne „bez výplaty" nulový')
ok(/bez_vyplaty,bez_provize_den,vyplata_castka/.test(api),
   'odkaz pro odběratele si ty příznaky vůbec načte')
ok(/bezProvize\.has\(z\.worker_id\) \|\| z\.bez_provize_den/.test(api), 'a nepočítá u takového dne provizi')
ok(/z\.bez_vyplaty/.test(api), 'a nefakturuje den bez výplaty')
ok(/provHoursByWorker/.test(src), 'report pro firmu počítá průměrnou sazbu jen z hodin s provizí')

// ── 3. v prohlížeči: okno úpravy dne ──
console.log('\n── okno úpravy dne ──')
const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1400, height: 1000 })
const chybyStranky = []
p.on('pageerror', e => chybyStranky.push(e.message.slice(0, 140)))
await p.goto('file://' + path.resolve(UKAZKA), { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const v = await p.evaluate(async () => {
  const out = {}
  const { data: dny } = await sb.from('attendance').select('*').not('total_hours', 'is', null).limit(1)
  const den = (dny || [])[0]
  if (!den) return { chyba: 'v ukázce není žádný den docházky' }

  await openWeekEdit(den.worker_id, den.kw, den.kw_year, 'Zkouška', den.work_date)
  await new Promise(r => setTimeout(r, 900))
  out.poleJsou = ['edit-att-bez-vyplaty', 'edit-att-bez-provize', 'edit-att-castka', 'edit-att-vyplata-pozn']
    .every(id => !!document.getElementById(id))
  out.napoprvePrazdne = !document.getElementById('edit-att-bez-vyplaty').checked
    && !document.getElementById('edit-att-bez-provize').checked
    && document.getElementById('edit-att-castka').value === ''

  document.getElementById('edit-att-bez-vyplaty').checked = true
  document.getElementById('edit-att-castka').value = '150'
  document.getElementById('edit-att-vyplata-pozn').value = 'rozbil míchačku'
  await saveEditAttRecord()
  await new Promise(r => setTimeout(r, 900))
  const poUlozeni = (await sb.from('attendance').select('*').eq('id', den.id)).data[0]
  out.ulozeno = { bezVyplaty: poUlozeni.bez_vyplaty, castka: Number(poUlozeni.vyplata_castka),
                  pozn: poUlozeni.vyplata_poznamka, hodiny: poUlozeni.total_hours }

  // znovu otevřít — musí se to načíst zpátky
  await openWeekEdit(den.worker_id, den.kw, den.kw_year, 'Zkouška', den.work_date)
  await new Promise(r => setTimeout(r, 900))
  out.nacteno = { bezVyplaty: document.getElementById('edit-att-bez-vyplaty').checked,
                  castka: document.getElementById('edit-att-castka').value,
                  pozn: document.getElementById('edit-att-vyplata-pozn').value }
  // ── v prohlížeči: promítne se to do Provizí? ──
  sessionStorage.setItem('provizeUnlocked', 'ukazka')
  const sekce = document.getElementById('provize-content')
  sekce.style.display = 'block'
  const zamek = document.getElementById('provize-lock'); if (zamek) zamek.style.display = 'none'
  const cislo = t => Number(String(t || '').replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0
  const stav = (id) => ({
    provize: cislo(document.getElementById('pv-w-' + id)?.textContent),
    vydelek: cislo(document.getElementById('pv-e-' + id)?.textContent),
  })

  // Uklidíme, co jsme nastavili výš, ať to do měření nemluví.
  await sb.from('attendance').update({ bez_vyplaty: false, vyplata_castka: null }).eq('id', den.id)
  await renderProvizeContent(); await new Promise(r => setTimeout(r, 600))
  const kdo = den.worker_id
  const pred = stav(kdo)

  // Provize ukazují AKTUÁLNÍ týden, ne ten, ze kterého je `den`. Označíme proto
  // všechny dny toho člověka — jinak by se v zobrazeném týdnu nic nezměnilo
  // a zkouška by tvrdila, že to nefunguje.
  const { data: dnyC } = await sb.from('attendance').select('id').eq('worker_id', kdo)
    .not('total_hours', 'is', null)
  const tyden = (dnyC || [])
  for (const d of tyden) await sb.from('attendance').update({ bez_provize_den: true }).eq('id', d.id)
  await renderProvizeContent(); await new Promise(r => setTimeout(r, 600))
  const poBezProvize = stav(kdo)

  for (const d of tyden) await sb.from('attendance').update({ bez_provize_den: false, bez_vyplaty: true }).eq('id', d.id)
  await renderProvizeContent(); await new Promise(r => setTimeout(r, 600))
  const poBezVyplaty = stav(kdo)
  for (const d of tyden) await sb.from('attendance').update({ bez_vyplaty: false }).eq('id', d.id)

  out.provize = { pred, poBezProvize, poBezVyplaty, dnu: tyden.length }
  return out
})
await b.close()

if (v.chyba) { chyb++; console.log('  ❌ ' + v.chyba) }
else {
  ok(v.poleJsou, 'v okně jsou obě zaškrtávátka, částka i poznámka')
  ok(v.napoprvePrazdne, 'u běžného dne je všechno prázdné')
  ok(v.ulozeno.bezVyplaty === true && v.ulozeno.castka === 150 && v.ulozeno.pozn === 'rozbil míchačku',
     'výjimka se uloží do docházky')
  ok(v.ulozeno.hodiny != null, 'hodiny dne zůstanou zapsané (' + v.ulozeno.hodiny + ' h)')
  ok(v.nacteno.bezVyplaty === true && v.nacteno.castka === '150' && v.nacteno.pozn === 'rozbil míchačku',
     'po znovuotevření se výjimka načte zpátky')
}
if (v.provize) {
  console.log('\n── promítne se to do Provizí ──')
  ok(v.provize.poBezProvize.provize < v.provize.pred.provize,
     'označené dny sníží provizi (' + v.provize.pred.provize + ' € → ' + v.provize.poBezProvize.provize + ' €)')
  ok(v.provize.poBezProvize.vydelek === v.provize.pred.vydelek,
     'a výdělku pracovníka se nedotknou (' + v.provize.poBezProvize.vydelek + ' €)')
  ok(v.provize.poBezVyplaty.vydelek < v.provize.pred.vydelek,
     'dny „bez výplaty" sníží výdělek pracovníka (' + v.provize.pred.vydelek + ' € → ' + v.provize.poBezVyplaty.vydelek + ' €)')
  ok(v.provize.poBezVyplaty.provize === v.provize.pred.provize,
     'a naše provize za ně běží dál (' + v.provize.poBezVyplaty.provize + ' €)')
}
ok(!chybyStranky.filter(x => !/favicon/i.test(x)).length, 'na stránce nenastala chyba')

console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['vynechání dne z faktury', () => hodinyPodleSazeb([{ work_date: '2026-09-08', total_hours: 8, bez_vyplaty: true }], sazba).hodiny !== 0],
  ['pevná částka', () => hodinyPodleSazeb([{ work_date: '2026-09-08', total_hours: 8, vyplata_castka: 100 }], sazba).castka !== 100],
  ['sloupce v odkazu pro odběratele', () => !/bez_vyplaty,bez_provize_den,vyplata_castka/.test(api)],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ VÝJIMKA U DNE FUNGUJE')
process.exit(chyb ? 1 : 0)
