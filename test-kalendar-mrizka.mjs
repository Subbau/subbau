// Kalendář podle Stavbyplánu (majitel 1. 10. 2026) — náhrada za test-kalendar-tri-tydny.mjs (ten
// hlídal tři týdny pod sebou — buildWeekTable, „Za dva týdny").
//   node test-kalendar-mrizka.mjs [soubor.html]
// Tohle je ZDROJOVÁ část. Chování (hodiny = týdenní přehled, návrat do sekce,
// závod dvou kreslení, posun do strany, klepnutí) ověřují ve WebKitu
// snimky-prototyp.mjs, over-hodiny.mjs a over-zavod.mjs — každá s kontrolním
// vzorkem, který ji prokazatelně shodí.
import fs from 'node:fs'
import path from 'node:path'

const soubor = process.argv[2] || path.join(import.meta.dirname, 'subbau_final.html')
const zdroj = fs.readFileSync(soubor, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }

console.log('Kalendář — mřížka lidé × dny (' + path.basename(soubor) + ')')
ok(/<table class="kal">/.test(zdroj) || /'<div class="kal-ramec"><table class="kal">/.test(zdroj), 'kreslí se mřížka lidé × dny')
ok(/function calDny\(od, doo\)[\s\S]{0,400}T12:00:00/.test(zdroj), 'dny se počítají přes poledne (přechod letního času)')
ok(/function hodinyZaznamu\(r, dnes, ted\)[\s\S]{0,300}calcHours\(r\.check_in, ted, r\.break_start, r\.break_end\)[\s\S]{0,120}Number\(r\.total_hours\) \|\| 0/.test(zdroj),
   'hodiny dne počítá táž pravidla jako týdenní přehled (běžící směna do teď, jinak total_hours)')
ok(/barva: ABSENCE\.dovolena\.color/.test(zdroj) && /barva: ABSENCE\.nemoc\.color/.test(zdroj), 'dovolená a nemoc mají barvy z ABSENCE (jako zbytek appky)')
ok(/Object\.values\(kalStavy\(\)\)/.test(zdroj), 'legenda se skládá z týchž barev jako políčka')
ok(/content\.__kalHtml = null/.test(zdroj), 'po „Načítám…" se zapomene starý obsah (jinak kalendář visí na „Načítám…")')
ok((zdroj.match(/if \(poradi !== calPoradi\) return/g) || []).length === 2, 'pomalé starší kreslení nepřepíše novější (dvě pojistky)')
ok(/function zapisKalendar[\s\S]{0,900}scrollLeft/.test(zdroj) && /el\.__kalHtml === html/.test(zdroj), 'zápis bez bliknutí drží i posun mřížky do strany')
ok(/async function renderCalendar\(tichy\)/.test(zdroj) && /renderCalendar\(true\)/.test(zdroj), 'tiché obnovování zůstává')
ok(/openWorkerModal\(kdo\.dataset\.w\)/.test(zdroj) && /openWeekEdit\(kdo\.dataset\.w, kw\.week, kw\.year/.test(zdroj) && /showDayDetail\(den\.dataset\.den\)/.test(zdroj),
   'klepnutí: jméno → profil, políčko → úprava hodin, den → detail dne')
ok(/function dayStatusFor\(worker, dateStr, attSet, vacList\)/.test(zdroj) && /function attHasProblem\(rec\)/.test(zdroj), 'stav dne a „problém s časem" počítají původní funkce')
ok(/data-obdobi="tri"/.test(zdroj), 'zůstaly „3 týdny" dopředu (dřívější přání majitele)')
ok(!/buildWeekTable/.test(zdroj), 'po staré týdenní tabulce nezůstalo nic')
ok(!/TAKOVY_KOD_TAM_NENI/.test(zdroj), 'kontrolní měření: test umí i nenajít')
console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Kalendář: mřížka ze Stavbyplánu s barvami Docházky')
process.exit(chyby ? 1 : 0)
