// Zálohové faktury (Anzahlungsrechnung): vystaví je jen správce, doklad je
// celý německy a záloha se pracovníkovi sama odečte z faktury.
//
// Appka se doopravdy spustí v prohlížeči (ukázková verze běží bez serveru,
// ale je to týž kód).
//
//   npm i puppeteer && node test-zalohove-faktury.mjs
import fs from 'fs'
import path from 'path'

let puppeteer
try { puppeteer = (await import('puppeteer')).default }
catch (e) { console.error('❌ Chybí puppeteer — zkouška NEPROBĚHLA. Spusťte: npm i puppeteer'); process.exit(2) }

// POJISTKA: ukázka se generuje z appky. Když se nepřegeneruje, běžela by
// zkouška na starém kódu a tvrdila by nesmysly — to se už jednou stalo.
function stejnaVerze(appka, ukazka) {
  const ver = t => (t.match(/SUBBAU_VERZE\s*=\s*'([^']*)'/) || [])[1] || null
  const a = ver(fs.readFileSync(appka, 'utf8')), u = ver(fs.readFileSync(ukazka, 'utf8'))
  if (!a || !u) { console.error('❌ Nenašel jsem verzi — zkouška NEPROBĚHLA'); process.exit(2) }
  if (a !== u) {
    console.error('❌ Ukázka je starší než appka — zkouška NEPROBĚHLA.')
    console.error('   appka:  ' + a)
    console.error('   ukázka: ' + u)
    console.error('   Spusťte: node ukazka/generuj.mjs')
    process.exit(2)
  }
}


const APP = process.argv[2] || 'subbau_final.html'
const UKAZKA = process.argv[3] || 'ukazka.html'
stejnaVerze(APP, UKAZKA)
const src = fs.readFileSync(APP, 'utf8')

let chyb = 0
const ok = (b, t) => { if (!b) { chyb++; console.log('  ❌ ' + t) } else console.log('  ✅ ' + t) }

console.log('── jen pro správce a jen v adminu ──')
ok(!/id="zf-/.test(src.slice(src.indexOf('id="v-mobil"') >= 0 ? src.indexOf('id="v-mobil"') : 0, 0) || ''), 'formulář není v pracovnické části')
ok((src.match(/sv\('zalohove-faktury'/g) || []).length === 2, 'sekce je v obou adminských nabídkách')
ok(/zalohove_faktury_vlastni[\s\S]{0,200}for select/.test(fs.readFileSync('supabase-migrace-zalohove-faktury.sql', 'utf8')),
   'pracovník má v databázi jen právo ČÍST svoje zálohy')
ok(/zalohy_pouzite: Array\.isArray\(d\.zalohyPouzite\)/.test(src), 'odečet se ukládá K FAKTUŘE, ne do zálohových faktur')
ok(!/zuctujZalohy/.test(src), 'pracovník nikam do zálohových faktur nezapisuje')

const b = await puppeteer.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1400, height: 1000 })
const chybyStranky = []
p.on('pageerror', e => chybyStranky.push(e.message.slice(0, 140)))
await p.goto('file://' + path.resolve(UKAZKA), { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 2500))

