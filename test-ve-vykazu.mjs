// Zaškrtávátko v Týmech: kdo je odškrtnutý, nepatří do výkazů hodin.
// Automaticky jsou zaškrtnutí všichni — dokud se někdo ručně neodškrtne,
// nesmí se v appce změnit vůbec nic.
import puppeteer from 'puppeteer'
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const UKAZKA = path.join(D, 'ukazka.html')
const API = path.join(D, 'api', 'klient-dochazka.js')
function stejnaVerze() {
  const v = s => (fs.readFileSync(s, 'utf8').match(/SUBBAU_VERZE\s*=\s*'([^']+)'/) || [])[1]
  const a = v(APP), b = v(UKAZKA)
  if (!a || a !== b) { console.error(`❌ ukázka je stará (appka ${a}, ukázka ${b}) — spusť node ukazka/generuj.mjs`); process.exit(1) }
}
const zdroj = fs.readFileSync(APP, 'utf8')
const api = fs.readFileSync(API, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }
stejnaVerze()

console.log('\n1) Kód — jedno místo rozhoduje, všechna výkazová místa se ptají')
ok(/function patriDoVykazu\(w\) \{\s*\n\s*return !w \|\| w\.ve_vykazu !== false/.test(zdroj),
   'chybějící sloupec i prázdná hodnota znamenají „patří do výkazu"')
ok(/async function prepniVeVykazu/.test(zdroj), 'existuje přepínání')
ok(/\.update\(\{ ve_vykazu: zapnout \}\)\.eq\('id', id\)\.select\('id, ve_vykazu'\)/.test(zdroj),
   'zápis si ověří, že opravdu trefil řádek')
ok(/supabase-migrace-ve-vykazu\.sql/.test(zdroj), 'při chybějící migraci appka řekne, kterou spustit')
ok(/if \(data\[0\]\.ve_vykazu !== zapnout\)/.test(zdroj),
   'appka pozná, když databáze zápis tiše vrátila zpátky')
ok((zdroj.match(/42703/g) || []).length >= 3,
   'ústupy se pouštějí jen u chybějícího sloupce, ne při výpadku sítě')
ok(/mimoVykaz: !patriDoVykazu\(w\)/.test(zdroj) && /🚫 mimo výkaz/.test(zdroj),
   'v týdenním přehledu je u takového člověka odznak, ať součet v tisku nepřekvapí')
ok(/platí to i zpětně/.test(zdroj), 'nápověda říká, že odškrtnutí platí i na staré týdny')
ok(/w\.team_id === teamId && patriDoVykazu\(w\)/.test(zdroj), 'PDF za tým filtruje')
ok((zdroj.match(/w\.team_id === teamId && patriDoVykazu\(w\)/g) || []).length === 2,
   'filtruje i nabídka týdnů u toho PDF (jinak by šel vybrat prázdný týden)')
ok(/mimoVykaz\.has\(r\.worker_id\)/.test(zdroj), 'týdenní přehled hodin filtruje')
ok(/\.select\('id, full_name, profession, is_active(, team_id)?'\)\.in\('role',\['osvec', ?'partak'\]\)/.test(zdroj),
   'flexibilní export má pojistku, kdyby migrace ještě neproběhla')
ok(/ve_vykazu/.test(fs.readFileSync(path.join(D,'supabase-migrace-ve-vykazu.sql'),'utf8')),
   'migrace je připravená')
ok(/add column if not exists ve_vykazu boolean not null default true/.test(
     fs.readFileSync(path.join(D,'supabase-migrace-ve-vykazu.sql'),'utf8')),
   'v databázi je to automaticky zapnuté u všech')
{
  const m = fs.readFileSync(path.join(D,'supabase-migrace-ve-vykazu.sql'),'utf8')
  ok(/^begin;/m.test(m) && /^commit;/m.test(m), 'migrace běží v transakci — buď celá, nebo nic')
  ok(/create trigger profiles_zamek_ve_vykazu_trg/.test(m),
     'v databázi je zámek — sám se z výkazu nikdo nevyndá')
  ok(/new\.ve_vykazu := old\.ve_vykazu/.test(m), 'nesprávci se hodnota vrátí, jak byla')
  ok(/if v_je_admin then\s*\n\s*return new;/.test(m), 'správce ji měnit smí')
  ok(/drop trigger if exists profiles_zamek_ve_vykazu_trg/.test(m), 'migrace jde spustit víckrát')
  ok(!/drop trigger if exists profiles_zamek_roli_trg/.test(m),
     'a nesahá na stávající zámek rolí')
}

console.log('\n2) Odkaz pro odběratele')
ok(/ve_vykazu=is\.false/.test(api), 'server si zjistí, kdo je mimo výkaz')
ok(/mimoVykaz\.has\(r\.worker_id\)\) continue/.test(api), 'a vyřadí jeho dny, i když má zapsanou partu')
ok(/catch \(e\) \{ console\.warn\('\[klient\] ve_vykazu se nenačetlo/.test(api),
   'bez migrace odkaz běží dál a nikoho nevyhodí')

console.log('\n3) Kontrolní měření')
ok(!/patriDoVykazuNEEXISTUJE/.test(zdroj), 'test umí i nenajít')

console.log('\n4) Proklikání v Týmech')
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
try {
  const p = await b.newPage()
  const padky = []
  p.on('pageerror', e => padky.push(e.message))
  await p.goto('file://' + UKAZKA, { waitUntil: 'networkidle0' })
  await p.waitForFunction(() => typeof window.loadTeams === 'function', { timeout: 20000 })

  const v = await p.evaluate(async () => {
    const toasty = []
    window.showToast = (m) => { toasty.push(String(m)) }
    sv('tymy'); await new Promise(r => setTimeout(r, 1800))

    const boxy = () => [...document.querySelectorAll('input[onchange*="prepniVeVykazu"]')]
    const prvni = boxy()[0]
    const id = (prvni?.getAttribute('onchange') || '').match(/prepniVeVykazu\('([^']+)'/)?.[1]
    const jmeno = prvni?.closest('div')?.querySelector('span')?.textContent?.replace(' ↗','').trim()
    const zac = { kolik: boxy().length, vsechnyZaskrtnute: boxy().every(x => x.checked) }
    // Bývalí a zablokovaní se v Týmech normálně neukazují, ale do výkazů patří —
    // musí tedy mít zaškrtávátko taky, jinak by je odtamtud nešlo vyndat.
    // V ukázce nikdo takový není, tak si ho na chvíli vyrobíme.
    // _workersCache není na window, takže druhého člověka vezmeme z obrazovky.
    const druhy = boxy().map(x => ({
      id: (x.getAttribute('onchange') || '').match(/prepniVeVykazu\('([^']+)'/)?.[1],
      jmeno: x.closest('div')?.querySelector('span')?.textContent?.replace(' ↗','').trim()
    })).find(x => x.id && x.id !== id && x.jmeno)
    const pokus = druhy ? { id: druhy.id, full_name: druhy.jmeno } : null
    let skrytyVidet = null, skrytyMaBox = null
    if (pokus) {
      await sb.from('profiles').update({ can_track_hours: false }).eq('id', pokus.id)
      await loadTeams(); await new Promise(r => setTimeout(r, 1200))
      const t = document.getElementById('teams-list')?.textContent || ''
      skrytyVidet = t.includes(pokus.full_name)
      skrytyMaBox = boxy().some(x => (x.getAttribute('onchange') || '').includes(pokus.id))
      await sb.from('profiles').update({ can_track_hours: true }).eq('id', pokus.id)
      await loadTeams(); await new Promise(r => setTimeout(r, 1200))
    }

    // Výkaz za tým odchytíme z náhledu, co by se tiskl — tam je vidět pravda.
    let naposledy = ''
    const puvodni = window.showPrintPreview
    window.showPrintPreview = (html) => { naposledy = String(html || '') }
    const tymId = (document.querySelector('[onclick*="generateTeamAttendancePdf"]')
                    ?.getAttribute('onclick') || '').match(/generateTeamAttendancePdf\('([^']+)'/)?.[1]
    const vykaz = async () => {
      naposledy = ''
      try { await generateTeamAttendancePdf(tymId, 'Test') } catch (e) {}
      await new Promise(r => setTimeout(r, 900))
      return naposledy
    }

    const pred = await vykaz()
    await prepniVeVykazu(id, { checked: false })
    await new Promise(r => setTimeout(r, 700))
    const { data: d1 } = await sb.from('profiles').select('id, ve_vykazu').eq('id', id)
    const po = await vykaz()
    const popis = boxy().find(x => (x.getAttribute('onchange')||'').includes(id))
    const stavPoOdskrtnuti = { zaskrtnuty: !!popis?.checked,
                               napis: popis?.closest('label')?.textContent?.trim() }

    // Majitel si výslovně přál, aby se tím peníze nehnuly. Částky samy rostou,
    // jak běží dnešní směna, takže je nemá smysl porovnávat na haléř — měříme
    // to, co je podstatné: odškrtnutý člověk musí v Provizích pořád BÝT.
    const vProvizich = async () => {
      try { await renderProvizeContent() } catch (e) {}
      await new Promise(r => setTimeout(r, 900))
      const t = document.getElementById('provize-content')?.textContent || ''
      return { maObsah: t.length > 200, maJmeno: !!(jmeno && t.includes(jmeno)) }
    }
    const penizeMimo = await vProvizich()

    await prepniVeVykazu(id, { checked: true })
    await new Promise(r => setTimeout(r, 700))
    const penizeZpet = await vProvizich()
    const zpet = await vykaz()
    window.showPrintPreview = puvodni

    const je = (h) => !!(jmeno && h.includes(jmeno))
    return { zac, id, jmeno, toasty, ulozeno: d1?.[0]?.ve_vykazu,
             vykazMaJmeno: { pred: je(pred), po: je(po), zpet: je(zpet) },
             vykazPrazdny: !pred, stavPoOdskrtnuti, penizeMimo, penizeZpet,
             skrytyVidet, skrytyMaBox, skrytyJmeno: pokus?.full_name }
  })

  ok(v.zac.kolik > 0, `zaškrtávátko je u každého člena týmu (${v.zac.kolik}×)`)
  ok(v.zac.vsechnyZaskrtnute, 'a všichni jsou automaticky zaškrtnutí')
  ok(!v.vykazPrazdny, 'kontrolní měření: výkaz za tým se opravdu vygeneroval')
  ok(v.ulozeno === false, 'odškrtnutí se uloží do databáze' + (v.toasty.length ? ' — ' + v.toasty[0] : ''))
  ok(v.vykazMaJmeno.pred === true, `před odškrtnutím je ${v.jmeno} ve výkazu`)
  ok(v.vykazMaJmeno.po === false, 'po odškrtnutí ve výkazu NENÍ')
  ok(v.stavPoOdskrtnuti.zaskrtnuty === false, 'a v Týmech je vidět, že je odškrtnutý')
  ok(/mimo výkaz/.test(v.stavPoOdskrtnuti.napis || ''), 'u jména se napíše „mimo výkaz"')
  ok(v.vykazMaJmeno.zpet === true, 'zaškrtnutím se do výkazu vrátí')
  ok(v.penizeMimo.maObsah && v.penizeZpet.maObsah, 'kontrolní měření: Provize se opravdu vykreslily')
  ok(v.penizeMimo.maJmeno === true, 'PENÍZE ZŮSTÁVAJÍ — odškrtnutý člověk je v Provizích pořád')
  ok(v.penizeZpet.maJmeno === true, 'a je tam i po zaškrtnutí zpátky')
  ok(v.skrytyVidet === true, `zablokovaný ${v.skrytyJmeno} je v Týmech pořád vidět`)
  ok(v.skrytyMaBox === true, 'a má zaškrtávátko, takže ho jde z výkazu vyndat')
  ok(padky.length === 0, 'stránka nevyhodila chybu' + (padky.length ? ': ' + padky[0] : ''))
} finally { await b.close() }

console.log(chyby ? `\n❌ ${chyby} problémů` : '\n✅ Odškrtnutý člověk ve výkazu není, zaškrtnutý ano')
process.exit(chyby ? 1 : 0)
