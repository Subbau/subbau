#!/usr/bin/env node
// Veřejné zásady ochrany osobních údajů (App Store / Google Play vyžadují
// veřejnou adresu). Text se BERE PŘÍMO z appky (SOUHLAS_TEXT), ne opsaný
// znovu — jinak by se časem rozešel s tím, co lidé doopravdy odsouhlasí.
// Spouští se stejně jako ukázka: node zasady/generuj.mjs (volá ho i kontrola).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const D = path.dirname(fileURLToPath(import.meta.url));
const KOREN = path.join(D, '..');
const zdroj = fs.readFileSync(path.join(KOREN, 'subbau_final.html'), 'utf8');

function chyba(m) { console.error('❌ ' + m); process.exit(1); }

// Vyřízni přesně blok od SOUHLAS_VERZE po konec objektu SOUHLAS_TEXT —
// appka má mezi nimi jen komentáře a dvě konstanty, bez volání funkcí.
const zac = zdroj.indexOf("const SOUHLAS_VERZE = ");
if (zac < 0) chyba('nenašel jsem SOUHLAS_VERZE — appka se asi přejmenovala');
const konecZnacky = zdroj.indexOf("\n}\n", zdroj.indexOf('const SOUHLAS_TEXT = {', zac));
if (konecZnacky < 0) chyba('nenašel jsem konec SOUHLAS_TEXT');
const blok = zdroj.slice(zac, konecZnacky + 2);
if (!/const SOUHLAS_TEXT = \{/.test(blok)) chyba('vyříznutý blok neobsahuje SOUHLAS_TEXT — appka se asi změnila');

const sandbox = {};
try {
  vm.createContext(sandbox);
  vm.runInContext(blok + '\nthis.__ven = { SOUHLAS_VERZE, SOUHLAS_VERZE_BEZ_OSVC, SOUHLAS_TEXT };', sandbox);
} catch (e) { chyba('text se nepodařilo vyhodnotit: ' + e.message); }
const { SOUHLAS_VERZE, SOUHLAS_TEXT } = sandbox.__ven;
if (!SOUHLAS_TEXT || !Array.isArray(SOUHLAS_TEXT.oddily) || !SOUHLAS_TEXT.oddily.length) chyba('SOUHLAS_TEXT vyšel prázdný');

const e = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const oddilyHtml = SOUHLAS_TEXT.oddily.map(([nadpis, odstavce]) => `
    <h2>${e(nadpis)}</h2>
    <ul>${odstavce.map(o => `<li>${e(o)}</li>`).join('')}</ul>`).join('\n');

const html = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zásady ochrany osobních údajů — SubBau s.r.o.</title>
<meta name="description" content="Jak SubBau s.r.o. zpracovává osobní údaje v aplikaci Docházka.">
<meta name="robots" content="index,follow">
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif; max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; color: #211D1A; line-height: 1.6; background: #faf7f2 }
  h1 { font-size: 26px; font-weight: 800; margin: 0 0 6px }
  .pod { color: #7a7168; font-size: 14px; margin: 0 0 32px }
  h2 { font-size: 18px; font-weight: 800; margin: 32px 0 10px; color: #9c3b22 }
  ul { margin: 0 0 4px; padding-left: 20px }
  li { margin: 6px 0 }
  a { color: #9c3b22 }
  .ramecek { background: #fff; border: 1px solid #e4dccf; border-radius: 12px; padding: 18px 22px; margin: 28px 0 }
  footer { margin-top: 48px; font-size: 12.5px; color: #8a7f72 }
</style>
</head>
<body>
  <h1>Zásady ochrany osobních údajů</h1>
  <p class="pod">SubBau s.r.o. · aplikace Docházka · verze textu ${e(SOUHLAS_VERZE)} · tuto stránku appka generuje ze stejného textu, který lidé v aplikaci odsouhlasí</p>
  <p>Aplikaci docházky provozuje SubBau s.r.o. Tahle stránka vysvětluje, jak s osobními údaji zacházíme — v appce samotné to každý potvrdí jedním zaškrtnutím při prvním přihlášení.</p>
  ${oddilyHtml}
  <div class="ramecek">
    <h2 style="margin-top:0">Smazání účtu</h2>
    <p>Kdo v aplikaci pracuje jako OSVČ nebo zaměstnanec přes SubBau s.r.o., může v appce v sekci Profil kdykoli zvolit „Požádat o smazání účtu“. Žádost se zapíše a SubBau s.r.o. ji vyřídí — účet i přiřazené údaje se natrvalo smažou, s výjimkou dokladů, které musíme ze zákona uchovávat (účetní a daňové doklady). Vyřízení žádosti netrvá déle než pár dnů. O smazání lze požádat i e-mailem na info@subbau.cz.</p>
  </div>
  <footer>Aktualizováno automaticky z aplikace. Dotazy k osobním údajům: <a href="mailto:info@subbau.cz">info@subbau.cz</a>.</footer>
</body>
</html>
`;

fs.writeFileSync(path.join(KOREN, 'zasady.html'), html);
console.log('✅ zasady.html hotové (verze textu ' + SOUHLAS_VERZE + ', ' + SOUHLAS_TEXT.oddily.length + ' oddílů)');
