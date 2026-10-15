#!/bin/bash
# Hlídá, že se nasazením neztratí soubory, bez kterých je appka venku mrtvá.
# Vzniklo poté, co se smazal vercel.json a lidem se místo docházky ukázalo 404.
# Pracovní složka se občas vyprázdní a `git add -A` ten výmaz poslušně zapíše.
cd "$(dirname "$0")/.." || exit 1

NUTNE=(
  vercel.json          # bez něj Vercel nenajde appku a vrací 404
  subbau_final.html    # samotná appka
  klient.html          # odkaz pro odběratele
  zasady.html          # veřejné zásady ochrany osobních údajů (App Store/Google Play)
  sw.js manifest.json
  favicon.ico favicon-32.png icon-192.png icon-512.png apple-touch-icon.png
  api/klient-dochazka.js api/send-invoice.js
  api/admin-update-worker.js api/check-expiring-docs.js
  supabase.js
)

chyby=0
for f in "${NUTNE[@]}"; do
  if [ ! -f "$f" ]; then
    echo "  ❌ CHYBÍ $f"; chyby=$((chyby+1))
  elif ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "  ❌ $f není v repozitáři — na server se nenahraje"; chyby=$((chyby+1))
  fi
done

# Co by šlo do commitu jako smazání
smazane=$(git diff --cached --diff-filter=D --name-only 2>/dev/null)
for f in $smazane; do
  for n in "${NUTNE[@]}"; do
    [ "$f" = "$n" ] && { echo "  ❌ commit by SMAZAL $f"; chyby=$((chyby+1)); }
  done
done

# Kontrola musí umět selhat, jinak zelená nic neznamená.
if [ -f "TENHLE_SOUBOR_NEEXISTUJE_kontrola" ]; then
  echo "  ❌ kontrola měří špatně"; exit 1
fi

if [ "$chyby" -gt 0 ]; then
  echo "❌ Nasazení by rozbilo web ($chyby). NEPOUŠTĚJ push."
  exit 1
fi
echo "✅ Všechny soubory nutné pro běh webu jsou na místě (${#NUTNE[@]})."

# zasady.html se generuje z appky (SOUHLAS_TEXT) — po úpravě souhlasu se musí
# spustit `node zasady/generuj.mjs` znovu, jinak veřejná stránka řekne lidem
# jinou verzi textu, než jakou odsouhlasí v appce.
if [ -f zasady.html ]; then
  verze_appky=$(grep -o "SOUHLAS_VERZE = '[^']*'" subbau_final.html | head -1 | sed "s/.*= '//;s/'$//")
  if ! grep -q "verze textu $verze_appky" zasady.html; then
    echo "❌ zasady.html je stará (appka má souhlas verze $verze_appky) — spusťte: node zasady/generuj.mjs"
    exit 1
  fi
fi
