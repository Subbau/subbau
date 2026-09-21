// Úprava faktury: kalendářní týden (KW) a německý název staženého PDF.
//
// Proč to hlídat:
//   1. Podle KW se v Provizích páruje „uhrazeno". Když se týden na faktuře
//      změní, musí se přesunout i ta značka — jinak visí u týdne, ke kterému
//      žádná faktura není, a u nového chybí.
//   2. Faktura se dá stáhnout DVĚMA cestami a jen jedna byla německy.
//      Odběratel si soubor přejmenovávat nebude.
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
ok(/return 'Rechnung' \+ \(num \? '_' \+ num : ''\)/.test(zdroj),
   'stažené PDF z otevřené faktury se jmenuje Rechnung, ne Faktura')
ok(!/return 'Faktura' \+ \(num/.test(zdroj), 'a stará česká podoba je pryč')
ok(/'Rechnung_' \+ cis/.test(zdroj), 'druhá cesta stahování (z přehledu) je německy pořád')
ok(/id="invedit-kw"/.test(zdroj) && /id="invedit-kw-rok"/.test(zdroj),
   'v úpravě faktury je pole pro týden i rok')
ok(/kw: kwNovy, kw_year: kwRokNovy/.test(zdroj), 'a opravdu se ukládají')
ok(/Týden musí být číslo od 1 do 53/.test(zdroj), 'nesmyslný týden se odmítne')
ok(/Vyplňte týden i rok, nebo ani jedno/.test(zdroj),
   'půlka údaje neprojde — podle dvojice se páruje provize')
ok(/const kwZmeneno = String\(r\.kw \?\? ''\) !== String\(kwNovy \?\? ''\)/.test(zdroj),
   'appka pozná, že se týden změnil')
ok(/if \(kwZmeneno && byloZaplaceno\)[\s\S]{0,400}syncProvizePaidFromInvoice\(r\.worker_id, r\.kw, r\.kw_year, false\)/.test(zdroj),
   'u zaplacené faktury se „uhrazeno" odepíše ze starého týdne')
ok(/syncProvizePaidFromInvoice\(r\.worker_id, kwNovy, kwRokNovy, true\)/.test(zdroj),
   'a zapíše se k novému')
ok(/Dělá se AŽ TEĎ, po úspěšném/.test(zdroj),
   'přesun se dělá až po úspěšném zápisu faktury, ne před ním')
ok(!/TAKOVY_KOD_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — skutečné proklikání')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1800))

  const v = await p.evaluate(async () => {
    const out = {}
    out.nazev = invoiceFileName()
    const sekce = document.getElementById('v-faktury-archiv')
    if (!sekce) return { chyba: 'sekce Faktury nenalezena' }
    document.querySelectorAll('.view').forEach(x => x.classList.remove('on'))
    sekce.classList.add('on'); sekce.style.display = 'block'
    await loadWorkerInvoices(); await new Promise(r => setTimeout(r, 700))
    const prvni = (typeof _invCache !== 'undefined' ? _invCache : [])[0]
    if (!prvni) return { ...out, chyba: 'v ukázce není faktura' }
    out.pred = prvni.kw + '/' + prvni.kw_year

    openInvoiceEdit(prvni.id); await new Promise(r => setTimeout(r, 600))
    const kw = document.getElementById('invedit-kw')
    const rok = document.getElementById('invedit-kw-rok')
    out.jePole = !!kw && !!rok
    out.predvyplneno = kw.value + '/' + rok.value

    // Ukázkové faktury nemají položky ani IBAN — doplníme je, jinak se
    // ukládání zastaví dřív, než se dostane ke kontrole týdne.
    const nastav = (id, hodnota) => {
      const el = document.getElementById(id)
      if (el) { el.value = hodnota; el.dispatchEvent(new Event('input', { bubbles: true })) }
    }
    nastav('invedit-item', 'Zkušební položka')
    nastav('invedit-price', '100')
    if (!document.getElementById('invedit-iban')?.value.trim()) {
      nastav('invedit-iban', 'DE02120300000000202051')
    }
    await new Promise(r => setTimeout(r, 200))

    const hlasky = []
    const puvodniToast = window.showToast
    window.showToast = (m) => hlasky.push(String(m))

    kw.value = '99'
    await saveInvoiceEdit(); await new Promise(r => setTimeout(r, 400))
    out.nesmysl = hlasky.join(' | ')

    hlasky.length = 0
    kw.value = ''
    await saveInvoiceEdit(); await new Promise(r => setTimeout(r, 400))
    out.pulka = hlasky.join(' | ')

    hlasky.length = 0
    kw.value = '40'; rok.value = String(prvni.kw_year)
    await saveInvoiceEdit(); await new Promise(r => setTimeout(r, 900))
    window.showToast = puvodniToast
    const po = (typeof _invCache !== 'undefined' ? _invCache : []).find(x => x.id === prvni.id)
    out.po = po ? po.kw + '/' + po.kw_year : '(nenalezeno)'
    return out
  })

  if (v.chyba) { chyby++; console.log('  ❌ ' + v.chyba) }
  else {
    ok(/^Rechnung/.test(v.nazev), `stažené PDF se jmenuje německy (${v.nazev})`)
    ok(v.jePole, 'pole pro týden a rok v okně jsou')
    ok(v.predvyplneno === v.pred, `předvyplní se týden té faktury (${v.predvyplneno})`)
    ok(/1 do 53/.test(v.nesmysl), `týden 99 se odmítne — „${v.nesmysl}"`)
    ok(/týden i rok/.test(v.pulka), `samotný rok bez týdne se odmítne — „${v.pulka}"`)
    ok(v.po.startsWith('40/'), `uložený týden se změnil (${v.pred} → ${v.po})`)
    ok(v.pred !== v.po, 'kontrolní měření: před uložením to bylo opravdu něco jiného')
    ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
  }
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ KW se dá upravit a PDF se stahuje německy')
process.exit(chyby ? 1 : 0)
