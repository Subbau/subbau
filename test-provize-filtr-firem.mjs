// Provize: u každé firmy zaškrtávátko. Automaticky zaškrtnuté všechny.
// Odškrtnutá firma vypadne ze součtů nahoře — a MUSÍ vypadnout ze VŠECH,
// ne jen z těch ročních. Nesedící dlaždice by byly horší než žádný filtr.
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

console.log('\n1) Kód — filtr sedí na všech součtech, ne jen na některých')
ok(/function firmaVProvizich\(nazev\) \{\s*\n\s*return !odskrtnuteFirmy\(\)\.has\(nazev \|\| 'Bez firmy'\)/.test(zdroj),
   'jedno místo rozhoduje, jestli se firma počítá')
ok(/Ukládáme ODŠKRTNUTÉ, ne zaškrtnuté/.test(zdroj),
   'ukládají se odškrtnuté — nová firma je tak zaškrtnutá sama od sebe')
ok(/if \(!firmaVProvizich\(r\.firm\)\) return\n\s*souhrn\.day/.test(zdroj),
   'hlavní souhrn (hodiny i peníze) filtr respektuje')
ok(/if \(!firmaVProvizich\(firmaPodleId\[a\.worker_id\]\)\) return/.test(zdroj),
   'dlaždice „dnes v práci" taky')
ok(/if \(!firmaVProvizich\(firmOf\(w\)\)\) return/.test(zdroj),
   'a dnešní provize i hodiny taky (jinak by čísla proti sobě nesedělá)')
ok(/prepniFirmuVProvizich\(this,\$\{JSON\.stringify\(firm\)\}\)/.test(zdroj),
   'zaškrtávátko je v hlavičce firmy a jméno firmy je bezpečně vložené')
ok(/firmaVProvizich\(firm\) \? 'checked' : ''/.test(zdroj), 'výchozí stav je zaškrtnuto')
ok(/Čísla jsou jen za \$\{zapnute\} z \$\{vsechny\} firem/.test(zdroj),
   'nad čísly je vidět, že filtr běží — jinak by se správce divil')
ok(/function zapniVsechnyFirmy/.test(zdroj), 'jde to jedním tlačítkem vrátit')
ok(/await prekresliProvize\(\)/.test(zdroj), 'překresluje se tak, aby neuteklo rolování')
ok(/lsSet\(PROVIZE_FILTR_KLIC/.test(zdroj) && /lsGet\(PROVIZE_FILTR_KLIC/.test(zdroj),
   'ukládá se přes bezpečné obaly (na iPhonu v anonymním okně localStorage hází chybu)')
ok(!/firmaVProvizich\(NECO_CO_NEEXISTUJE\)/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — chování filtru')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 25000 })
  await p.waitForFunction(() => typeof window.firmaVProvizich === 'function', { timeout: 20000 })

  const v = await p.evaluate(() => {
    const out = {}
    try { localStorage.removeItem(PROVIZE_FILTR_KLIC) } catch (e) {}

    // ── A) bez nastavení jsou zaškrtnuté všechny, i firma, o které nikdo neslyšel ──
    out.vychoziZnama = firmaVProvizich('Treskower')
    out.vychoziNeznama = firmaVProvizich('Úplně nová firma s.r.o.')
    out.vychoziBezFirmy = firmaVProvizich('Bez firmy')

    // ── B) odškrtnutí ──
    prepniFirmuVProvizich({ checked: false }, 'Treskower')
    out.poOdskrtnuti = firmaVProvizich('Treskower')
    out.ostatniNedotcene = firmaVProvizich('Jiná firma')

    // ── C) přežije to znovunačtení stránky? (uloženo v prohlížeči) ──
    out.ulozeno = (() => { try { return localStorage.getItem(PROVIZE_FILTR_KLIC) } catch (e) { return null } })()

    // ── D) zaškrtnutí zpátky ──
    prepniFirmuVProvizich({ checked: true }, 'Treskower')
    out.poZaskrtnuti = firmaVProvizich('Treskower')

    // ── E) „Zapnout všechny" ──
    prepniFirmuVProvizich({ checked: false }, 'A')
    prepniFirmuVProvizich({ checked: false }, 'B')
    out.dveOdskrtnute = !firmaVProvizich('A') && !firmaVProvizich('B')
    zapniVsechnyFirmy()
    out.poZapnutiVsech = firmaVProvizich('A') && firmaVProvizich('B')

    // ── F) rozbitý obsah v úložišti nesmí sekci shodit ──
    try { localStorage.setItem(PROVIZE_FILTR_KLIC, 'tohle není JSON') } catch (e) {}
    out.prezijeSmeti = firmaVProvizich('Cokoliv')
    try { localStorage.removeItem(PROVIZE_FILTR_KLIC) } catch (e) {}
    return out
  })

  ok(v.vychoziZnama && v.vychoziNeznama && v.vychoziBezFirmy,
     'bez nastavení se počítají všechny firmy včetně „Bez firmy"')
  ok(v.poOdskrtnuti === false, 'odškrtnutá firma se nepočítá')
  ok(v.ostatniNedotcene === true, 'ostatní firmy zůstávají (kontrolní měření)')
  ok(typeof v.ulozeno === 'string' && v.ulozeno.includes('Treskower'),
     'volba přežije zavření stránky')
  ok(v.poZaskrtnuti === true, 'zaškrtnutím se firma vrátí')
  ok(v.dveOdskrtnute === true, 'odškrtnout jde víc firem naráz')
  ok(v.poZapnutiVsech === true, '„Zapnout všechny" to vrátí do výchozího stavu')
  ok(v.prezijeSmeti === true, 'poškozené uložené nastavení appku neshodí — počítá se všechno')
  ok(padky.length === 0, 'stránka nespadla' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Filtr firem v provizích funguje')
process.exit(chyby ? 1 : 0)
