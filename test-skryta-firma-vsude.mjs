// Schovaná firma (Týmy → 🙈 Schovat) musí zmizet VŠUDE, ne jen v Týmech —
// ukazuje se to zákazníkovi a ten nesmí ostatní firmy zahlédnout nikde.
// Zkouška firmu schová a pak projde sekci po sekci. Pro každou sekci je
// kontrolní měření: bez schování tam ten člověk BÝT MUSÍ, jinak by se
// „nenašel" i v případě, že sekce prostě nic nevypíše.
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

console.log('\n1) Kód — každá sekce se ptá stejného místa')
ok(/function jeSkrytaFirmaPracovnika\(w\)/.test(zdroj), 'existuje jedno místo, které rozhoduje')
const pocet = (zdroj.match(/jeSkrytaFirmaPracovnika\(/g) || []).length
ok(pocet >= 9, `ptá se ho hodně míst (${pocet}×) — Provize, Docházka, Kalendář, Přístupy, Pracovníci, Faktury, Dashboard`)
ok(/const viditelniLide = \(allWorkers \|\| \[\]\)\.filter\(w => !jeSkrytaFirmaPracovnika\(w\)\)/.test(zdroj),
   'v kalendáři se schovaná firma nevypíše ani v rozbalovací nabídce lidí')
ok(/const viditelneTymy = \(calTeams \|\| \[\]\)\.filter\(t => tymJeVidet\(t\.id\)\)/.test(zdroj),
   'ani v nabídce „Všechny firmy" — tam by ji zákazník viděl po rozkliknutí')
ok(/for \(let i = att\.length - 1; i >= 0; i--\) if \(skryteVProvizich\.has/.test(zdroj),
   'v Provizích se vyřadí i docházka, ne jen lidi — jinak by se vrátili jako „bývalí"')
ok(/if \(jeSkrytaFirmaPracovnika\(r\.worker\)\) return   \/\/ schovaná firma/.test(zdroj),
   'v týdenním přehledu taky — tam by se jim jinak dodělal řádek bývalého')
ok(!/skryto\.map\(t => escAttr\(cleanTeamName\(t\.name\)\)\)/.test(zdroj),
   'proužek v Týmech NEVYPISUJE jména schovaných firem — zákazník by je viděl')
ok(/Schválně NEVYPISUJE\s*\n\/\/ jména schovaných firem/.test(zdroj), 'a plovoucí značka taky ne')
ok(/function poZmeneSkrytych/.test(zdroj) && /obnovOtevrenouSekci\(\)/.test(zdroj),
   'po schování se překreslí sekce, kde správce zrovna je — ne jen Týmy')
ok(!/jeSkrytaFirmaPracovnika\(NECO_CO_NENI\)/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Prohlížeč — schovám firmu a projdu všechny sekce')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1500))

  const v = await p.evaluate(async () => {
    const out = { sekce: {} }
    const cekej = ms => new Promise(r => setTimeout(r, ms))
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    try { localStorage.removeItem(PROVIZE_FILTR_KLIC) } catch (e) {}

    // Vyber skupinu a v ní člověka, podle kterého to budeme hledat.
    const { data: tymy } = await sb.from('teams').select('id, name')
    const { data: lide } = await sb.from('profiles').select('id, full_name, team_id')
      .in('role', ['osvec', 'partak']).eq('is_active', true)
    const tym = (tymy || []).find(t => (lide || []).some(l => l.team_id === t.id))
    if (!tym) return { chyba: 'v ukázce není skupina s lidmi' }
    const clovek = (lide || []).find(l => l.team_id === tym.id)
    out.clovek = clovek.full_name
    out.tym = tym.name

    const ukaz = id => {
      document.querySelectorAll('.view').forEach(x => { x.classList.remove('on'); x.style.display = '' })
      const el = document.getElementById(id); el.classList.add('on'); el.style.display = 'block'
      return el
    }
    // Každá sekce: jak ji načíst a kde hledat jméno.
    const SEKCE = {
      'Provize':    async () => { const el = ukaz('v-provize'); const z = document.getElementById('provize-lock'); if (z) z.style.display = 'none'; await renderProvizeContent(); return el },
      'Docházka dnes': async () => { const el = ukaz('v-dochazka'); await loadTodayTimeline(); return el },
      'Týdenní přehled': async () => { const el = ukaz('v-dochazka'); await loadKWData(); return el },
      'Pracovníci': async () => { const el = ukaz('v-pracovnici'); await loadWorkers(); return el },
      'Kalendář':   async () => { const el = ukaz('v-kalendar'); await renderCalendar(); return el },
      'Přístupy':   async () => { const el = ukaz('v-pristupy'); await loadAccess(); return el },
      'Faktury':    async () => { const el = ukaz('v-faktury-archiv'); await loadWorkerInvoices(); return el },
      'Týmy':       async () => { const el = ukaz('v-tymy'); await loadTeams(); return el },
      'Dashboard':  async () => { const el = ukaz('v-dashboard'); await loadDashboard();
                      if (typeof loadDocumentAlertsStat === 'function') await loadDocumentAlertsStat();
                      if (typeof loadLongDayAlert === 'function') await loadLongDayAlert(); return el },
      'Dokumenty':  async () => { const el = ukaz('v-dokumenty'); await loadDocuments(); return el },
      // Stejně jako appka při otevření sekce: seznam smluv I nabídka „nová smlouva".
      'Smlouvy':    async () => { const el = ukaz('v-smlouvy'); await loadAdminContracts(); await loadContractWorkers(); return el },
      'Chat':       async () => { const el = ukaz('v-chat'); await loadAdminChatList(); return el },
      'Zálohové faktury': async () => { const el = ukaz('v-zalohove-faktury'); await loadZalohoveFaktury(); return el },
      'Fotky':      async () => { const el = ukaz('v-fotky'); await loadSitePhotos(); return el },
    }

    for (const [nazev, nacti] of Object.entries(SEKCE)) {
      try {
        try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
        let el = await nacti(); await cekej(500)
        const predTim = el.textContent.includes(clovek.full_name)

        lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)]))
        el = await nacti(); await cekej(500)
        const poSchovani = el.textContent.includes(clovek.full_name)

        out.sekce[nazev] = { predTim, poSchovani }
      } catch (e) { out.sekce[nazev] = { chyba: e.message } }
    }

    // ROZBALOVACÍ NABÍDKY — jméno nesmí být ani v <option>
    lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)]))
    _skrytiCache.klic = ''
    out.nabidky = {}
    const nabidky = [
      ['manual-worker', () => loadManualWorkers()],
      ['contract-worker', () => loadContractWorkers()],
      ['notif-worker', () => loadNotifWorkers()],
    ]
    for (const [id, nacti] of nabidky) {
      try {
        try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
        _skrytiCache.klic = ''
        await nacti(); await cekej(200)
        const el = document.getElementById(id)
        const pred = el ? [...el.options].some(o => o.textContent.includes(clovek.full_name)) : null
        lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)])); _skrytiCache.klic = ''
        await nacti(); await cekej(200)
        const po = el ? [...el.options].some(o => o.textContent.includes(clovek.full_name)) : null
        out.nabidky[id] = { pred, po, je: !!el }
      } catch (e) { out.nabidky[id] = { chyba: e.message } }
    }

    // ODKAZY — odkaz, jehož jediná skupina je schovaná, v seznamu nesmí být
    try {
      try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
      const nazevOdkazu = 'Zkušební odběratel ' + Date.now()
      const linkId = 'link-zk-' + Date.now()
      await sb.from('client_links').insert({ id: linkId, nazev: nazevOdkazu, token: 'tok' + Date.now(), aktivni: true })
      await sb.from('client_link_teams').insert({ link_id: linkId, team_id: tym.id })
      const elO = ukaz('v-odkazy')
      // Odkazy jsou za heslem Provizí — odemkni je, jako by heslo zadal správce.
      try { sessionStorage.setItem('provizeUnlocked', '1') } catch (e) {}
      await loadKlientOdkazy(); await cekej(300)
      const pred = elO.textContent.includes(nazevOdkazu)
      lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)])); _skrytiCache.klic = ''
      await loadKlientOdkazy(); await cekej(300)
      out.odkazy = { pred, po: elO.textContent.includes(nazevOdkazu) }
    } catch (e) { out.odkazy = { chyba: e.message } }

    // HLÁŠKA „Nová zpráva: jméno" — u schovaného se nesmí ukázat vůbec
    lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)])); _skrytiCache.klic = ''
    const puvodniToast = window.showToast
    const hlasky = []
    window.showToast = m => hlasky.push(String(m))
    try { _posledniUpozorneniZprava = 0 } catch (e) {}
    await upozorniNaZpravu(clovek.id); await cekej(200)
    out.hlaskaSkryty = hlasky.slice()
    // kontrolní měření: člověk z VIDITELNÉ firmy hlášku dostat MUSÍ
    const jinyClovek = (lide || []).find(l => l.team_id && String(l.team_id) !== String(tym.id))
    hlasky.length = 0
    try { _posledniUpozorneniZprava = 0 } catch (e) {}
    if (jinyClovek) await upozorniNaZpravu(jinyClovek.id)
    await cekej(200)
    out.hlaskaViditelny = hlasky.slice()
    out.jinyClovek = jinyClovek ? jinyClovek.full_name : null
    window.showToast = puvodniToast

    // plovoucí značka: nesmí prozradit jméno schované firmy
    lsSet(TYMY_SKRYTE_KLIC, JSON.stringify([String(tym.id)]))
    aktualizujPruhSkrytych()
    const pruh = document.getElementById('pruh-skrytych-firem')
    out.pruhJe = !!pruh
    out.pruhText = pruh ? pruh.textContent : ''
    out.pruhProzradi = pruh ? pruh.textContent.includes(tym.name) : null

    // a „Ukázat vše" všechno vrátí
    ukazVsechnyTymy(); await cekej(400)
    out.poUkazani = skryteTymy().size
    out.pruhZmizel = !document.getElementById('pruh-skrytych-firem')
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    return out
  })

  if (v.chyba) { chyby++; console.log('  ❌ ' + v.chyba) }
  else {
    console.log(`     (hledám „${v.clovek}" ze skupiny „${v.tym}")`)
    for (const [nazev, r] of Object.entries(v.sekce)) {
      if (r.chyba) { ok(false, `${nazev}: sekce spadla — ${r.chyba}`); continue }
      if (!r.predTim) {
        // Tady ten člověk není ani bez schování — sekce ho neukazuje vůbec
        // (třeba nemá dnes docházku). Nedá se tu nic dokázat, řekni to.
        console.log(`  ⚪ ${nazev}: ten člověk tu není ani bez schování — nedá se ověřit`)
        continue
      }
      ok(r.poSchovani === false, `${nazev}: bez schování tam je, po schování zmizel`)
    }
    const overeno = Object.values(v.sekce).filter(r => r.predTim).length
    ok(overeno >= 8, `doopravdy ověřeno aspoň osm sekcí (${overeno})`)
    for (const [id, r] of Object.entries(v.nabidky || {})) {
      if (r.chyba) { ok(false, `nabídka ${id}: spadla — ${r.chyba}`); continue }
      if (!r.je || !r.pred) { console.log(`  ⚪ nabídka ${id}: ten člověk v ní není ani bez schování`); continue }
      ok(r.po === false, `nabídka ${id}: jméno po schování zmizelo i z rozbalovacího seznamu`)
    }
    if (v.odkazy && v.odkazy.chyba) ok(false, 'Odkazy: ' + v.odkazy.chyba)
    else if (v.odkazy && !v.odkazy.pred) console.log('  ⚪ Odkazy: zkušební odkaz se neukázal ani bez schování — nedá se ověřit')
    else ok(v.odkazy && v.odkazy.po === false, 'Odkazy: odkaz schované firmy po schování ze seznamu zmizel')
    ok(v.hlaskaSkryty.length === 0,
       'hláška „Nová zpráva" od člověka ze schované firmy se NEUKÁŽE' + (v.hlaskaSkryty.length ? ' — ukázalo se: ' + v.hlaskaSkryty[0] : ''))
    if (v.jinyClovek) ok(v.hlaskaViditelny.some(h => h.includes('Nová zpráva')),
       `od člověka z viditelné firmy (${v.jinyClovek}) hláška přijde — kontrolní měření`)
    ok(v.pruhJe, 'dokud je něco schované, vlevo dole je značka')
    ok(/Schováno: 1/.test(v.pruhText), 'ukazuje počet')
    ok(v.pruhProzradi === false, 'ale NEPROZRADÍ jméno schované firmy')
    ok(v.poUkazani === 0 && v.pruhZmizel, '„Ukázat vše" vrátí všechno a značka zmizí')
    ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
  }
} finally { await b.close() }

