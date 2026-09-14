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
  const cekej = ms => new Promise(r => setTimeout(r, ms))
  const { data: dny } = await sb.from('attendance').select('*').not('total_hours', 'is', null).limit(1)
  const den = (dny || [])[0]
  if (!den) return { chyba: 'v ukázce není žádný den docházky' }

  await openWeekEdit(den.worker_id, den.kw, den.kw_year, 'Zkouška', den.work_date)
  await cekej(900)
  out.poleJsou = ['edit-att-bez-vyplaty', 'edit-att-bez-provize', 'edit-att-castka', 'edit-att-vyplata-pozn']
    .every(id => !!document.getElementById(id))
  out.napoprvePrazdne = !document.getElementById('edit-att-bez-vyplaty').checked
    && !document.getElementById('edit-att-bez-provize').checked
    && document.getElementById('edit-att-castka').value === ''

  document.getElementById('edit-att-bez-vyplaty').checked = true
  document.getElementById('edit-att-castka').value = '150'
  document.getElementById('edit-att-vyplata-pozn').value = 'rozbil míchačku'
  await saveEditAttRecord()
  await cekej(900)
  const poUlozeni = (await sb.from('attendance').select('*').eq('id', den.id)).data[0]
  out.ulozeno = { bezVyplaty: poUlozeni.bez_vyplaty, castka: Number(poUlozeni.vyplata_castka),
                  pozn: poUlozeni.vyplata_poznamka, hodiny: poUlozeni.total_hours }

  // znovu otevřít — musí se to načíst zpátky
  await openWeekEdit(den.worker_id, den.kw, den.kw_year, 'Zkouška', den.work_date)
  await cekej(900)
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
  await sb.from('attendance')
    .update({ bez_vyplaty: false, vyplata_castka: null, vyplata_poznamka: null }).eq('id', den.id)

  const kdo = den.worker_id

  // POZOR — tohle je jádro poctivého měření:
  // Provize i oba docházkové přehledy ukazují VŽDY JEN JEDEN TÝDEN. Výchozí je
  // ten dnešní, jenže v pondělí v něm bývá u člověka jediný záznam — rozdělaná
  // směna s total_hours = null, jejíž hodiny se dopočítávají „do teď", takže
  // sama od sebe roste mezi dvěma měřeními. Označit se navíc nedá (staré znění
  // zkoušky si dny filtrovalo přes .not('total_hours','is',null), takže tenhle
  // řádek vždycky minulo) → čísla se nehnula a zkouška to hlásila jako chybu
  // appky. Měříme proto v posledním týdnu, kde má ten člověk UZAVŘENÉ dny.
  const { data: uzavrene } = await sb.from('attendance').select('*').eq('worker_id', kdo)
    .not('check_out', 'is', null).not('total_hours', 'is', null)
    .order('work_date', { ascending: false }).limit(1)
  if (!uzavrene || !uzavrene.length) return { ...out, chyba: 'v ukázce nemá ten člověk ani jeden uzavřený den' }
  const mericiDen = uzavrene[0]
  const kwText = mericiDen.kw + '-' + mericiDen.kw_year

  provizeMode = 'week'
  provizeAnchor = new Date(mericiDen.work_date + 'T12:00:00')
  await renderProvizeContent(); await cekej(600)
  const [wS, wE] = provizePeriodRange('week', provizeAnchor)
  const odStr = localDateStr(wS), doStr = localDateStr(wE)

  // Všechny jeho záznamy v zobrazeném týdnu — i rozdělané. Kdyby jediný zůstal
  // neoznačený, číslo by nespadlo na nulu a měření by lhalo.
  const { data: dnyC } = await sb.from('attendance').select('id, work_date, total_hours, check_out')
    .eq('worker_id', kdo).gte('work_date', odStr).lte('work_date', doStr)
  const tyden = dnyC || []

  // Kontrolní pracovník: jemu se nesahá na nic. Když se pohnou i jeho čísla,
  // neměříme výjimku, ale něco úplně jiného.
  const { data: vsichni } = await sb.from('attendance').select('worker_id')
    .gte('work_date', odStr).lte('work_date', doStr).not('total_hours', 'is', null)
  const kontrolniKdo = [...new Set((vsichni || []).map(a => a.worker_id))]
    .find(id => id !== kdo && document.getElementById('pv-w-' + id)) || null

  const pred = stav(kdo)
  const kPred = kontrolniKdo ? stav(kontrolniKdo) : null

  for (const d of tyden) await sb.from('attendance').update({ bez_provize_den: true }).eq('id', d.id)
  await renderProvizeContent(); await cekej(600)
  const poBezProvize = stav(kdo)
  const kPoBezProvize = kontrolniKdo ? stav(kontrolniKdo) : null

  for (const d of tyden) await sb.from('attendance').update({ bez_provize_den: false, bez_vyplaty: true }).eq('id', d.id)
  await renderProvizeContent(); await cekej(600)
  const poBezVyplaty = stav(kdo)
  const kPoBezVyplaty = kontrolniKdo ? stav(kontrolniKdo) : null

  for (const d of tyden) await sb.from('attendance').update({ bez_vyplaty: false }).eq('id', d.id)

  out.mereni = {
    tyden: kwText, od: odStr, do: doStr,
    dny: tyden.map(d => d.work_date + ' ' + (d.total_hours == null ? 'rozdělaná' : d.total_hours + ' h')),
  }
  out.provize = { pred, poBezProvize, poBezVyplaty, dnu: tyden.length,
                  kontrolniKdo: !!kontrolniKdo,
                  kontrola: { pred: kPred, poBezProvize: kPoBezProvize, poBezVyplaty: kPoBezVyplaty } }

  // ── zvýraznění v docházce ──
  // Označujeme dny z TOHO týdne, který se pak zobrazí. Staré znění bralo
  // „poslední dny s hodinami" (= minulý týden) a dívalo se do týdne dnešního,
  // takže odznaky hledalo tam, kde žádná výjimka nebyla.
  const { data: jeho } = await sb.from('attendance').select('*').eq('worker_id', kdo)
    .gte('work_date', odStr).lte('work_date', doStr)
    .not('total_hours', 'is', null).not('check_out', 'is', null)
    .order('work_date', { ascending: false }).limit(3)
  if (!jeho || jeho.length < 2) return { ...out, chyba: 'v měřeném týdnu nejsou aspoň dva uzavřené dny' }

  // karta pracovníka
  await openWorkerModal(kdo); await cekej(900)
  wdTab('dochazka', document.querySelector('.wd-tab[onclick*="dochazka"]'))
  await cekej(1400)
  const kwSel = document.getElementById('wd-kw-sel')
  if (!kwSel || ![...kwSel.options].some(o => o.value === kwText)) {
    return { ...out, chyba: 'na kartě pracovníka nejde vybrat týden ' + kwText }
  }
  kwSel.value = kwText
  await loadWdAttendance(); await cekej(900)
  const zmerKartu = () => {
    const radky = [...document.querySelectorAll('#wd-att-table tr')]
    const radekNeplaceno = radky.find(tr => (tr.textContent || '').includes('NEPLACENO'))
    return {
      radku: radky.length,
      maOdznak: !!radekNeplaceno,
      proskrtnuto: radekNeplaceno ? /line-through/.test(radekNeplaceno.getAttribute('style') || '') : false,
      maBezProvize: radky.some(tr => (tr.textContent || '').includes('BEZ PROVIZE')),
    }
  }
  out.kartaPred = zmerKartu()          // negativní kontrola: zatím nic označeného není

  await sb.from('attendance')
    .update({ bez_vyplaty: true, vyplata_poznamka: 'rozbil míchačku' }).eq('id', jeho[0].id)
  await sb.from('attendance').update({ bez_provize_den: true }).eq('id', jeho[1].id)
  out.oznaceno = { neplaceno: jeho[0].work_date, bezProvize: jeho[1].work_date, vTydnu: kwText }

  await loadWdAttendance(); await cekej(900)
  out.karta = zmerKartu()
  const zavri = document.querySelector('#worker-modal .x-close'); if (zavri) zavri.click()
  await cekej(400)

  // týdenní přehled
  sv('dochazka', document.querySelector('button[onclick*="dochazka"]'))
  await cekej(1000)
  const kwGlob = document.getElementById('kw-select')
  if (!kwGlob || ![...kwGlob.options].some(o => o.value === kwText)) {
    return { ...out, chyba: 'v týdenním přehledu nejde vybrat týden ' + kwText }
  }
  kwGlob.value = kwText
  await loadKWData(); await cekej(900)
  const zmerTyden = () => {
    const tr2 = [...document.querySelectorAll('tr.kw-row')].find(x => x.dataset.id === kdo)
    const bunky = tr2 ? [...tr2.querySelectorAll('td.kw-day')] : []
    return {
      radekNalezen: !!tr2, bunek: bunky.length,
      proskrtnutaBunka: bunky.some(td => /line-through/.test(td.innerHTML || '')),
      cervenyPodklad: bunky.some(td => /line-through/.test(td.innerHTML || '') && /red-l/.test(td.getAttribute('style') || '')),
      tecka: bunky.some(td => (td.textContent || '').includes('•')),
      prekryvPopisku: /NEPLACENO|BEZ PROVIZE/.test(tr2 ? tr2.textContent : ''),
    }
  }
  out.tyden = zmerTyden()

  // Uklidit a změřit znovu — negativní kontrola, že zvýraznění umí i zmizet.
  for (const d of jeho) {
    await sb.from('attendance')
      .update({ bez_vyplaty: false, bez_provize_den: false, vyplata_poznamka: null }).eq('id', d.id)
  }
  await loadKWData(); await cekej(900)
  out.tydenPoUklidu = zmerTyden()
  return out
})
await b.close()

