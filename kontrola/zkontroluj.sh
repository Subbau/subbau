#!/bin/bash
# Kde leží samotná kontrola. Musí se zjistit HNED — skript si dál mění
# pracovní složku a potom už by relativní cesta ukazovala jinam.
KONTROLA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Kontrola appky před nasazením. Ověřuje DVĚ věci:
#   1) syntaxi a odkazy na neexistující proměnné/funkce (ESLint)
#   2) že funkce volané z HTML atributů (onclick=…) opravdu existují
#
# Skript raději skončí chybou, než aby napsal „v pořádku" o něčem, co
# nezkontroloval. Proto si před každou kontrolou ověří sám na sobě, že ESLint
# chybu pozná — jednou totiž tiše padal a appka s překlepem prošla k lidem.
#
#   npm i eslint globals    (jednou, ve složce kontrola)
#   bash kontrola/zkontroluj.sh subbau_final.html
set -uo pipefail
KDE="$(cd "$(dirname "$0")" && pwd)"
SOUBOR="${1:-$KDE/../subbau_final.html}"
# Cestu si hned převedeme na absolutní — níž se přepíná do složky kontroly
# a relativní cesta by se rozbila.
case "$SOUBOR" in /*) ;; *) SOUBOR="$(pwd)/$SOUBOR" ;; esac

[ -r "$SOUBOR" ] || { echo "❌ Soubor nejde přečíst: $SOUBOR"; exit 2; }
[ -r "$KDE/eslint.config.mjs" ] || { echo "❌ Chybí $KDE/eslint.config.mjs — kontrola NEPROBĚHLA"; exit 2; }
[ -r "$KDE/handlery.py" ] || { echo "❌ Chybí $KDE/handlery.py — kontrola NEPROBĚHLA"; exit 2; }
[ -x "$KDE/node_modules/.bin/eslint" ] || { echo "❌ Chybí ESLint — spusťte: cd $KDE && npm i eslint globals"; exit 2; }

python3 - "$SOUBOR" > "$KDE/appka.js" <<'PY'
import re, io, sys
s = io.open(sys.argv[1], encoding='utf-8', errors='replace').read().replace(chr(13), '')
b = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)
if not b:
    sys.stderr.write('v souboru neni zadny vnitrni <script>\n'); sys.exit(1)
sys.stdout.write(max(b, key=len))
PY
[ $? -eq 0 ] || { echo "❌ Nepodařilo se vytáhnout kód z appky"; exit 2; }

VEL=$(wc -c < "$KDE/appka.js")
[ "$VEL" -gt 100000 ] || { echo "❌ Vytažený kód je podezřele malý ($VEL B) — kontrola neproběhla"; exit 2; }

node --check "$KDE/appka.js" || { echo "❌ SYNTAXE JE ŠPATNĚ"; exit 1; }

# RANÝ ODCHYT DENÍKU CHYB MUSÍ BÝT VE STARÉM JAVASCRIPTU (ES5) — 2. 11. 2026.
# Majitel: „v tom deníku to musí hlídat úplně všechno". Raný odchyt je úplně
# první skript stránky, ještě před knihovnou a appkou — právě proto zachytí
# i chybu, kvůli které se appka vůbec nespustí. Na starém telefonu, který
# hlavní skript (moderní JavaScript) nepřečte, musí tenhle běžet dál; kdyby
# v něm byla šipka, const nebo `…`, spadl by taky a deník by o tom telefonu
# nevěděl nic. Výš se kontroluje jen NEJDELŠÍ skript (hlavní), tenhle ne.
# Totéž platí pro raný odchyt odkazu pro odběratele (klient.html vedle appky).
# Kontrola musí umět selhat: na zkušebních vzorcích MUSÍ šipku odmítnout
# a starý zápis pustit — jinak skončí jako „NEPROBĚHLA".
[ -r "$KDE/node_modules/acorn/package.json" ] || { echo "❌ Chybí acorn ($KDE/node_modules/acorn) — kontrola ES5 NEPROBĚHLA. Spusťte: cd $KDE && npm i eslint globals"; exit 2; }
ES5_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zkontroluj-es5.XXXXXX")" || { echo "❌ Nejde založit dočasnou složku — kontrola ES5 NEPROBĚHLA"; exit 2; }
trap 'rm -rf "$ES5_DIR"' EXIT
es5() {   # $1 = soubor se skriptem; projde jen ES5, jinak vypíše proč a vrátí 1
  node -e '
    const acorn = require(process.argv[1])
    const src = require("fs").readFileSync(process.argv[2], "utf8")
    try { acorn.parse(src, { ecmaVersion: 5, sourceType: "script" }) }
    catch (e) { console.log("   " + e.message); process.exit(1) }' "$KDE/node_modules/acorn" "$1"
}
printf 'var nic = 0\nconst x = () => 1\n' > "$ES5_DIR/vzorek-novy.js"
printf 'var x = function () { return 1 }\nvar o = { a: 1, }\n' > "$ES5_DIR/vzorek-stary.js"
if es5 "$ES5_DIR/vzorek-novy.js" >/dev/null 2>&1 || ! es5 "$ES5_DIR/vzorek-stary.js" >/dev/null 2>&1; then
  echo "❌ KONTROLA ES5 NEPROBĚHLA: acorn nerozlišil nový a starý JavaScript na zkušebních vzorcích."
  exit 2
fi
# $1 = soubor, $2 = značka, $3 = popis; skript se značkou musí být právě jeden.
zkontroluj_rany() {
  local pocet
  pocet="$(python3 - "$1" "$2" "$ES5_DIR/rany.js" <<'PY'
import re, io, sys
s = io.open(sys.argv[1], encoding='utf-8', errors='replace').read().replace(chr(13), '')
b = [x for x in re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S) if sys.argv[2] in x]
if len(b) == 1:
    io.open(sys.argv[3], 'w', encoding='utf-8').write(b[0])
print(len(b))
PY
)"
  [ "$pocet" = "1" ] || { echo "❌ $3: skript se značkou „$2\" je v souboru ${pocet:-?}× — má tam být právě jednou ($1)"; exit 1; }
  node --check "$ES5_DIR/rany.js" || { echo "❌ $3: SYNTAXE JE ŠPATNĚ"; exit 1; }
  local proc
  proc="$(es5 "$ES5_DIR/rany.js")" || { echo "❌ $3 není ES5 (starý telefon by ho nepřečetl):"; echo "$proc"; exit 1; }
  echo "   $3: ES5 v pořádku"
}
zkontroluj_rany "$SOUBOR" 'DENÍK CHYB — RANÝ ODCHYT' 'Raný odchyt deníku chyb'
KLIENT_HTML="$(dirname "$SOUBOR")/klient.html"
if [ -f "$KLIENT_HTML" ]; then
  zkontroluj_rany "$KLIENT_HTML" 'DENÍK CHYB — RANÝ ODCHYT ODKAZU' 'Raný odchyt v odkazu pro odběratele (klient.html)'
else
  echo "   (vedle appky není klient.html — jeho raný odchyt se tu nekontroluje)"
fi

cd "$KDE" || exit 2

# ZKUŠEBNÍ VZOREK — soubor, který chybu MÁ. Když ji ESLint nenajde, nefunguje.
printf 'function zkusebniVzorek(){ return promennaKteraNeexistuje + 1 }\n' > "$KDE/vzorek.js"
VZOREK="$(./node_modules/.bin/eslint --no-config-lookup -c eslint.config.mjs vzorek.js 2>&1 || true)"
rm -f "$KDE/vzorek.js"
if ! echo "$VZOREK" | grep -q "no-undef"; then
  echo "❌ KONTROLA NEPROBĚHLA: ESLint nenašel chybu ani v pokusném souboru."
  echo "   Spusťte v $KDE:  npm i eslint globals"
  echo "$VZOREK" | head -5
  exit 2
fi

VYSTUP="$(./node_modules/.bin/eslint --no-config-lookup -c eslint.config.mjs appka.js 2>&1 || true)"
echo "$VYSTUP" | grep -q "File ignored" && { echo "❌ Soubor byl přeskočen — kontrola neproběhla"; exit 2; }
echo "$VYSTUP" | grep -q "Cannot find module\|Oops!" && { echo "❌ ESLint spadl — kontrola neproběhla:"; echo "$VYSTUP" | head -5; exit 2; }

PRAVIDLA="no-undef|no-redeclare|no-dupe|no-const-assign|no-func-assign|no-unreachable|no-obj-calls|use-isnan|no-cond-assign|no-self-assign|no-unsafe-negation|no-sparse-arrays|getter-return|no-setter-return|no-compare-neg-zero|no-duplicate-case|no-class-assign"
POCET=$(echo "$VYSTUP" | grep -cE "$PRAVIDLA" || true)
if [ "$POCET" -gt 0 ]; then
  echo "❌ CHYBA V KÓDU ($POCET):"
  echo "$VYSTUP" | grep -E "$PRAVIDLA"
  exit 1
fi

python3 "$KDE/handlery.py" "$SOUBOR" "$KDE/appka.js" || exit 1
rm -f "$KDE/appka.js"
echo "✅ Zkontrolováno ($VEL B kódu): syntaxe, odkazy i handlery z HTML v pořádku."

# Soubory, bez kterých je web venku mrtvý (vercel.json a spol.).
# Bez téhle kontroly prošlo nasazení, které smazalo vercel.json a shodilo appku na 404.
bash "$KONTROLA_DIR/nechybi-soubory.sh" || exit 1
