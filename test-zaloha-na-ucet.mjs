// Už uhrazená část faktury může být buď v hotovosti, nebo zálohou na účet.
// Podle toho musí být na faktuře jiná věta — u zálohy na účet německy
// „Abzüglich bereits geleisteter Anzahlung".
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
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-zaloha-na-ucet.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód a migrace')
ok(/add column if not exists cash_paid_typ text;/.test(migrace), 'migrace přidává sloupec')
ok(/cash_paid_typ in \('hotovost', 'ucet'\)/.test(migrace), 'a hlídá, že v něm nebude nesmysl')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'běží v transakci')
ok(/Abzüglich bereits geleisteter Anzahlung/.test(zdroj), 'appka tu německou větu zná')
ok(/cash_paid_typ/i.test(zdroj) && /bezTypuZalohy/.test(zdroj), 'bez migrace se faktura kvůli tomu nezablokuje')
ok(!/VETA_KTERA_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Jak to vypadá na faktuře')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.renderInvoice === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    const zaklad = {
      invoiceNumber: 'TEST-1', supplier: { name: 'Jan Zkouška' },
      customer: { name: 'Bau GmbH', address: 'München' },
      items: [{ popis: 'Práce', mnozstvi: 10, cena: 30 }],
      totalAmount: 300, cashPaid: 100, dueDays: 14, designIdx: 1
    }
    const text = (d) => {
      renderInvoice({ ...d }, 'en')
      return (document.getElementById('invoice-page')?.textContent || '').replace(/\s+/g, ' ')
    }
    return {
      hotovost: text({ ...zaklad, cashPaidTyp: 'hotovost' }),
      ucet: text({ ...zaklad, cashPaidTyp: 'ucet' }),
      prazdno: text({ ...zaklad }),
      zeZalohove: text({ ...zaklad, cashPaidTyp: 'ucet', zalohaZeZalohoveFaktury: true })
    }
  })

  const veta = 'Abzüglich bereits geleisteter Anzahlung'
  ok(v.hotovost.length > 200, 'kontrolní měření: faktura se vykreslila')
  ok(/Bar erhalten/.test(v.hotovost), 'v hotovosti → „Bar erhalten"')
  ok(!v.hotovost.includes(veta), 'a NE ta věta o záloze')
  ok(v.ucet.includes(veta), `zálohou na účet → „${veta}"`)
  ok(/Po odečtení již uhrazené zálohy/.test(v.ucet), 'a česky „Po odečtení již uhrazené zálohy"')
  ok(!/Bar erhalten/.test(v.ucet), 'a NE „Bar erhalten"')
  ok(/Bar erhalten/.test(v.prazdno), 'stará faktura bez nastavení zůstává u hotovosti')
  ok(/Vorschuss/.test(v.zeZalohove) && !v.zeZalohove.includes(veta),
     'odečet ze zálohové faktury si drží svoje „Vorschuss"')
  ok(/100/.test(v.ucet), 'kontrolní měření: odečtená částka je na faktuře vidět')
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Záloha na účet má na faktuře svoji větu')
process.exit(chyby ? 1 : 0)