if (v.mereni) {
  console.log('\n   měřený týden ' + v.mereni.tyden + ' (' + v.mereni.od + ' – ' + v.mereni.do + ')')
  console.log('   dny v něm: ' + (v.mereni.dny.join(', ') || '(žádné)'))
}
if (v.oznaceno) console.log('   označeno: NEPLACENO ' + v.oznaceno.neplaceno + ', BEZ PROVIZE ' + v.oznaceno.bezProvize)

if (v.poleJsou !== undefined) {
  ok(v.poleJsou, 'v okně jsou obě zaškrtávátka, částka i poznámka')
  ok(v.napoprvePrazdne, 'u běžného dne je všechno prázdné')
  ok(v.ulozeno.bezVyplaty === true && v.ulozeno.castka === 150 && v.ulozeno.pozn === 'rozbil míchačku',
     'výjimka se uloží do docházky')
  ok(v.ulozeno.hodiny != null, 'hodiny dne zůstanou zapsané (' + v.ulozeno.hodiny + ' h)')
  ok(v.nacteno.bezVyplaty === true && v.nacteno.castka === '150' && v.nacteno.pozn === 'rozbil míchačku',
     'po znovuotevření se výjimka načte zpátky')
}
if (v.chyba) { chyb++; console.log('  ❌ ' + v.chyba) }

