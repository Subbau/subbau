// Odběratel si v odkazu u člověka označí, že s ním ukončil spolupráci, a od kdy.
// Nejdůležitější je, že se BEZ migrace nesmí ztratit fotky a poznámky, které
// tam už má — ty sloupce zatím neexistují a dotaz by na nich spadl.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const KLIENT = path.join(D, 'klient.html')
const API = path.join(D, 'api', 'klient-dochazka.js')
const MIG = path.join(D, 'supabase-migrace-ukoncena-spoluprace.sql')
const zdroj = fs.readFileSync(APP, 'utf8')
const klient = fs.readFileSync(KLIENT, 'utf8')
const api = fs.readFileSync(API, 'utf8')
const mig = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : ''
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }

console.log('\n1) Migrace')
ok(!!mig, 'migrace je připravená')
ok(/add column if not exists spoluprace_ukoncena boolean not null default false/.test(mig),
   'zaškrtnutí má výchozí false — dokud nikdo nic neoznačí, nic se nemění')
ok(/add column if not exists spoluprace_do date/.test(mig), 'datum je zvlášť a smí být prázdné')
ok(/^begin;/m.test(mig) && /^commit;/m.test(mig), 'běží v transakci')
ok(!/drop table|delete from|truncate/i.test(mig), 'nemaže žádná data')

console.log('\n2) Server — zápis i čtení, a ústup bez migrace')
ok(/if \('spoluprace_ukoncena' in telo\)/.test(api), 'zaškrtnutí se ukládá')
ok(/\^\\\\d\{4\}-\\\\d\{2\}-\\\\d\{2\}\$/.test(api) || /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(api),
   'datum se kontroluje na tvar, ne že se uloží cokoliv')
ok(/chyba: 'spatne_datum'/.test(api), 'nesmyslné datum server odmítne')
ok(/spoluprace_ukoncena,spoluprace_do,pozn_tucne,pozn_barva&link_id/.test(api),
   'čte se to zpátky do odkazu')
ok(/if \(e\.kod !== '42703' && e\.stav !== 400\) throw e/.test(api),
   'bez migrace se dotaz zopakuje bez nových sloupců — fotky a poznámky se neztratí')
