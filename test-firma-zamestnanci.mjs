// Firmy (s.r.o.) se zaměstnanci — první krok: jde nastavit, kdo pod koho patří.
// Zaměstnanci si zapisují docházku, ale sazbu ani fakturaci nemají; za všechny
// fakturuje firma a provizi počítáme u ní.
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
const migrace = fs.readFileSync(path.join(D, 'supabase-migrace-firma-zamestnanci.sql'), 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Migrace')
ok(/add column if not exists zamestnavatel_id uuid references public\.profiles\(id\)/.test(migrace),
   'zaměstnanec ukazuje na profil firmy')
ok(/on delete set null/.test(migrace), 'smazání firmy zaměstnance nesmaže, jen je uvolní')
ok(/create trigger profiles_zamek_zamestnavatel_trg/.test(migrace), 'zařazení pod firmu mění jen správce')
ok(/^begin;/m.test(migrace) && /^commit;/m.test(migrace), 'běží v transakci')
ok(/create index if not exists profiles_zamestnavatel_idx/.test(migrace), 'je na to index')

console.log('\n2) Kód')
ok(/function jeZamestnanecFirmy/.test(zdroj) && /function jeFirmaSeZamestnanci/.test(zdroj),
   'appka pozná firmu i jejího zaměstnance')
ok(/data\[0\]\.zamestnavatel_id \|\| null\) !== \(firmaId \|\| null\)/.test(zdroj),
   'a ověří si, že se zařazení opravdu uložilo')
ok(/supabase-migrace-firma-zamestnanci\.sql/.test(zdroj), 'bez migrace řekne, kterou spustit')
ok(!/TAHLE_FUNKCE_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')

console.log('\n3) V prohlížeči')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  p.on('dialog', async d => { try { await d.accept() } catch (e) {} })
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.naplnVyberZamestnavatele === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => toasty.push(String(m))
    const { data: lide } = await sb.from('profiles').select('id, full_name')
      .in('role', ['osvec', 'partak']).limit(3)
    if (!lide || lide.length < 2) return { chyba: 'málo lidí v ukázce' }
    const firma = lide[0], zamestnanec = lide[1]
    // Z prvního uděláme firmu. U zaměstnance zároveň založíme sloupec
    // zamestnavatel_id — falešná databáze v ukázce zná jen sloupce, které
    // v datech opravdu jsou, kdežto po migraci ho má každý řádek.
    await sb.from('profiles').update({ supplier_type: 'sro', company_name: 'Stavby Novák s.r.o.' }).eq('id', firma.id)
    await sb.from('profiles').update({ zamestnavatel_id: null }).eq('id', zamestnanec.id)

    // Otevřeme opravdovou kartu pracovníka — appka si tím nastaví, koho
    // zrovna upravujeme. Sáhnout na to zvenčí nejde, ta proměnná není veřejná.
    await openWorkerModal(zamestnanec.id)
    await new Promise(r => setTimeout(r, 1200))
    wdTab('finance', document.querySelector('.wd-tab[onclick*="finance"]'))
    await new Promise(r => setTimeout(r, 1500))

    const sel = document.getElementById('wd-zamestnavatel')
    if (!sel) return { chyba: 'nabídka zaměstnavatele v kartě není' }
    const nabidka = [...sel.options].map(o => o.textContent.trim())

    toasty.length = 0
    sel.value = firma.id
    await ulozZamestnavatele(sel)
    await new Promise(r => setTimeout(r, 1000))
    const { data: po } = await sb.from('profiles').select('zamestnavatel_id').eq('id', zamestnanec.id)

    sel.value = ''
    await ulozZamestnavatele(sel)
    await new Promise(r => setTimeout(r, 1000))
    const { data: zpet } = await sb.from('profiles').select('zamestnavatel_id').eq('id', zamestnanec.id)

    // firma sama sebe v nabídce mít nesmí
    await openWorkerModal(firma.id)
    await new Promise(r => setTimeout(r, 1200))
    wdTab('finance', document.querySelector('.wd-tab[onclick*="finance"]'))
    await new Promise(r => setTimeout(r, 1500))
    const nabidkaFirmy = [...(document.getElementById('wd-zamestnavatel')?.options || [])].map(o => o.value)
    const infoFirmy = document.getElementById('wd-zamestnavatel-info')?.textContent || ''

    await sb.from('profiles').update({ supplier_type: null, company_name: null }).eq('id', firma.id)
    return { toasty, nabidka, zarazen: po?.[0]?.zamestnavatel_id ?? null,
             uvolnen: zpet?.[0]?.zamestnavatel_id ?? null,
             firmaVeVlastniNabidce: nabidkaFirmy.includes(firma.id), infoFirmy, idFirmy: firma.id }
  })

  if (v.chyba) { ok(false, v.chyba) } else {
    ok(v.nabidka.some(t => /Stavby Novák/.test(t)), 'firma se objeví v nabídce')
    ok(v.nabidka.some(t => /pracuje sám na sebe/.test(t)), 'a jde vybrat i „není zaměstnanec"')
    ok(v.zarazen === v.idFirmy, 'zařazení pod firmu se uloží' + (v.zarazen === v.idFirmy ? '' : ' | ' + JSON.stringify(v.toasty)))
    ok(v.uvolnen === null, 'a jde zase zrušit')
    ok(v.firmaVeVlastniNabidce === false, 'firma si sama sebe za zaměstnavatele nastavit nemůže')
    ok(/je firma/.test(v.infoFirmy), `u firmy je napsané, že je to firma („${v.infoFirmy.slice(0, 40)}…")`)
  }
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Zaměstnance jde zařadit pod firmu')
process.exit(chyby ? 1 : 0)