if (v.provize) {
  console.log('\n── promítne se to do Provizí ──')
  // Bez tohohle je celý zbytek téhle sekce bezcenný: kdyby v měřeném týdnu
  // nebyly žádné peníze, „snížilo se to" by neprošlo ani při rozbité appce.
  ok(v.provize.pred.provize > 0 && v.provize.pred.vydelek > 0 && v.provize.dnu > 0,
     'v měřeném týdnu je vůbec co měřit (' + v.provize.dnu + ' dnů, ' +
     v.provize.pred.provize + ' € provize, ' + v.provize.pred.vydelek + ' € výdělek)')
  ok(v.provize.poBezProvize.provize < v.provize.pred.provize,
     'označené dny sníží provizi (' + v.provize.pred.provize + ' € → ' + v.provize.poBezProvize.provize + ' €)')
  ok(v.provize.poBezProvize.provize === 0,
     'a spadne až na nulu, když jsou označené všechny dny týdne (' + v.provize.poBezProvize.provize + ' €)')
  ok(v.provize.poBezProvize.vydelek === v.provize.pred.vydelek,
     'a výdělku pracovníka se nedotknou (' + v.provize.poBezProvize.vydelek + ' €)')
  ok(v.provize.poBezVyplaty.vydelek < v.provize.pred.vydelek,
     'dny „bez výplaty" sníží výdělek pracovníka (' + v.provize.pred.vydelek + ' € → ' + v.provize.poBezVyplaty.vydelek + ' €)')
  ok(v.provize.poBezVyplaty.provize === v.provize.pred.provize,
     'a naše provize za ně běží dál (' + v.provize.poBezVyplaty.provize + ' €)')
}
if (v.karta) {
  console.log('\n── zvýraznění v docházce ──')
  ok(v.karta.maOdznak, 'na kartě pracovníka je u dne odznak NEPLACENO')
  ok(v.karta.proskrtnuto, 'a celý řádek je proškrtnutý')
  ok(v.karta.maBezProvize, 'den bez provize má svůj odznak')
  ok(v.tyden.radekNalezen && v.tyden.proskrtnutaBunka, 'v týdenním přehledu je den proškrtnutý')
  ok(v.tyden.cervenyPodklad, 'a podbarvený červeně')
  ok(v.tyden.tecka, 'den s jinou výjimkou má tečku')
  ok(!v.tyden.prekryvPopisku, 'v týdenní buňce se nekreslí popisky přes časy')
}
ok(!chybyStranky.filter(x => !/favicon/i.test(x)).length, 'na stránce nenastala chyba')

