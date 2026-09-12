#!/bin/bash
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
