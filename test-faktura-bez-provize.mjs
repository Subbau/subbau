// Na faktuře OSVČ nesmí být ani stopa po naší provizi. Je to obchodní
// tajemství SubBau — pracovník vidí jen svoje hodiny a svoji sazbu.
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
// Slovo „provize" se v souboru vyskytuje i v komentářích kolem faktur, takže
// hledat ho v úseku kódu by nic nedokazovalo. Hledáme proto to, co by se
// muselo stát, aby se provize na fakturu dostala: že by si ji šablona
// odněkud vzala.
ok(!/\bV\.provize|\bd\.provize|invoice.*\.provize|provize:\s*V\./i.test(zdroj),
   'žádná šablona faktury si provizi nikde nebere')
ok(!/worker_commissions/.test(zdroj.slice(zdroj.indexOf('function renderInvoice'),
                                          zdroj.indexOf('function renderInvoice') + 30000)),
   'ani vykreslování faktury nesahá na tabulku s provizemi')
ok(/if \(\(currentProfile\?\.role \|\| ''\)\.trim\(\)\.toLowerCase\(\) !== 'admin'\) return null/.test(zdroj),
   'do tabulky s provizemi se pracovník nepodívá ani kvůli splatnosti')
ok(/worker_commissions/.test(zdroj), 'kontrolní měření: hledání funguje (jinde v appce ta tabulka je)')

console.log('\n2) Opravdu vystavená faktura')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.generateInvoiceAdmin === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    window.showToast = () => {}
    // pracovník, který má v systému nastavenou provizi
    const { data: prov } = await sb.from('worker_commissions').select('worker_id, provize')
    const sProvizi = (prov || []).find(x => Number(x.provize) > 0)
    if (!sProvizi) return { chyba: 'v ukázce nikdo nemá nastavenou provizi' }
    const { data: lide } = await sb.from('profiles').select('id, full_name, hourly_rate_worker').eq('id', sProvizi.worker_id)
    const clovek = (lide || [])[0]
    if (!clovek) return { chyba: 'profil k té provizi neexistuje' }

    await openWorkerModal(clovek.id); await new Promise(r => setTimeout(r, 900))
    wdTab('finance', document.querySelector('.wd-tab[onclick*="finance"]'))
    await new Promise(r => setTimeout(r, 1100))
    const sel = document.getElementById('wd-inv-week')
    const tyden = [...(sel ? sel.options : [])].map(o => o.value).find(x => x && /\d/.test(x))
    if (!tyden) return { chyba: 'pracovník nemá žádný týden k fakturaci' }
    sel.value = tyden; sel.dispatchEvent(new Event('change'))
    await new Promise(r => setTimeout(r, 1300))
    await generateInvoiceAdmin(); await new Promise(r => setTimeout(r, 1600))

    const doklad = document.getElementById('invoice-page')
    const text = (doklad?.textContent || '').replace(/\s+/g, ' ')
    const html = doklad?.innerHTML || ''
    const provize = Number(sProvizi.provize)
    const sazba = Number(clovek.hourly_rate_worker) || 0
    // Hledáme číslo provize jako samostatnou hodnotu (22 vs. 22,50 nejsou totéž)
    const cislo = (n) => new RegExp('(^|[^\\d,.])' + String(n).replace('.', '[.,]') + '([^\\d]|$)')
    return {
      jmeno: clovek.full_name, provize, sazba,
      maDoklad: text.length > 200,
      slovoProvize: /provize|provizi|commission|Provision/i.test(text),
      cisloProvize: cislo(provize).test(text) || cislo(provize.toFixed(2)).test(text),
      maCastku: /\d[\d\s.,]*\s*€/.test(text),
      ukazka: text.slice(0, 300),
      maJmeno: text.includes(clovek.full_name),
      maSkrytyKomentar: /provize|commission/i.test(html) && !/provize|commission/i.test(text)
    }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.maDoklad, 'kontrolní měření: faktura se opravdu vykreslila')
    ok(v.maJmeno, `kontrolní měření: je na ní jméno pracovníka (${v.jmeno})`)
    ok(v.maCastku, 'kontrolní měření: je na ní vyfakturovaná částka — čteme opravdový obsah'
       + (v.maCastku ? '' : ' | co na ní je: ' + v.ukazka))
    ok(!v.slovoProvize, 'NENÍ na ní slovo o provizi')
    ok(!v.cisloProvize, `ANI číslo naší provize (${v.provize} €)`)
    ok(!v.maSkrytyKomentar, 'a není schované ani v neviditelné části stránky')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Faktura OSVČ o naší provizi mlčí')
process.exit(chyby ? 1 : 0)
