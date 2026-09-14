// Docházka se musí zapsat i BEZ GPS a bez adresy stavby.
// Přesně tenhle případ hlásili lidé z terénu: „pauza vůbec nešla odkliknout,
// protože to nevidělo polohu". Na nasazené verzi se v tom stavu nezapsalo nic.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const UKAZKA = path.join(D, 'ukazka.html')

// Ukázka se generuje z ostré appky. Bez téhle kontroly by test klidně měřil
// starý kód a tvářil se spokojeně.
function stejnaVerze() {
  const v = s => (fs.readFileSync(s, 'utf8').match(/SUBBAU_VERZE\s*=\s*'([^']+)'/) || [])[1]
  const a = v(APP), b = v(UKAZKA)
  if (!a || a !== b) { console.error(`❌ ukázka je stará (appka ${a}, ukázka ${b}) — spusť node ukazka/generuj.mjs`); process.exit(1) }
}

const zdroj = fs.readFileSync(APP, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }

stejnaVerze()

console.log('\n1) Kód — blokování je pryč')
ok(!/if \(type !== 'in' && attAddressMissing\(\)\)[\s\S]{0,400}?\n    return\n  \}/.test(zdroj),
   'mobCheckin nekončí returnem, když chybí adresa')
ok(/const chybiAdresa = \(type !== 'in' && attAddressMissing\(\)\)/.test(zdroj),
   'chybějící adresa se jen pozná, panel se ukáže')
ok(!/bez ní nejde pokračovat/.test(zdroj), 'zmizela nepravdivá hláška „bez ní nejde pokračovat"')
ok(!/showToast\('📍 Nejdřív vyplňte adresu stavby'\)/.test(zdroj), 'zmizelo „Nejdřív vyplňte adresu stavby"')
ok(/todayAttId \? '✅ Adresa uložena'/.test(zdroj), 'ruční adresa hlásí úspěch jen když se opravdu uložila')
ok(/\.eq\('id', todayAttId\)\.select\('id'\)/.test(zdroj), 'zápis ruční adresy si ověří, že trefil řádek')
ok(/async function ulozAdresuDne/.test(zdroj), 'existuje ověřený zápis adresy ulozAdresuDne')
ok(!/TATO_VETA_V_KODU_NIKDY_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — celý den bez GPS a bez adresy')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  // Nativní confirm by stránku zablokoval napořád; u odchodu se ptá na potvrzení.
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  // GPS úmyslně NEPOVOLENÁ — stejně jako uvnitř budovy nebo v hale.
  await b.defaultBrowserContext().clearPermissionOverrides()
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.mobCheckin === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    localStorage.removeItem('lastConstructionSite')   // ať se adresa nevezme z minula
    const t = []
    window.showToast = (m) => { t.push(String(m)) }
    const kroky = []
    const zkus = async (typ) => {
      let dobehlo = false
      await Promise.race([
        window.mobCheckin(typ).then(() => { dobehlo = true }),
        new Promise(r => setTimeout(r, 10000))
      ])
      await new Promise(r => setTimeout(r, 600))
      kroky.push({ typ, dobehlo, toasty: t.splice(0) })
    }
    await zkus('in')
    await zkus('break-start')
    await zkus('break-start')   // kontrolní: podruhé už musí říct, že pauza běží
    await zkus('break-end')
    return { kroky, panel: document.getElementById('mob-manual-addr')?.style.display }
  })

  const k = Object.fromEntries(v.kroky.map((x, i) => [i, x]))
  ok(k[0].dobehlo && k[0].toasty.some(s => /Příchod zaznamenán/.test(s)), 'příchod se zapsal')
  ok(k[1].dobehlo && k[1].toasty.some(s => /Přestávka začala/.test(s)),
     'PAUZA se zapsala i bez GPS a bez adresy' + (k[1].toasty.length ? ' — ' + k[1].toasty[0] : ' (žádná hláška)'))
  // Kontrolní měření: kdyby test jen sbíral prázdno, tahle věta by neprošla.
  ok(k[2].toasty.some(s => /již probíhá/.test(s)), 'kontrola měří: druhá pauza hlásí „již probíhá"')
  ok(k[3].dobehlo && k[3].toasty.some(s => /Pokračuješ v práci/.test(s)), 'konec pauzy se zapsal')
  ok(v.panel === 'block', 'panel na doplnění adresy se přitom pracovníkovi ukázal')
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Docházka jde zapsat i bez GPS, adresa se doptá potom')
process.exit(chyby ? 1 : 0)
