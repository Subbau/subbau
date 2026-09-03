// =====================================================================
// Vyrobí ukazka.html z ostré appky.
//
// Spouští se před každým nasazením (npm-free: `node ukazka/generuj.mjs`).
// Díky tomu se ukázka nikdy nerozejde s tím, co appka doopravdy umí —
// zájemci nesmíme prodávat obrazovky, které už vypadají jinak.
//
// CO SE PŘI TOM DĚJE:
//   1. Vyhodí se adresa databáze i klíč k ní a nahradí se prázdnem.
//      Do ukázky se tedy klíč fyzicky nedostane, i kdyby v kódu zůstalo
//      volání, na které jsme zapomněli.
//   2. Místo skutečného připojení se vloží databáze v paměti.
//   3. Vymění se název firmy za neutrální.
//   4. Vypne se service worker — ukázka se nesmí uložit do prohlížeče
//      a začít se plést s ostrou appkou.
// =====================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const kde = path.dirname(fileURLToPath(import.meta.url));
const koren = path.join(kde, '..');
const FIRMA = 'StavKo';

const chyba = (t) => { console.error('❌ ' + t); process.exit(1); };
const vymen = (s, hledej, nahrad, popis, kolikMa) => {
  const kolik = s.split(hledej).length - 1;
  if (kolikMa != null && kolik !== kolikMa) chyba(`${popis}: čekáno ${kolikMa}×, nalezeno ${kolik}×`);
  if (kolik === 0) chyba(`${popis}: nenalezeno`);
  console.log(`   ${popis}: ${kolik}×`);
  return s.split(hledej).join(nahrad);
};

let s = fs.readFileSync(path.join(koren, 'subbau_final.html'), 'utf8');
const puvodniDelka = s.length;
console.log('Vyrábím ukázku z appky (' + puvodniDelka.toLocaleString('cs-CZ') + ' B)');

// --- 1) pryč s adresou databáze a klíčem ---
const mUrl = s.match(/const SUPABASE_URL = '([^']+)'/);
const mKey = s.match(/const SUPABASE_ANON_KEY = '([^']+)'/);
if (!mUrl || !mKey) chyba('nenašel jsem SUPABASE_URL nebo SUPABASE_ANON_KEY');
s = s.replace(mUrl[0], "const SUPABASE_URL = ''   // ukázka: žádná databáze");
s = s.replace(mKey[0], "const SUPABASE_ANON_KEY = ''   // ukázka: žádný klíč");

// --- 2) místo skutečného klienta ten falešný ---
const mSb = s.match(/const sb = createClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{[\s\S]*?\n\}\)/);
if (!mSb) chyba('nenašel jsem vytvoření klienta (const sb = createClient…)');
s = s.replace(mSb[0], 'const sb = window.sb   // ukázka: databáze v paměti prohlížeče');

// --- 2b) předpřipojení k databázi taky pryč (je v <head>) ---
s = s.replace(/<link[^>]*rel="preconnect"[^>]*supabase\.co[^>]*>/g,
  '<!-- ukázka: k žádné databázi se nepřipojujeme -->');

// --- 3) knihovna supabase-js se v ukázce nenačítá ---
s = s.replace(/<script[^>]*src="\/supabase\.js"[^>]*><\/script>/g,
  '<!-- ukázka: supabase-js se nenačítá, není kam se připojovat -->');
s = s.replace(/document\.write\([^)]*unpkg[^)]*\)/g, 'void 0');

// --- 4) neutrální název místo skutečné firmy ---
const predVymenou = (s.match(/SubBau/g) || []).length;
s = s.split('SubBau').join(FIRMA);
s = s.split('subbau.cz').join('ukazka.cz');
s = s.split('subbau.vercel.app').join('ukazka.local');
console.log(`   název firmy vyměněn: ${predVymenou}×`);

// --- 5) service worker se v ukázce neregistruje ---
s = s.replace(/navigator\.serviceWorker\.register\(/g, 'void (0) && navigator.serviceWorker.register(');

// --- 6) vložit ukázkovou vrstvu PŘED hlavní skript appky ---
const soubory = ['databaze-v-pameti.js', 'sb-nahrada.js', 'vymyslena-data.js'];
// Vlastní vrstva prochází stejnou výměnou názvu jako appka — i v komentářích
// by jinak zůstalo skutečné jméno firmy a kontrola na konci by to (správně)
// zastavila.
const bezJmena = (t) => t.split('SubBau').join(FIRMA);
const vrstva = soubory.map(f => {
  const c = bezJmena(fs.readFileSync(path.join(kde, f), 'utf8'));
  console.log(`   vložen ${f} (${c.length.toLocaleString('cs-CZ')} B)`);
  return c;
}).join('\n');
const prepinac = bezJmena(fs.readFileSync(path.join(kde, 'prepinac.js'), 'utf8'));

const kotva = '<script>';
const kde1 = s.indexOf(kotva);
if (kde1 < 0) chyba('nenašel jsem první <script>');
s = s.slice(0, kde1) + '<script>\n' + vrstva + '\n</script>\n' + s.slice(kde1);

// --- 7) přepínač až na konec, po appce ---
const konec = s.lastIndexOf('</body>');
if (konec < 0) chyba('nenašel jsem </body>');
s = s.slice(0, konec) + '<script>\n' + prepinac + '\n</script>\n' + s.slice(konec);

// --- 8) titulek a poznámka pro vyhledávače ---
s = s.replace(/<title>[^<]*<\/title>/, `<title>${FIRMA} — ukázka docházkového systému</title>`);
s = s.replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">');

// --- KONTROLA: v ukázce nesmí zůstat nic skutečného ---
const zakazane = [
  [mKey[1], 'klíč k databázi'],
  [mUrl[1].replace('https://', ''), 'adresa databáze'],
  ['SubBau', 'název firmy'],
  ['subbau.vercel.app', 'adresa ostré appky'],
];
let spatne = 0;
for (const [co, popis] of zakazane) {
  if (co && s.includes(co)) { console.error(`   ❌ v ukázce zůstalo: ${popis}`); spatne++; }
  else console.log(`   ✅ neobsahuje: ${popis}`);
}
if (spatne) chyba(`${spatne}× zůstalo něco skutečného — ukázku NENASAZUJI`);

fs.writeFileSync(path.join(koren, 'ukazka.html'), s);
console.log(`\n✅ ukazka.html hotová (${s.length.toLocaleString('cs-CZ')} B)`);
