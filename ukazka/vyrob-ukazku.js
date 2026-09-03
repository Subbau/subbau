// Vyrobí ukazka.html ze subbau_final.html. Ostrý soubor se NIKDY nemění.
const fs = require('fs'), path = require('path');
const KOREN = path.join(__dirname, '..');
let h = fs.readFileSync(path.join(KOREN, 'subbau_final.html'), 'utf8');
const puvodni = h.length;
const hlaseni = [];
function nahrad(popis, hledej, cim, povinne = true) {
  const pred = h;
  h = h.replace(hledej, typeof cim === 'function' ? cim : () => cim);
  const zmeneno = h !== pred;
  if (!zmeneno && povinne) { console.error('CHYBA: nenašel jsem — ' + popis); process.exit(1); }
  hlaseni.push((zmeneno ? '  ok  ' : ' přesk ') + popis);
}
// 1) preconnect na ostrou databázi
nahrad('preconnect na Supabase', /<link rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co"[^>]*>/, '');
// 2) knihovna Supabase se v ukázce nepoužívá
nahrad('<script src="/supabase.js">', /<script src="\/supabase\.js"><\/script>/, '');
// 2b) záložní stažení knihovny z unpkg — v ukázce se nepoužije vůbec
nahrad('záložní načtení supabase z unpkg', /if \(typeof supabase === 'undefined'\) \{[\s\S]*?\n\}/, '/* v ukázce netřeba */');
// 3) SRDCE: klíč, adresa a createClient pryč, místo nich falešný sb
const demo = fs.readFileSync(path.join(__dirname, 'databaze-v-pameti.js'), 'utf8')
            + '\n' + fs.readFileSync(path.join(__dirname, 'data-ukazka.js'), 'utf8')
            + '\n' + fs.readFileSync(path.join(__dirname, 'sb-nahrada.js'), 'utf8');
nahrad('klíč + createClient → falešný sb',
  /const SUPABASE_URL = '[^']*'\s*\nconst SUPABASE_ANON_KEY = '[^']*'\s*\n\s*\nconst \{ createClient \} = supabase\s*\nconst sb = createClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{[\s\S]*?\n\}\)/,
  () => '// ===== UKÁZKA: žádná databáze, žádný klíč =====\n' + demo + '\nconst sb = window.sb\n');
// 4) service worker v ukázce neregistrovat
nahrad('registrace service workeru', /navigator\.serviceWorker\.register\('\/sw\.js'\)/, 'Promise.reject(new Error("ukázka"))');
// 5) serverové funkce odříznout
nahrad('/api/ volání', /fetch\('\/api\/(admin-update-worker|send-invoice|check-document)'/g,
  "Promise.reject(new Error('V ukázce není serverová část')) || fetch('/api/DISABLED-$1'");
// 6) skutečné kontakty
nahrad('telefonní seznam', /\{ reason: 'Faktury a ubytování'[\s\S]*?tel: '\+420 702 518 163' \}/,
  "{ reason: 'Faktury a ubytování', name: 'Marie Ukázková', tel: '+420 000 000 001' },\n" +
  "    { reason: 'Problém na stavbě / práce', name: 'Josef Ukázka', tel: '+420 000 000 002' },\n" +
  "    { reason: 'Aplikace a technické věci', name: 'Podpora', tel: '+420 000 000 003' }");
nahrad('kontaktní karta v HTML', /Bibiana Kissová/g, 'Marie Ukázková', false);
nahrad('kontaktní karta v HTML', /Jan Švamberk/g, 'Josef Ukázka', false);
nahrad('kontaktní karta v HTML', /Patrik Vrchlavský/g, 'Podpora', false);
nahrad('telefonní čísla', /\+?420 ?608 ?884 ?873/g, '+420 000 000 002', false);
nahrad('telefonní čísla', /\+?420 ?702 ?518 ?163/g, '+420 000 000 003', false);
nahrad('telefonní čísla', /\+?49 ?151 ?456 ?224 ?66/g, '+420 000 000 001', false);
// 7) německý odběratel
nahrad('výchozí odběratel', /name: 'Treskower Zimmermann und Dachdecker GmbH',\s*\n\s*address: '[^']*',\s*\n\s*id: '[^']*', vatId: '[^']*'/,
  "name: 'Musterbau GmbH',\n    address: 'Musterstraße 1, 10115 Berlin, Germany',\n    id: '123456789', vatId: 'DE123456789'");
nahrad('odběratel v placeholderu', /Treskower Zimmermann und Dachdecker GmbH/g, 'Musterbau GmbH', false);
nahrad('Treskower kdekoliv (i v komentářích)', /Treskower/g, 'Musterbau', false);
// 8) e-maily a značka
nahrad('faktury@subbau.cz', /faktury@subbau\.cz/g, 'faktury@ukazka.test', false);
nahrad('info@subbau.cz', /info@subbau\.cz/g, 'info@ukazka.test', false);
nahrad('emailRedirectTo', /emailRedirectTo: 'https:\/\/subbau\.vercel\.app'/, "emailRedirectTo: '/'", false);
nahrad('SubBau → DEMO Stavby', /SubBau s\.r\.o\./g, 'DEMO Stavby s.r.o.', false);
nahrad('SubBau → DEMO Stavby', /SubBau/g, 'DEMO Stavby', false);
// 9) kontrola
const nalezy = [];
if (/supabase\.co/.test(h)) nalezy.push('adresa databáze');
if (/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/.test(h)) nalezy.push('ANON KLÍČ');
for (const s of ['Bibiana', 'Švamberk', 'Vrchlavský', 'Treskower', 'subbau.cz', '608884873', '702518163'])
  if (h.includes(s)) nalezy.push(s);
console.log(hlaseni.join('\n'));
if (nalezy.length) { console.error('\nZASTAVENO — v ukázce zůstalo: ' + nalezy.join(', ')); process.exit(1); }
fs.writeFileSync(path.join(KOREN, 'ukazka.html'), h);
console.log('\nHOTOVO  ukazka.html  ' + (puvodni/1048576).toFixed(2) + ' MB → ' + (h.length/1048576).toFixed(2) + ' MB');
console.log('Kontrola: žádná adresa databáze, žádný klíč, žádné skutečné jméno.');