console.log('\n════ kontrolní vzorky ════')
// Tady se zkouší SAMA ZKOUŠKA: každý řádek musí být „ne", jinak by kontroly
// výš mohly svítit zeleně i nad rozbitou appkou.
const kontroly = [
  ['vynechání dne z faktury', () => hodinyPodleSazeb([{ work_date: '2026-09-08', total_hours: 8, bez_vyplaty: true }], sazba).hodiny !== 0],
  ['pevná částka', () => hodinyPodleSazeb([{ work_date: '2026-09-08', total_hours: 8, vyplata_castka: 100 }], sazba).castka !== 100],
  ['sloupce v odkazu pro odběratele', () => !/bez_vyplaty,bez_provize_den,vyplata_castka/.test(api)],
  // Neoznačený pracovník ve stejném týdnu se hnout nesmí — jinak neměříme výjimku,
  // ale to, že se přehled překreslil.
  ['neoznačený kolega zůstal beze změny', () => {
    const k = v.provize && v.provize.kontrola
    if (!k || !k.pred) return true               // bez kontrolního člověka je měření slabé → hlásit
    return !(k.pred.provize > 0
      && k.poBezProvize.provize === k.pred.provize && k.poBezVyplaty.provize === k.pred.provize
      && k.poBezProvize.vydelek === k.pred.vydelek && k.poBezVyplaty.vydelek === k.pred.vydelek)
  }],
  // Před označením žádný odznak být nesmí — jinak by detektor hlásil „nalezeno" pořád.
  ['před označením žádný odznak není', () => {
    const k = v.kartaPred
    if (!k) return true
    return !(k.radku > 1 && !k.maOdznak && !k.maBezProvize)
  }],
  // A po úklidu musí zvýraznění zase zmizet.
  ['po zrušení výjimek zvýraznění zmizí', () => {
    const t = v.tydenPoUklidu
    if (!t) return true
    return !(t.radekNalezen && !t.proskrtnutaBunka && !t.cervenyPodklad && !t.tecka)
  }],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ VÝJIMKA U DNE FUNGUJE')
process.exit(chyb ? 1 : 0)
