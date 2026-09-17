// V pátek se výkaz nechává podepsat vedoucím. Kdo to zapomene, nemá doklad
// k faktuře. Zkouška hlídá dvě věci: v pátek to opravdu svítí a pípne, a
// v ostatní dny se nesmí ukázat nic (jinak by si na to lidi zvykli a přestali
// si toho všímat).
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

console.log('\n1) Kód — připomínka se opravdu někde volá')
ok(/try \{ pripomenVykazVPatek\(profile\) \}/.test(zdroj), 'volá se po přihlášení pracovníka')
ok(/pripomenVykazVPatek\(typeof currentProfile !== 'undefined'/.test(zdroj),
   'a taky při přepnutí sekce — objeví se i tomu, kdo má appku otevřenou od čtvrtka')
ok(/id="mob-nav-vykaz"/.test(zdroj), 'tlačítko Výkaz hodin má svoje id')
ok(/id="mob-vykaz-pripominka"/.test(zdroj), 'v sekci výkazu je připravené upozornění')
ok(/Nezapomeňte si podepsat výkaz hodin/.test(zdroj), 'a je v něm ten text, co chtěl Patrik')
ok(/@keyframes vykazBlik/.test(zdroj), 'blikání je nadefinované v CSS')
ok(!/ZADNA_TAKOVA_FUNKCE_V_APPCE/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — co uvidí pracovník')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 40000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })

  // Zvuk v headless prohlížeči nezazní, ale změřit se dá: podstrčíme vlastní
  // AudioContext a spočítáme, kolik tónů si appka naplánovala.
  await p.evaluateOnNewDocument(() => {
    window.__tony = 0
    class FalesnyCtx {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {} }
      createOscillator() {
        window.__tony++
        return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
      }
      resume() { return Promise.resolve() }
      close() {}
    }
    window.AudioContext = FalesnyCtx
    window.webkitAudioContext = FalesnyCtx
  })

  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.pripomenVykazVPatek === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const out = {}
    const stav = () => {
      const nav = document.getElementById('mob-nav-vykaz')
      const ban = document.getElementById('mob-vykaz-pripominka')
      return {
        pozadi: nav ? nav.style.background : 'NENÍ',
        blika: nav ? nav.style.animation : 'NENÍ',
        banner: ban ? ban.style.display : 'NENÍ',
        popisek: nav ? (nav.querySelector('.mob-nav-label') || {style:{}}).style.color : 'NENÍ',
        text: ban ? ban.textContent : ''
      }
    }
    const patek = new Date('2026-09-18T08:00:00')   // pátek
    const ctvrtek = new Date('2026-09-17T08:00:00') // čtvrtek
    const streda = new Date('2026-09-16T08:00:00')
    out.jePatek = jePatek(patek)
    out.jeCtvrtek = jePatek(ctvrtek)

    // ── A) pátek: svítí, bliká, píše ──
    try { localStorage.removeItem('vykaz_pipnuto_' + new Date().toISOString().slice(0,10)) } catch (e) {}
    window.__tony = 0
    pripomenVykazVPatek({ role: 'osvec' }, patek)
    out.patek = stav()
    out.tonyPoPrvnim = window.__tony

    // ── B) druhé otevření téhož dne už nepípá (jinak by to lidi otravovalo) ──
    pripomenVykazVPatek({ role: 'osvec' }, patek)
    out.tonyPoDruhem = window.__tony
    out.patekPodruhe = stav()

    // ── C) čtvrtek a středa: nesmí se ukázat nic ──
    pripomenVykazVPatek({ role: 'osvec' }, ctvrtek)
    out.ctvrtek = stav()
    pripomenVykazVPatek({ role: 'osvec' }, streda)
    out.streda = stav()

    // ── D) správce výkaz nepodepisuje — jemu se to ukázat nesmí ani v pátek ──
    pripomenVykazVPatek({ role: 'admin' }, patek)
    out.adminVPatek = stav()

    // ── E) a pracovníkovi se to v pátek zase vrátí ──
    pripomenVykazVPatek({ role: 'osvec' }, patek)
    out.zpatky = stav()

    // ── F) zvuk sám o sobě: tři tóny ──
    window.__tony = 0
    pipniPracovnikovi()
    out.tonyPipnuti = window.__tony
    return out
  })

  ok(v.jePatek === true && v.jeCtvrtek === false, 'appka pozná pátek od čtvrtka')
  ok(/rgb\(192, 40, 28\)|#c0281c/.test(v.patek.pozadi), 'v pátek je tlačítko Výkaz hodin červené')
  ok(/vykazBlik/.test(v.patek.blika), 'a bliká, ať si toho člověk všimne')
  ok(v.patek.banner === 'block', 'v sekci výkazu je vidět upozornění')
  ok(/Nezapomeňte si podepsat výkaz hodin/.test(v.patek.text), 'a je v něm ta věta')
  ok(/pátek/.test(v.patek.text) && /podepsat/.test(v.patek.text), 'vysvětluje i proč')
  ok(v.tonyPoPrvnim >= 3, `v pátek to pípne (naplánované tóny: ${v.tonyPoPrvnim})`)
  ok(v.tonyPoDruhem === v.tonyPoPrvnim, 'podruhé v týž den už nepípá, jen svítí dál')
  ok(v.patekPodruhe.banner === 'block', 'upozornění zůstává')
  ok(v.ctvrtek.banner === 'none' && v.streda.banner === 'none',
     've čtvrtek ani ve středu žádné upozornění (kontrolní měření)')
  ok(!/rgb\(192, 40, 28\)/.test(v.ctvrtek.pozadi) && !/vykazBlik/.test(v.ctvrtek.blika),
     'a tlačítko je v ostatní dny normální')
  ok(v.adminVPatek.banner === 'none', 'správci se připomínka neukazuje ani v pátek')
  ok(v.zpatky.banner === 'block', 'pracovníkovi se v pátek zase ukáže')
  ok(v.tonyPipnuti >= 3, `zvuk je trojtón (${v.tonyPipnuti})`)
  ok(/rgb\(255, 255, 255\)|#fff|white/.test(v.patek.popisek),
     'nápis Výkaz hodin je na červeném bílý — jinak by se na pozadí ztratil')
  ok(!/rgb\(255, 255, 255\)/.test(v.ctvrtek.popisek), 'a v ostatní dny se popisek nechává být')
  ok(padky.length === 0, 'stránka nikde nespadla' + (padky.length ? ': ' + padky[0] : ''))

  console.log('\n3) Když prohlížeč zvuk odmítne (appka naskočí bez kliknutí)')
  const p2 = await b.newPage()
  const padky2 = []
  p2.on('pageerror', e => padky2.push(e.message))
  p2.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p2.evaluateOnNewDocument(() => {
    window.__tony = 0
    window.__vibrace = 0
    // Prohlížeč, který zvuk zakazuje, dokud člověk nesáhne na obrazovku.
    class ZakazanyCtx {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {} }
      createOscillator() {
        window.__tony++
        return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
      }
      resume() {
        if (window.__dotek) { this.state = 'running'; return Promise.resolve() }
        return Promise.reject(new Error('not allowed'))
      }
      close() {}
    }
    window.AudioContext = ZakazanyCtx
    window.webkitAudioContext = ZakazanyCtx
    Object.defineProperty(navigator, 'vibrate', { value: () => { window.__vibrace++; return true } })
  })
  await p2.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p2.waitForFunction(() => typeof window.pipniPracovnikovi === 'function', { timeout: 20000 })
  const v2 = await p2.evaluate(async () => {
    const out = {}
    window.__tony = 0; window.__vibrace = 0; window.__dotek = false
    pipniPracovnikovi()
    await new Promise(r => setTimeout(r, 60))
    out.hnedTony = window.__tony
    out.vibrace = window.__vibrace
    out.ceka = _pipnutiCeka
    // člověk sáhne na obrazovku
    window.__dotek = true
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    out.poDoteku = window.__tony
    // a podruhé už se nic navíc nenachystalo
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise(r => setTimeout(r, 60))
    out.poDruhemDoteku = window.__tony
    return out
  })
  ok(v2.vibrace >= 1, 'telefon aspoň zavibruje, i když zvuk nesmí')
  ok(v2.ceka === true, 'appka si pípnutí odloží na první dotek')
  ok(v2.poDoteku > v2.hnedTony, `po doteku obrazovky to pípne (${v2.hnedTony} → ${v2.poDoteku})`)
  ok(v2.poDruhemDoteku === v2.poDoteku, 'a při dalších dotecích už to nepípá znovu')
  ok(padky2.length === 0, 'ani tady stránka nespadla' + (padky2.length ? ': ' + padky2[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Páteční připomenutí výkazu funguje')
process.exit(chyby ? 1 : 0)
