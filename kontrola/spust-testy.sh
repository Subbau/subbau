#!/bin/bash
# Spustí všechny zkoušky. Když některá spadne, zkusí ji JEŠTĚ JEDNOU —
# desítky prohlížečů po sobě stroj zahltí a zkouška pak spadne na čekání,
# ne na chybě v appce. Rozdíl mezi „spadlo“ a „napodruhé prošlo“ se ale
# NEZAMLČUJE: vratká zkouška se vypíše zvlášť, ať je vidět, že je vratká.
cd "$(dirname "$0")/.." || exit 1

spadle=(); vratke=(); ok=0
for t in test-*.mjs; do
  if node "$t" >/tmp/zk.txt 2>&1 && ! grep -q "❌" /tmp/zk.txt; then
    echo "✅ $t"; ok=$((ok+1)); continue
  fi
  # druhý pokus — mezi tím chvíli počkáme, ať se stroj uvolní
  sleep 3
  if node "$t" >/tmp/zk2.txt 2>&1 && ! grep -q "❌" /tmp/zk2.txt; then
    echo "⚠️  $t — napoprvé spadla, napodruhé prošla (vratká)"
    vratke+=("$t"); ok=$((ok+1))
  else
    echo "❌ $t"
    grep "❌" /tmp/zk2.txt | head -3 | sed 's/^/     /'
    spadle+=("$t")
  fi
done

echo
echo "Prošlo: $ok   Vratkých: ${#vratke[@]}   Spadlo: ${#spadle[@]}"
if [ ${#vratke[@]} -gt 0 ]; then
  echo "Vratké (prošly až napodruhé): ${vratke[*]}"
fi
if [ ${#spadle[@]} -gt 0 ]; then
  echo "❌ NENASAZOVAT — spadlo: ${spadle[*]}"
  exit 1
fi
echo "✅ Všechny zkoušky prošly."
