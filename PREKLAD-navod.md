# Překlad popisů práce (CZ → DE + EN) v PDF — návod k nasazení

## Co se změnilo
V exportu docházky do PDF se pod český popis práce nově doplní
německý (DE) a anglický (EN) překlad. Pracovník píše dál česky —
překlad proběhne automaticky při generování PDF.

## Co je potřeba nasadit (2 části)

### 1) HTML soubor
Nahraj `subbau_final-19.html` jako obvykle (GitHub repo Subbau/subbau).

### 2) Serverless funkce na Vercelu
Soubor `api/translate.js` ulož do repa do složky `api/`
(tj. cesta `api/translate.js` v kořeni projektu). Vercel ji
automaticky zveřejní na adrese `https://subbau.vercel.app/api/translate`.

### 3) API klíč ve Vercelu (jednorázově)
1. Jdi na https://console.anthropic.com → vytvoř API klíč (sk-ant-...)
2. Vercel → projekt subbau → Settings → Environment Variables
3. Přidej:  Name = `ANTHROPIC_API_KEY`   Value = `sk-ant-...`
4. Redeploy projektu (Deployments → ... → Redeploy)

Klíč zůstává jen na serveru, do prohlížeče se nikdy neposílá.

## Jak je to odolné
- Překlad běží dávkově (všechny popisy jednou), ne řádek po řádku.
- Výsledky se cachují → stejný popis se nepřekládá opakovaně.
- Když překlad selže (síť, klíč, výpadek), PDF se vygeneruje
  normálně — jen s českým originálem. Nikdy to negeneruje chybu.

## Náklady
Používá model Claude Haiku (nejlevnější). Překlad pár desítek
krátkých popisů týdně = zanedbatelné náklady.