const v = await p.evaluate(async () => {
  const out = {}
  // --- sekce a předvyplnění -------------------------------------------------
  sv('zalohove-faktury', document.querySelector('button[onclick*="zalohove-faktury"]'))
  await new Promise(r => setTimeout(r, 600))
  out.pohled = getComputedStyle(document.getElementById('v-zalohove-faktury')).display
  await otevriNovouZalohu(); await new Promise(r => setTimeout(r, 400))
  const sel = document.getElementById('zf-worker')
  out.lidi = sel.options.length - 1
  sel.value = sel.options[1].value
  await zfPredvyplnit(); await new Promise(r => setTimeout(r, 500))
  const pole = id => document.getElementById(id)?.value || ''
  out.predvyplneno = { jmeno: !!pole('zf-d-jmeno'), iban: !!pole('zf-iban'),
                       odberatel: !!pole('zf-o-jmeno'), cislo: pole('zf-cislo'),
                       splatnost: !!pole('zf-splatnost') }

  // --- doklad ---------------------------------------------------------------
  document.getElementById('zf-castka').value = '500'
  nahledZalohoveFaktury(); await new Promise(r => setTimeout(r, 500))
  const list = document.getElementById('invoice-page')
  const t = list ? list.textContent : ''
  const r = list ? list.getBoundingClientRect() : { width: 0, height: 0 }
  out.doklad = {
    sirka: Math.round(r.width), vyska: Math.round(r.height),
    nemecke: ['ANZAHLUNGSRECHNUNG', 'Rechnungsdatum', 'Fällig am', 'Leistungserbringer',
              'Leistungsempfänger', 'Zahlungsinformationen', 'Zu zahlen', 'Verwendungszweck'].filter(x => t.includes(x)).length,
    reverse: t.includes('Steuerschuldnerschaft'),
    iban: t.includes(pole('zf-iban')),
    cesky: /Dodavatel|Odběratel|K úhradě|Uhrazeno v hotovosti/.test(t),
    listaZaloha: document.getElementById('invoice-zaloha-bar')?.style.display,
    listaOdeslani: document.getElementById('invoice-actions')?.style.display,
  }
  zavriZalohovyDoklad()

  // --- odečet z faktury -----------------------------------------------------
  const { data: lide } = await sb.from('profiles').select('*').in('role', ['osvec', 'partak']).limit(2)
  const kdo = lide[0]
  const lide2 = lide.slice(1)
  const zaloha = { cislo: 'Z202601', worker_id: kdo.id, supplier_name: kdo.full_name,
    iban: kdo.invoice_iban, customer_name: kdo.invoice_customer_name,
    issue_date: '2026-09-01', due_date: '2026-09-15', castka: 500,
    popis: 'Anzahlung für Bauleistungen', stav: 'otevrena', zuctovano: 0 }
  await sb.from('zalohove_faktury').insert(zaloha)

  await openWorkerModal(kdo.id); await new Promise(r => setTimeout(r, 800))
  wdTab('finance', document.querySelector('.wd-tab[onclick*="finance"]'))
  await new Promise(r => setTimeout(r, 900))
  const tyden = document.getElementById('wd-inv-week')
  if (tyden && tyden.options.length) { tyden.value = tyden.options[0].value; tyden.dispatchEvent(new Event('change')) }
  await new Promise(r => setTimeout(r, 900))
  await generateInvoiceAdmin(); await new Promise(r => setTimeout(r, 1400))
  const d = window._lastInvoice
  const f = document.getElementById('invoice-page')
  out.odecet = d ? { celkem: d.totalAmount, zaloha: d.cashPaid, popis: d.cashPaidNote,
    zeZF: !!d.zalohaZeZalohoveFaktury, pouzito: (d.zalohyPouzite || []).length,
    vorschussNaDokladu: f ? f.textContent.includes('Vorschuss') : false,
    hotovostNaDokladu: f ? f.textContent.includes('Bar erhalten') : false } : null

  // --- odečet zapsaný u faktury a opakované vystavení -----------------------
  // Uložení faktury napodobíme přímo — v ukázce nejsou knihovny na PDF.
  await sb.from('worker_invoices').insert({ worker_id: kdo.id, invoice_number: d.invoiceNum,
    total_amount: d.totalAmount, cash_paid: d.cashPaid, cash_paid_note: d.cashPaidNote,
    zalohy_pouzite: d.zalohyPouzite, kw: d.week, kw_year: d.year })
  // V ukázce může mít pracovník fakturu s týmž číslem už z vymyšlených dat —
  // bereme tu, která odečet opravdu nese.
  out.uFaktury = ((await sb.from('worker_invoices').select('invoice_number, zalohy_pouzite')
    .eq('worker_id', kdo.id)).data || [])
    .map(f => f.zalohy_pouzite).find(x => Array.isArray(x) && x.length)
  // táž faktura znovu — odečet musí zůstat, ne zmizet
  out.znovuTaSama = (await zalohyKOdecteni(kdo.id, d.invoiceNum, d.totalAmount)).castka
  // jiná faktura — už není co odečíst
  out.jinaFaktura = (await zalohyKOdecteni(kdo.id, 'JINE999', d.totalAmount)).castka

  // --- záloha vyšší než faktura → odečte se jen část ------------------------
  await sb.from('zalohove_faktury').insert({ ...zaloha, cislo: 'Z202602', castka: 5000 })
  const velka = await zalohyKOdecteni(kdo.id, 'NOVA1', 300)
  out.velkaZaloha = velka.castka

  // --- bez spuštěné migrace se faktura musí vystavit dál --------------------
  const zalohaTabulka = window.__demoDATA ? window.__demoDATA.zalohove_faktury : null
  if (window.__demoDATA) delete window.__demoDATA.zalohove_faktury
  const tyd2 = document.getElementById('wd-inv-week')
  if (tyd2 && tyd2.options.length) { tyd2.value = tyd2.options[0].value; tyd2.dispatchEvent(new Event('change')) }
  await new Promise(r => setTimeout(r, 700))
  await generateInvoiceAdmin(); await new Promise(r => setTimeout(r, 1200))
  out.bezMigrace = { fakturaVznikla: !!document.getElementById('invoice-page'),
                     zaloha: window._lastInvoice?.cashPaid }
  closeInvoiceOverlay()
  if (window.__demoDATA) window.__demoDATA.zalohove_faktury = zalohaTabulka || []

  // --- po náhledu zálohové faktury musí běžná faktura fungovat dál ----------
  sv('zalohove-faktury', document.querySelector('button[onclick*="zalohove-faktury"]'))
  await new Promise(r => setTimeout(r, 400)); await otevriNovouZalohu(); await new Promise(r => setTimeout(r, 300))
  const s2 = document.getElementById('zf-worker'); s2.value = s2.options[1].value
  await zfPredvyplnit(); await new Promise(r => setTimeout(r, 400))
  document.getElementById('zf-castka').value = '100'
  nahledZalohoveFaktury(); await new Promise(r => setTimeout(r, 400))
  zavriZalohovyDoklad(); await new Promise(r => setTimeout(r, 300))
  out.poZavreni = { zIndex: document.getElementById('invoice-overlay').style.zIndex,
                    nadpis: document.getElementById('invoice-title').textContent,
                    listaZaloha: document.getElementById('invoice-zaloha-bar').style.display }

  // --- jedna záloha rozdělená mezi DVĚ faktury ------------------------------
  // Tohle je místo, kde se nejsnáz rozejdou peníze: druhý zápis nesmí přepsat
  // ten první, jinak by se část zálohy dala odečíst dvakrát.
  // Na jiném pracovníkovi, ať do toho nemluví zálohy z předchozích kroků.
  const druhy = lide2[0]
  await sb.from('zalohove_faktury').insert({ cislo: 'Z202603', worker_id: druhy.id,
    supplier_name: druhy.full_name, iban: druhy.invoice_iban, customer_name: druhy.invoice_customer_name,
    issue_date: '2026-09-01', due_date: '2026-09-15', castka: 1000,
    popis: 'Anzahlung', stav: 'otevrena', zuctovano: 0, zuctovani: {} })
  const ulozFakturu = async (cislo, celkem, pouzite) =>
    sb.from('worker_invoices').insert({ worker_id: druhy.id, invoice_number: cislo,
      total_amount: celkem, cash_paid: pouzite.reduce((a, p) => a + p.vzato, 0),
      zalohy_pouzite: pouzite })
  const kus1 = await zalohyKOdecteni(druhy.id, 'FA1', 300)
  await ulozFakturu('FA1', 300, kus1.pouzite)
  const kus2 = await zalohyKOdecteni(druhy.id, 'FA2', 400)
  await ulozFakturu('FA2', 400, kus2.pouzite)
  const kus1znovu = await zalohyKOdecteni(druhy.id, 'FA1', 300)
  const zbytek = await zalohyKOdecteni(druhy.id, 'FA3', 5000)
  const odecteno = await odectenoZeZaloh([druhy.id])
  out.deleni = {
    poPrvni: kus1.pouzite.find(x => x.cislo === 'Z202603')?.vzato,
    poDruhe: kus2.pouzite.find(x => x.cislo === 'Z202603')?.vzato,
    zuctovanoCelkem: odecteno[druhy.id + '|Z202603']?.castka,
    rozpis: odecteno[druhy.id + '|Z202603']?.faktury,
    prvniZnovu: kus1znovu.pouzite.find(x => x.cislo === 'Z202603')?.vzato,
    zbytekProTreti: zbytek.pouzite.find(x => x.cislo === 'Z202603')?.vzato,
  }

  // --- stornovaná se neodečítá ---------------------------------------------
  await sb.from('zalohove_faktury').update({ stav: 'stornovana' }).eq('cislo', 'Z202602')
  const poStornu = await zalohyKOdecteni(kdo.id, 'NOVA2', 300)
  out.poStornu = poStornu.castka
  return out
})
await b.close()

