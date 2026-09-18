// Přístupy: lidi seřazené jako v docházce (firmy pohromadě), pod jménem
// e-mail a skupina. Dřív to byla čistá abeceda křížem přes všechny firmy.
import fs from 'fs'
import path from 'path'
const D = path.dirname(new URL(import.meta.url).pathname)
const APP = path.join(D, 'subbau_final.html')
const zdroj = fs.readFileSync(APP, 'utf8')
let chyby = 0
const ok = (p, t) => { console.log((p ? '  ✅ ' : '  ❌ ') + t); if (!p) chyby++ }

// Vyřízni jen funkci loadAccess — ať se netrefím do stejného kódu jinde v appce.
const zac = zdroj.indexOf('async function loadAccess()')
const kon = zdroj.indexOf('\nasync function ', zac + 10)
const fce = zdroj.slice(zac, kon > 0 ? kon : zac + 20000)
ok(zac > 0 && fce.length > 500, 'funkce loadAccess se našla')

console.log('\n1) Data — sekce musí vědět, kdo kam patří')
ok(/team_id, subteam_id/.test(fce), 'načítá se firma i podskupina')
ok(/from\('teams'\)/.test(fce) && /from\('subteams'\)/.test(fce) && /from\('companies'\)/.test(fce),
   'a k tomu číselníky firem a skupin')
ok(/Promise\.all/.test(fce), 'ptá se na všechno naráz, ne popořadě')
ok(/select\('id, full_name, email, role, is_active, last_login_at, login_count, last_seen_at, team_id'\)/.test(fce),
   'starší databáze bez subteam_id má ústup, ať sekce nezhasne')

console.log('\n2) Řazení — stejné jako v docházce')
ok(/const firmaPristupu = w =>/.test(fce), 'firma se určuje jedním místem')
ok(/if \(t\.company_id && pCompName\[t\.company_id\]\) return pCompName\[t\.company_id\]/.test(fce),
   'název firmy se bere přes company_id — stejně jako docházka a provize')
ok(/cleanTeamName/.test(fce), 'a když firma není, použije se očištěné jméno týmu')
ok(/if \(!fa && fb\) return 1/.test(fce) && /if \(fa && !fb\) return -1/.test(fce),
   'kdo nemá firmu, jde nakonec')
ok(/localeCompare\(fb, 'cs'\)/.test(fce), 'řadí se česky (aby Č nebylo až za Z)')
ok(/podskupinaPristupu\(a\)\.localeCompare\(podskupinaPristupu\(b\), 'cs'\)/.test(fce),
   'uvnitř firmy podle podskupiny')
ok(/return \(a\.full_name \|\| ''\)\.localeCompare\(b\.full_name \|\| '', 'cs'\)/.test(fce),
   'a teprve pak podle jména')

console.log('\n3) Co je vidět v řádku')
ok(/margin-left:16px">\$\{escAttr\(w\.email\)\}/.test(fce), 'e-mail je pod jménem')
ok(/display:block;font-size:11\.5px/.test(fce), 'e-mail je na vlastním řádku, ne přilepený za jménem')
ok(/👥 \$\{escAttr\(podsk\)\}/.test(fce), 'skupina je vidět')
ok(/🏢 ' \+ escAttr\(firmaPristupu\(w\)\)/.test(fce), 'a firma taky')
ok(/tbl-group/.test(fce) && /colspan="6"/.test(fce),
   'nad každou firmou je hlavička — a má správný počet sloupců')
ok(/\$\{pocet\} lidí/.test(fce), 'u firmy je vidět, kolik jich tam je')
ok(/firmaPristupu\(w\) \+ ' ' \+ podsk/.test(fce), 'hledat jde i podle firmy a skupiny')
ok(/delete tbody\.dataset\.accessHtml/.test(fce),
   'pojistka proti zamrznutí na „Načítám…" zůstala nedotčená')
ok(!/escAttr\(w\.NEEXISTUJICI_POLE\)/.test(fce), 'kontrolní měření: test umí i nenajít')

console.log(chyby ? `\n❌ ${chyby} chyb` : '\n✅ Přístupy: firmy pohromadě, e-mail i skupina vidět')
process.exit(chyby ? 1 : 0)
