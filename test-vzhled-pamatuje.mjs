// Vzhled faktury se pamatuje u ČLOVĚKA a platí i další týdny. Jde přehodit
// rovnou v přehledu faktur. Nový člověk dostane ten nejméně používaný.
// A hlavně: databáze musí vzhledy 11–20 vůbec povolit — dosud je odmítala.
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
const MIG = path.join(D, 'supabase-migrace-vzhledy-11-az-20.sql')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Migrace — bez ní se vzhledy 11–20 neuloží')
const mig = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : ''
ok(!!mig, 'migrace je připravená')
ok(/invoice_design between 1 and 20/.test(mig), 'povoluje vzhled 1–20 u pracovníka')
ok(/design_idx between 1 and 20/.test(mig), 'a u vystavené faktury taky')
ok(/^begin;/m.test(mig) && /^commit;/m.test(mig), 'běží v transakci')
ok(/drop constraint if exists profiles_invoice_design_check/.test(mig) &&
   /drop constraint if exists worker_invoices_design_idx_check/.test(mig),
   'jména podmínek sedí s původními migracemi, jinak by se jen přidala druhá')
ok(!/drop table|delete from|truncate/i.test(mig), 'nemaže žádná data')

console.log('\n2) Kód — desítka zmizela ze všech pojistek')
ok(/n < 1 \|\| n > POCET_VZHLEDU/.test(zdroj), 'ukládání pustí i vzhledy nad 10')
ok(!/n < 1 \|\| n > 10/.test(zdroj), 'a stará natvrdo psaná desítka je pryč')
ok(/i \+ ' z ' \+ POCET_VZHLEDU/.test(zdroj), 'počítadlo v náhledu se řídí skutečným počtem')
ok(!/projít všech 10 vzhledů/.test(zdroj), 'popisek tlačítka už nelže o počtu')
ok(/invoice_design_check\|violates check constraint/.test(zdroj),
   'když databáze vzhled odmítne, appka řekne kterou migraci spustit — ne „něco se nepovedlo"')

console.log('\n3) Vzhled se pamatuje a jde měnit z přehledu')
ok(/async function vzhledProNovouFakturu/.test(zdroj) && /designIdx: vzhledFaktury/.test(zdroj),
   'nová faktura se vystaví ve vzhledu uloženém u člověka — platí tedy i další týdny')
ok(/order\('created_at', \{ ascending: false \}\)\.limit\(1\)/.test(zdroj),
   'když v profilu nic není, zkopíruje se vzhled z POSLEDNÍ faktury')
ok(/\.not\('design_idx', 'is', null\)/.test(zdroj),
   'a to jen z faktury, která nějaký vzhled opravdu má')
ok(/invoice_color, can_track_hours, is_active, invoice_design\)/.test(zdroj),
   'přehled faktur si natáhne i vzhled nastavený u člověka')
ok(/onchange="event\.stopPropagation\(\);ulozVzhledZPrehledu\(this,'\$\{r\.worker_id\}'\)"/.test(zdroj),
   'v přehledu je rolovací výběr a klik nepropadne na řádek pod ním')
ok(/async function ulozVzhledZPrehledu/.test(zdroj), 'a ukládá se rovnou')
ok(/select\('invoice_design'\)\.eq\('id', workerId\)\.maybeSingle\(\)/.test(zdroj),
   'po uložení se ověří, že to databáze opravdu vzala (PostgREST hlásí úspěch i když nic nezapsal)')
ok(/platí od příští faktury/.test(zdroj),
   'když se nastavený vzhled liší od toho na faktuře, je napsané že platí až příště')

console.log('\n4) Nový člověk dostane nejméně používaný vzhled')
ok(/async function prideliNejmenePouzivanyVzhled/.test(zdroj), 'funkce existuje')
ok(/function nejmenePouzivanyVzhled\(seznam\)/.test(zdroj) &&
   /const nejlepsi = nejmenePouzivanyVzhled\(data \|\| \[\]\)/.test(zdroj),
   'výpočet je oddělený od databáze, takže se dá změřit')
ok(/if \(prof\.invoice_design != null\) return prof\.invoice_design/.test(zdroj),
   'komu už vzhled nastavíte ručně, tomu ho to nepřepíše')
ok(/await prideliNejmenePouzivanyVzhled\(workerId, prof\)/.test(zdroj),
   'volá se při první faktuře, stejně jako přidělení barvy')
ok(/\.eq\('id', workerId\)\.select\('id'\)/.test(zdroj), 'zápis si ověří, že trefil řádek')
ok(!/NEEXISTUJICI_VZHLED_FUNKCE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n5) Prohlížeč — opravdu vybere ten nejméně používaný')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 25000 })
  await p.waitForFunction(() => typeof window.prideliNejmenePouzivanyVzhled === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const out = {}
    out.pocet = POCET_VZHLEDU
    out.nazvu = Object.keys(NAZVY_VZHLEDU).length

    // Výpočet je oddělený od databáze, takže se dá změřit přímo.
    // Všichni mají 1–19, dvacítku nikdo → nový člověk má dostat 20.
    const obsazene = []
    for (let i = 1; i <= 19; i++) obsazene.push({ invoice_design: i })
    obsazene.push({ invoice_design: 1 })
    out.vybrano = nejmenePouzivanyVzhled(obsazene)

    // Když nikdo nic nemá, ať to vrátí jedničku a ne nesmysl.
    out.prazdno = nejmenePouzivanyVzhled([])

    // Nesmysly v datech (null, text, číslo mimo rozsah) nesmí výpočet rozhodit.
    out.smeti = nejmenePouzivanyVzhled([{invoice_design: null}, {invoice_design: 'x'}, {invoice_design: 999}])

    // Kontrolní měření: když je nejméně používaná pětka, musí vyjít pětka.
    const jinak = []
    for (let i = 1; i <= POCET_VZHLEDU; i++) if (i !== 5) { jinak.push({invoice_design:i}); jinak.push({invoice_design:i}) }
    jinak.push({invoice_design:5})
    out.patka = nejmenePouzivanyVzhled(jinak)

    // A komu je vzhled nastavený, tomu se nesmí přepsat.
    const profSVzhledem = { invoice_design: 3 }
    out.nechalByt = await prideliNejmenePouzivanyVzhled('kdokoliv', profSVzhledem)
    return out
  })

  ok(v.pocet === 20 && v.nazvu === 20, 'appka zná všech 20 vzhledů')
  ok(v.vybrano === 20, `vybral nejméně používaný vzhled (dostal ${v.vybrano}, čekal 20)`)
  ok(v.patka === 5, `kontrolní měření: když chybí pětka, vybere pětku (dostal ${v.patka})`)
  ok(v.prazdno === 1, 'u prázdné databáze vrátí vzhled 1')
  ok(v.smeti >= 1 && v.smeti <= 20, 'nesmysly v datech výpočet nerozhodí')
  ok(v.nechalByt === 3, 'komu je vzhled nastavený, tomu ho nepřepíše')
  ok(padky.length === 0, 'stránka nespadla' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Vzhled faktury se pamatuje a 11–20 jsou konečně použitelné')
process.exit(chyby ? 1 : 0)