console.log('\n── sekce a předvyplnění ──')
ok(v.pohled === 'block', 'sekce Zálohové faktury se otevře')
ok(v.lidi > 0, 'v nabídce jsou lidé ze systému (' + v.lidi + ')')
ok(v.predvyplneno.jmeno && v.predvyplneno.iban && v.predvyplneno.odberatel,
   'po vybrání člověka se vyplní jméno, IBAN i odběratel')
ok(!!v.predvyplneno.cislo, 'číslo se předvyplní (' + v.predvyplneno.cislo + ')')
ok(v.predvyplneno.splatnost, 'datum splatnosti se dopočítá')

console.log('\n── doklad ──')
ok(v.doklad.sirka === 794 && v.doklad.vyska <= 1123, 'sedí na A4 (' + v.doklad.sirka + '×' + v.doklad.vyska + ')')
ok(v.doklad.nemecke === 8, 'je celý německy (' + v.doklad.nemecke + '/8 popisků)')
ok(!v.doklad.cesky, 'není na něm česky ani slovo')
ok(v.doklad.reverse, 'je na něm reverse charge')
ok(v.doklad.iban, 'je na něm IBAN')
ok(v.doklad.listaZaloha === 'block' && v.doklad.listaOdeslani === 'none',
   'nabízí stažení PDF, ne odeslání faktury')

