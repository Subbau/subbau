// Zpráva v chatu nešla odeslat, dokud se nenačetla celá stránka. Appka totiž
// občas ztratí proměnnou s přihlášeným uživatelem a odesílání kvůli tomu tiše
// skončilo — text zmizel z políčka a nikam se nedostal.
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
ok(/async function zajistiPrihlaseni/.test(zdroj), 'appka si umí dotáhnout ztracené přihlášení')
ok((zdroj.match(/await zajistiPrihlaseni\(\)/g) || []).length >= 2, 'a používá to obojí strana chatu')
ok(!/if \(!msg \|\| !activeChatWorkerId \|\| !currentUser\) return/.test(zdroj),
   'odeslání už nekončí potichu')
ok(!/TAHLE_FUNKCE_NEEXISTUJE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) V prohlížeči — se ztraceným přihlášením')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.sendAdminChatMessage === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    sv('chat'); await new Promise(r => setTimeout(r, 2000))
    // otevři první konverzaci
    const prvni = document.querySelector('[onclick*="openAdminChat"]')
    if (prvni) { prvni.click(); await new Promise(r => setTimeout(r, 1800)) }

    const input = document.getElementById('admin-chat-input')
    if (!input) return { chyba: 'políčko na zprávu není' }
    const kolik = async () => ((await sb.from('chat_messages').select('id')).data || []).length

    // ── to hlavní: appka „ztratí" přihlášeného uživatele, jako to dělá Chrome
    const pred = await kolik()
    window.currentUser = null
    input.value = 'Zkouška po ztrátě přihlášení'
    toasty.length = 0
    await sendAdminChatMessage()
    await new Promise(r => setTimeout(r, 1500))
    const po = await kolik()
    return { pred, po, toasty, zbyloVPolicku: input.value }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.pred > 0, `kontrolní měření: v ukázce nějaké zprávy jsou (${v.pred})`)
    ok(v.po === v.pred + 1, `zpráva se odešle i po ztrátě přihlášení (${v.pred} → ${v.po})`)
    ok(!v.toasty.some(t => /vypršelo/.test(t)), 'a neotravuje hláškou, když se přihlášení podaří dotáhnout')
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Zpráva jde odeslat bez znovunačítání stránky')
process.exit(chyby ? 1 : 0)
