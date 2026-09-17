// Upomínky za chybějící doklady. Chodí v pondělí a ve čtvrtek, jen jako zpráva
// v aplikaci. Zkouší se rovnou ta funkce ze serverové části — bez sítě,
// s podstrčenými daty, ať je vidět, komu by co odešlo.
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const SOUBOR = path.join(D, 'api', 'check-expiring-docs.js')
const kod = fs.readFileSync(SOUBOR, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }

console.log('\n1) Kód')
ok(/const POVINNE_DOKLADY = \['op', 'zivnost', 'a1', 'ridicak'\]/.test(kod), 'povinné doklady sedí s appkou')
ok(/if \(den !== 1 && den !== 4\) return/.test(kod), 'posílá se jen v pondělí a ve čtvrtek')
ok(/const UPOMINKA_NADPIS =/.test(kod) && /type: 'obecna'/.test(kod), 'upomínka se pozná podle nadpisu, typ zůstal ten, co databáze zná')
ok(!/sendEmail[\s\S]{0,200}UPOMINKA_NADPIS/.test(kod), 'chodí jen do aplikace, ne e-mailem')
ok(/created_at=gte\.\$\{dnesIso\}T00:00:00/.test(kod), 'dvakrát za den se neposílá')
ok(/w\.bez_ridicaku === true/.test(kod), 'kdo řidičák nemá, tomu se nepřipomíná')
ok(!/TOHLE_TAM_NENI/.test(kod), 'kontrolní měření: test umí i nenajít')

console.log('\n2) Komu a kdy by to odešlo')
// Funkci vytáhneme ze souboru a pustíme s podstrčeným `sb`.
const zacatek = kod.indexOf('async function upomenChybejiciDoklady')
const konec = kod.indexOf('module.exports')
const telo = kod.slice(zacatek, konec)
const DOC_LABELS = { op: 'Občanský průkaz', pas: 'Cestovní pas', ridicak: 'Řidičský průkaz',
                     zivnost: 'Živnostenské oprávnění', a1: 'Formulář A1' }
const POVINNE_DOKLADY = ['op', 'zivnost', 'a1', 'ridicak']

function postavFunkci(data) {
  const odeslane = []
  const sb = async (cesta, klic, opts) => {
    if (opts && opts.method === 'POST') { odeslane.push(JSON.parse(opts.body)); return {} }
    if (cesta.startsWith('profiles')) return data.lide
    if (cesta.startsWith('documents')) return data.doklady
    if (cesta.startsWith('notifications')) return data.dnesUz || []
    return []
  }
  // eslint-disable-next-line no-new-func
  const f = new Function('sb', 'DOC_LABELS', 'POVINNE_DOKLADY', 'UPOMINKA_NADPIS', telo + '; return upomenChybejiciDoklady')
  return { fn: f(sb, DOC_LABELS, POVINNE_DOKLADY, '📄 Chybí nám od vás doklady'), odeslane }
}

const lide = [
  { id: 'a', full_name: 'Chybí mu všechno' },
  { id: 'b', full_name: 'Má vše', },
  { id: 'c', full_name: 'Bez řidičáku', bez_ridicaku: true }
]
const doklady = [
  { worker_id: 'b', doc_type: 'op', status: 'ok' },
  { worker_id: 'b', doc_type: 'zivnost', status: 'ok' },
  { worker_id: 'b', doc_type: 'a1', status: 'ok' },
  { worker_id: 'b', doc_type: 'ridicak', status: 'ok' },
  { worker_id: 'c', doc_type: 'pas', status: 'ok' },
  { worker_id: 'c', doc_type: 'zivnost', status: 'ok' },
  { worker_id: 'c', doc_type: 'a1', status: 'ok' }
]

// pondělí
{
  const { fn, odeslane } = postavFunkci({ lide, doklady })
  const r = await fn('KLIC', '2026-09-21')      // pondělí
  ok(r.poslano === 1, `v pondělí odešla upomínka jen tomu, komu doklady chybí (${r.poslano})`)
  ok(odeslane[0]?.worker_id === 'a', 'a je to ten správný člověk')
  ok(/Občanský průkaz/.test(odeslane[0]?.message || ''), 've zprávě je, co mu chybí')
  ok(odeslane[0]?.title === '📄 Chybí nám od vás doklady', 'a má nadpis, podle kterého se pozná')
}
// čtvrtek
{
  const { fn } = postavFunkci({ lide, doklady })
  const r = await fn('KLIC', '2026-09-24')      // čtvrtek
  ok(r.poslano === 1, 've čtvrtek taky')
}
// úterý — nemá se posílat nic
{
  const { fn, odeslane } = postavFunkci({ lide, doklady })
  const r = await fn('KLIC', '2026-09-22')      // úterý
  ok(!!r.preskoceno && odeslane.length === 0, 'v úterý se neposílá nic')
}
// kdo má vše, nedostane nic — a kdo nemá řidičák, taky ne
{
  const { fn, odeslane } = postavFunkci({ lide, doklady })
  await fn('KLIC', '2026-09-21')
  const komu = odeslane.map(o => o.worker_id)
  ok(!komu.includes('b'), 'kdo má všechno, upomínku nedostane')
  ok(!komu.includes('c'), 'a kdo prohlásil, že nemá řidičák, taky ne')
}
// podruhé týž den se neposílá
{
  const { fn, odeslane } = postavFunkci({ lide, doklady, dnesUz: [{ worker_id: 'a' }] })
  const r = await fn('KLIC', '2026-09-21')
  ok(r.poslano === 0 && odeslane.length === 0, 'dvakrát za den se neposílá')
}

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Upomínky chodí v pondělí a ve čtvrtek tomu, komu chybí doklady')
process.exit(chyby ? 1 : 0)