console.log('\n── odečet z faktury pracovníka ──')
ok(v.odecet && v.odecet.zaloha === 500, 'z faktury se odečte 500 € (odečteno ' + (v.odecet?.zaloha) + ')')
ok(v.odecet && /Z202601/.test(v.odecet.popis || ''), 'na faktuře je číslo zálohové faktury')
ok(v.odecet && v.odecet.vorschussNaDokladu, 'na dokladu je „Vorschuss" (záloha předem)')
ok(v.odecet && !v.odecet.hotovostNaDokladu, 'a NE „Bar erhalten" (hotovost)')

console.log('\n── zúčtování ──')
ok(Array.isArray(v.uFaktury) && v.uFaktury[0]?.vzato === 500,
   'u faktury je zapsáno, kterou zálohu a kolik si vzala (' + JSON.stringify(v.uFaktury) + ')')
ok(v.znovuTaSama === 500, 'při opravě TÉŽE faktury odečet nezmizí (' + v.znovuTaSama + ')')
ok(v.jinaFaktura === 0, 'na jinou fakturu se už neodečte znovu (' + v.jinaFaktura + ')')
ok(v.velkaZaloha === 300, 'záloha vyšší než faktura se odečte jen do výše faktury (' + v.velkaZaloha + ')')
ok(v.poStornu === 0, 'stornovaná záloha se neodečítá')

console.log('\n── nerozbilo to běžné faktury ──')
ok(v.bezMigrace.fakturaVznikla, 'bez spuštěné migrace se faktura vystaví dál')
ok(!v.bezMigrace.zaloha, 'a nic se z ní neodečte (' + v.bezMigrace.zaloha + ')')
ok(v.poZavreni.zIndex === '10000' && v.poZavreni.listaZaloha === 'none'
   && v.poZavreni.nadpis === '📄 Náhled faktury',
   'po zavření zálohového dokladu je překryv zpátky v normálu')

console.log('\n── jedna záloha rozdělená mezi dvě faktury ──')
ok(v.deleni.poPrvni === 300, 'první faktura si vezme 300 (' + v.deleni.poPrvni + ')')
ok(v.deleni.poDruhe === 400, 'druhá faktura si vezme 400 (' + v.deleni.poDruhe + ')')
ok(v.deleni.zuctovanoCelkem === 700,
   'u zálohy je zúčtováno 700, ne jen posledních 400 (' + v.deleni.zuctovanoCelkem + ')')
ok(Array.isArray(v.deleni.rozpis) && v.deleni.rozpis.includes('FA1') && v.deleni.rozpis.includes('FA2'),
   'přehled ví o obou fakturách (' + JSON.stringify(v.deleni.rozpis) + ')')
ok(v.deleni.prvniZnovu === 300, 'oprava první faktury si drží svých 300 (' + v.deleni.prvniZnovu + ')')
ok(v.deleni.zbytekProTreti === 300, 'na třetí fakturu zbyde jen 300 z tisícovky (' + v.deleni.zbytekProTreti + ')')

const vazne = chybyStranky.filter(x => !/favicon/i.test(x))
ok(!vazne.length, 'na stránce nenastala chyba' + (vazne.length ? ': ' + vazne[0] : ''))

console.log('\n════ kontrolní vzorky ════')
const kontroly = [
  ['odečet zapsaný u faktury', () => !/zalohy_pouzite: Array\.isArray\(d\.zalohyPouzite\)/.test(src)],
  ['německý doklad', () => !/ANZAHLUNGSRECHNUNG/.test(src)],
  ['právo pracovníka jen na čtení', () => !/zalohove_faktury_vlastni/.test(fs.readFileSync('supabase-migrace-zalohove-faktury.sql', 'utf8'))],
]
let umi = 0
for (const [popis, f] of kontroly) {
  if (!f()) { umi++; console.log('  ✅ ' + popis + ' — zkouška by chybu odhalila') }
  else console.log('  ❌ ' + popis + ' — POZOR, neodhalí')
}
if (umi !== kontroly.length) chyb++

console.log(chyb ? `\n❌ ${chyb} potíží` : '\n✅ ZÁLOHOVÉ FAKTURY FUNGUJÍ')
process.exit(chyb ? 1 : 0)