console.log('\n3) Tlačítko „Schovat" přímo v Provizích — skutečné kliknutí')
const b2 = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 })
try {
  const p = await b2.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1500))
  const v = await p.evaluate(async () => {
    const cekej = ms => new Promise(r => setTimeout(r, ms))
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    const sekce = document.getElementById('v-provize')
    document.querySelectorAll('.view').forEach(x => { x.classList.remove('on'); x.style.display = '' })
    sekce.classList.add('on'); sekce.style.display = 'block'
    const z = document.getElementById('provize-lock'); if (z) z.style.display = 'none'
    await renderProvizeContent(); await cekej(600)

    const karty = () => [...sekce.querySelectorAll('.card h4')].map(h => h.textContent.replace(/\s+/g,' ').trim())
    const out = { pred: karty() }
    const tl = sekce.querySelector('button[onclick*="schovejFirmuZProvizi"]')
    out.maTlacitko = !!tl
    // V nadpisu jsou dva <span> — popisek „počítat" a název firmy. Ber ten s 🏢.
    const spanFirmy = tl ? [...tl.closest('h4').querySelectorAll('span')].find(x => x.textContent.includes('🏢')) : null
    const nazevFirmy = spanFirmy ? spanFirmy.textContent.replace('🏢','').trim() : ''
    out.firma = nazevFirmy
    const lideTeFirmy = (window._provizeFirmy || []).find(f => f && f.nazev === nazevFirmy)
    out.maSkupiny = !!(lideTeFirmy && lideTeFirmy.tymy && lideTeFirmy.tymy.length)

    if (tl) tl.click()
    await cekej(1500)
    await renderProvizeContent(); await cekej(600)
    out.po = karty()
    out.firmaZmizela = !out.po.some(t => t.includes(nazevFirmy))
    out.skryto = skryteTymy().size

    // a je schovaná i jinde — v Přístupech
    const pr = document.getElementById('v-pristupy')
    document.querySelectorAll('.view').forEach(x => { x.classList.remove('on'); x.style.display = '' })
    pr.classList.add('on'); pr.style.display = 'block'
    await loadAccess(); await cekej(500)
    out.vPristupech = pr.textContent.includes(nazevFirmy)

    ukazVsechnyTymy(); await cekej(300)
    try { localStorage.removeItem(TYMY_SKRYTE_KLIC) } catch (e) {}
    return out
  })
  ok(v.maTlacitko, 'v Provizích je u firmy tlačítko „Schovat"')
  ok(v.maSkupiny, `karta firmy „${v.firma}" ví, ze kterých skupin se skládá`)
  ok(v.pred.some(t => t.includes(v.firma)), 'před kliknutím tam ta firma je (kontrolní měření)')
  ok(v.firmaZmizela, `po kliknutí z Provizí zmizela (${v.pred.length} → ${v.po.length} karet)`)
  ok(v.skryto >= 1, 'schovala se do stejného úložiště jako v Týmech')
  ok(v.vPristupech === false, 'a zmizela i jinde — v Přístupech už není')
  ok(padky.length === 0, 'nic nespadlo' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b2.close() }

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Schovaná firma zmizí všude')
process.exit(chyby ? 1 : 0)