ok(/pz = await db\(\s*\n\s*`client_link_workers\?select=worker_id,foto,poznamka,hodnoceni&link_id/.test(api),
   'a ten náhradní dotaz tam opravdu je')
ok(!/spoluprace_neexistujici/.test(api), 'kontrolní měření: test umí i nenajít')

console.log('\n3) Stránka pro odběratele — dvojjazyčně')
ok(/Zusammenarbeit beendet · ukončena spolupráce/.test(klient), 'zaškrtávátko je německy i česky')
ok(/'am · dne '/.test(klient), 'popisek u data taky')
ok(/onchange="ulozUkonceni\(this\)"/.test(klient) && /onchange="ulozDatumUkonceni\(this\)"/.test(klient),
   'obojí se ukládá samo')
ok(/type="date"/.test(klient), 'datum se vybírá z kalendáře, nepíše se ručně')
ok(/telo\.spoluprace_do = ''/.test(klient), 'odškrtnutím se zahodí i datum, ať tam nestraší staré')
ok(/\.clovek\.skoncil\{opacity:\.72/.test(klient), 'karta takového člověka zešedne')
ok(/@media print\{[\s\S]{0,200}\.konec-obal input/.test(klient),
   'na tisku se ovládání schová (odběratel to tiskne a posílá dál)')
ok(/function datumPlne/.test(klient) && /\+ d\.getFullYear\(\)/.test(klient),
   'u data je i rok — jinak by se za rok nedalo poznat, kterého')
ok(/function oznacKartu/.test(klient) && !/vykresli\(\)/.test(klient),
   'po zaškrtnutí se překreslí jen ta jedna karta, ne celá stránka (jinak by přišel o rozepsanou poznámku)')

console.log('\n4) Appka — SubBau to musí vidět')
ok(/spoluprace_ukoncena, spoluprace_do, pozn_tucne, pozn_barva, upraveno/.test(zdroj),
   'načítá se to k poznámkám odběratele')
ok(/r\.hodnoceni \|\| r\.spoluprace_ukoncena/.test(zdroj),
   'ukáže se i člověk, u kterého odběratel označil JEN ukončení')
ok(/🚫 Odběratel ukončil spolupráci/.test(zdroj), 'je to vidět jako červený odznak')
ok(/' · datum neuvedl'/.test(zdroj), 'a když datum nevyplnil, je to napsané — ne prázdno')
ok(/if \(error && \/spoluprace\|pozn_tucne\|pozn_barva\|42703\|column\/i\.test/.test(zdroj),
   'i tady je ústup, kdyby migrace ještě neproběhla')

console.log('\n5) Dovolená v hlavičce karty')
ok(/vacations\?select=worker_id,date_from,date_to,type,note/.test(api), 'odkaz načítá dovolené')
ok(/date_to=gte\.\$\{od\}/.test(api), 'bere i budoucí — odběratel má vědět dopředu, kdo nepřijde')
ok(/a\.type === 'nemoc'/.test(api) && /\/\^nemoc\/i\.test/.test(api),
   'nemoc pozná i u starších záznamů, které mají typ jen v poznámce')
ok(/dovolene \}\);|radky, tydny, poznamky, dovolene, uhrazeno/.test(api), 'a posílá je na stránku')
ok(/function absenceHtml/.test(klient), 'stránka je umí vykreslit')
ok(/Urlaub · dovolená/.test(klient) && /Krankheit · nemoc/.test(klient), 'dvojjazyčně')
ok(/datumPlne\(a\.od\)/.test(klient) && /' – ' \+ datumPlne\(a\.do\)/.test(klient),
   'je vidět od kdy do kdy, i s rokem')
ok(/catch \(e\) \{ console\.warn\('\[klient\] dovolené se nenačetly/.test(api),
   'kdyby se dovolené nenačetly, zbytek stránky běží dál')

console.log('\n6) Poznámka tučně a barevně')
ok(/pozn_tucne boolean not null default false/.test(mig), 'migrace má tučné')
ok(/pozn_barva in \('cervena','oranzova','zelena','modra','cerna'\)/.test(mig),
   'a barvu jen z povoleného seznamu — ne libovolný text')
ok(/const BARVY_POZNAMKY = \['cervena', 'oranzova', 'zelena', 'modra', 'cerna'\]/.test(api),
   'server pouští jen ty barvy')
ok(/zmena\.pozn_barva = BARVY_POZNAMKY\.includes\(b\) \? b : null/.test(api),
   'co není v seznamu, uloží se jako bez barvy (nedá se propašovat kus stylu)')
ok(/function stylPoznamky/.test(klient) && /kusy\.push\('font-weight:800'\)/.test(klient),
   'styl se skládá na stránce z názvu barvy, ne že by chodil hotový z databáze')
ok(/onclick="prepniTucne/.test(klient) && /onclick="dejBarvu/.test(klient), 'ovládání je u poznámky')
ok(/@media print\{\.pozn-nastroje\{display:none\}\}/.test(klient), 'na tisku se ovládání schová')
ok(/function obnovStylPoznamky/.test(klient),
   'přebarví se jen ta poznámka, ne celá stránka (jinak by přišel o rozepsané)')
ok(/const BARVY_POZNAMKY_ODBERATELE/.test(zdroj), 'appka zná stejné barvy')
ok(/r\.pozn_tucne \? 'font-weight:800;' : ''/.test(zdroj),
   'a ukáže SubBau poznámku tak, jak ji vidí odběratel')

console.log('\n7) Prohlížeč — appka se s tím načte')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + path.join(D, 'ukazka.html'), { waitUntil: 'networkidle0', timeout: 25000 })
  await new Promise(r => setTimeout(r, 1500))
  const v = await p.evaluate(() => ({
    fce: typeof window.ukazPoznamkyOdberatele === 'function',
    text: document.body.innerText.trim().length
  }))
  ok(v.fce, 'poznámky odběratele jsou pořád dostupné')
  ok(v.text > 100, 'stránka se vykreslila')
  ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Ukončená spolupráce funguje')
process.exit(chyby ? 1 : 0)
