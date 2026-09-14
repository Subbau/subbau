// Proč tenhle test: lidem na Androidu appka psala „nesprávné heslo" i tehdy,
// když s heslem nebylo nic — propadlý token, špatný klíč, server neodpověděl.
// Oni si pak dělali nové heslo, nepomohlo, a dělali další. Tohle to hlídá.
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
ok(!/error\.message\.includes\('Invalid'\)/.test(zdroj),
   'zmizelo hrubé includes(\'Invalid\'), co házelo všechno do jednoho pytle')
ok(/function popisChybyPrihlaseni/.test(zdroj), 'chyby přihlášení se překládají jednou funkcí')
ok(/id="login-pwd"[^>]*autocorrect="off"[^>]*spellcheck="false"/.test(zdroj),
   'pole na heslo má na Androidu vypnuté opravy i kontrolu pravopisu')
ok(/identities/.test(zdroj) && /už účet existuje/.test(zdroj),
   'registrace na už existující e-mail se pozná a řekne se to')
ok(/nedělejte si nové heslo/.test(zdroj), 'u nenačteného profilu se rovnou řekne, že nové heslo nepomůže')
ok(!/spojení s databází bylo pomalé/.test(zdroj), 'zmizela hláška svádějící vinu na pomalou databázi')
ok(!/VETA_KTERA_V_KODU_NIKDY_NEBUDE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Co uvidí člověk u jednotlivých chyb')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
try {
  const p = await b.newPage()
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.popisChybyPrihlaseni === 'function', { timeout: 20000 })
  const h = await p.evaluate(() => {
    const f = window.popisChybyPrihlaseni
    return {
      heslo:        f({ message: 'Invalid login credentials', status: 400 }),
      klic:         f({ message: 'Invalid API key', status: 401 }),
      token:        f({ message: 'Invalid Refresh Token: Already Used', status: 400 }),
      moc:          f({ message: 'Email rate limit exceeded', status: 429 }),
      server:       f({ message: 'Failed to fetch', status: 0 }),
      nepotvrzeny:  f({ message: 'Email not confirmed', status: 400 })
    }
  })
  const jeHeslo = s => /Nesprávný e-mail nebo heslo/.test(s)
  ok(jeHeslo(h.heslo), 'opravdu špatné heslo → „Nesprávný e-mail nebo heslo"')
  ok(!jeHeslo(h.klic) && /Není to heslem/.test(h.klic), 'špatný klíč → NEsvádí to na heslo')
  ok(!jeHeslo(h.token) && /Není to heslem/.test(h.token), 'propadlý token → NEsvádí to na heslo')
  ok(!jeHeslo(h.moc) && /Heslo je nejspíš v pořádku/.test(h.moc), 'moc pokusů → řekne se, ať nedělá nové heslo')
  ok(!jeHeslo(h.server) && /Není to heslem/.test(h.server), 'server neodpověděl → NEsvádí to na heslo')
  ok(!jeHeslo(h.nepotvrzeny) && /schránky/.test(h.nepotvrzeny), 'nepotvrzený e-mail → pošle člověka do schránky')
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Hlášky u přihlášení říkají pravdu')
process.exit(chyby ? 1 : 0)
