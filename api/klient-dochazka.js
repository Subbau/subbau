// =====================================================================
// DOCHÁZKA PRO ODBĚRATELE — veřejný odkaz bez přihlášení
//
// PROČ SERVEROVÁ FUNKCE A NE PŘÍMÝ DOTAZ Z PROHLÍŽEČE:
// appka mluví s databází přímo a má v sobě veřejný klíč. Kdybychom klientovi
// poslali adresu appky, dostal by s ní i ten klíč. Tady je to obráceně:
// stránka klient.html žádný klíč nemá a ptá se jenom téhle funkce. Klíč
// (SUPABASE_SERVICE_ROLE_KEY) zná jen server na Vercelu.
//
// CO POUŠTÍ VEN: jméno, datum, příchod, pauza, odchod, hodiny, stavba,
// popis práce, sazbu a provizi (to si SubBau vyžádal sám, ať si odběratel
// překontroluje fakturu) a od 23. 9. 2026 TELEFON a údaj, jestli má člověk
// řidičák. Odběratel lidem volá přímo na stavbu a potřebuje vědět, koho
// smí poslat s dodávkou.
//
// OD 30. 9. 2026 I ADRESA UBYTOVÁNÍ (profiles.accommodation_address) —
// odběratel ubytování zajišťuje, takže ji vidí a smí ji i zapsat. Majitel:
// „na tom odkazu nebudou kódy ubytování — to budeme dávat my OSVČ a OSVČ to
// uvidí u sebe — ale na odkazu bude, kde mají ubytování."
//
// OD 1. 10. 2026 I FOTKA PRACOVNÍKA z appky (profiles.avatar_url, jen odkaz
// do našeho úložiště fotek). Majitel: „aby se ty fotky propsaly i do toho
// odkazu." Když si odběratel nahraje vlastní, na odkazu platí ta jeho.
//
// CO VEN NEJDE ANI TEĎ: KÓDY A POKYNY K UBYTOVÁNÍ (tabulka ubytovani_kody,
// dřív sloupec ubytovani_poznamka — ani jedno se tu nečte), e-maily, samotné
// doklady a jejich čísla, fotka řidičáku, adresa bydliště ani GPS souřadnice
// (attendance.location_lat/lng). Nejsou v dotazech do databáze, takže je
// funkce vůbec nemá.
//
// OBDOBÍ: jen aktuální týden. Týden si klient nevybírá, počítá ho server.
//
// OD 7. 10. 2026 PRACOVNÍ DOKLADY PRO STAVBYPLÁN — viz oddíl níž. Stránka
// klient.html je nikdy nedostane: jdou ven jen se zvláštní hlavičkou, kterou
// zná jen server stavbyplánu.
// =====================================================================

const crypto = require('crypto');
// Deník chyb (2. 11. 2026, majitel: „jakoukoliv chybu napříč aplikací to musí
// zaznamenat"). Odběratel vidí jen „nepodařilo se uložit" a kancelář by se
// o tom nedozvěděla — každá větev 5xx teď nechá řádek server|klient-dochazka
// (jen krok, stav a kód; nikdy token, jméno ani text poznámky).
// Očekávané odpovědi 4xx (špatný týden, cizí pracovník, neplatný odkaz) ne.
const { zapisChybuServeru, kodZTela, kodVyjimky, stavVyjimky } = require('./_denik.js');
const zapisChybuOdkazu = (krok, veta, stav, kod) =>
  zapisChybuServeru('klient-dochazka', veta, { krok, stav, kod: kod || undefined });

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';

// =====================================================================
// PRACOVNÍ DOKLADY PRO STAVBYPLÁN (od 7. 10. 2026)
//
// Odběratel používá stavbyplán, který si z tohohle odkazu bere lidi a
// docházku. Teď potřebuje i jejich PRACOVNÍ doklady, aby si je mohl
// zobrazit a stáhnout.
//
//   GET ?t=TOKEN&doklady=1                          → seznam dokladů
//   GET ?t=TOKEN&doklad=<id>&strana=predni|zadni    → podepsaná adresa na 5 minut
//
// PŘÍSTUP: jen s hlavičkou x-stavbyplan-klic, která se shoduje s proměnnou
// STAVBYPLAN_KLIC na Vercelu. Volá to SERVER stavbyplánu, ne prohlížeč —
// proto se nepřidává žádné CORS. Bez parametrů doklady/doklad se odkaz chová
// přesně jako dřív, ať hlavička je, nebo není. Když proměnná na Vercelu
// chybí, doklady nedostane nikdo.
//
// JEN PRACOVNÍ DOKLADY: živnosťák, A1, žádost o A1, Freistellung, řidičák.
// NIKDY občanka, pas, povolení k pobytu, vízum ani „jiný dokument". Zamítnuté
// (rejected i starší unreadable — appka je bere stejně) se vynechávají.
// Jen lidé z part odkazu, bez těch, kdo jsou mimo výkaz — tentýž výběr jako
// u docházky níž. Čísla dokladů ani adresy souborů v seznamu nejsou.
//
// KAŽDÝ SOUBOR MÁ V DATABÁZI SVŮJ ŘÁDEK. Appka ukládá zadní stranu (a další
// listy A1 od správce) jako samostatný řádek dokladu, sloupec „zadní strana"
// v tabulce documents není. Proto má každý doklad v seznamu nejvýš jednu
// stranu: list 1 (nebo neoznačený) je „predni", list 2 a další „zadni".
//
// CHYBA = CHYBA. Když se nepovede přečíst, kdo do odkazu patří nebo kdo je
// mimo výkaz, doklady skončí 500 chyba_serveru — nikdy „ok" s prázdným nebo
// neúplným seznamem (docházka si svou dřívější shovívavost nechává).
// Stavbyplán nemá doklady mazat jen proto, že v odpovědi chybí.
// =====================================================================

// Druh v databázi → druh, který jde ven. `gewerbeschein` je starý název
// živnosťáku z dřívějších nahrání (appka ho tak pořád zobrazuje, viz
// DOC_LABELS v subbau_final.html), ven jde jako „zivnost".
const DRUHY_DOKLADU = new Map([
  ['zivnost', 'zivnost'], ['gewerbeschein', 'zivnost'],
  ['a1', 'a1'], ['a1_zadost', 'a1_zadost'],
  ['freistellung', 'freistellung'], ['ridicak', 'ridicak'],
]);
// Německé názvy do názvu souboru — stejné jako DOC_LABELS_DE v appce.
const NAZVY_DOKLADU_DE = {
  zivnost: 'Gewerbeschein', a1: 'A1-Bescheinigung', a1_zadost: 'A1-Antrag',
  freistellung: 'Freistellungsbescheinigung', ridicak: 'Fuehrerschein',
};
const PLATNOST_ADRESY_S = 5 * 60;
const SLOUPCE_DOKLADU = 'id,worker_id,doc_type,status,valid_until,file_name,file_path,file_url';
// Id dokladu: uuid, případně celé číslo. Nic jiného do dotazu nejde.
const TVAR_ID_DOKLADU = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,18})$/i;

// Hlavička od stavbyplánu. Porovnává se v KONSTANTNÍM ČASE: obě strany se
// nejdřív zahashují na stejnou délku, takže z doby odpovědi nejde vyčíst
// ani shodu začátku, ani délku klíče. Bílé znaky okolo se ořezávají —
// proměnná na Vercelu umí mít na konci nový řádek.
function klicStavbyplanuSedi(hlavicka) {
  const cekany = String(process.env.STAVBYPLAN_KLIC || '').trim();
  if (!cekany) return false;                       // bez nastaveného klíče nikdo
  const dany = String(hlavicka == null ? '' : hlavicka).trim();
  const a = crypto.createHash('sha256').update(dany, 'utf8').digest();
  const b = crypto.createHash('sha256').update(cekany, 'utf8').digest();
  return crypto.timingSafeEqual(a, b) && dany.length > 0;
}

function druhDokladu(d) {
  return (d && DRUHY_DOKLADU.get(String(d.doc_type || ''))) || null;
}
function dokladZamitnuty(d) {
  return d.status === 'rejected' || d.status === 'unreadable';
}
// Strana podle značky, kterou appka dává do názvu: pracovník nahrává
// „a1_strana2_2026-10-01.pdf" (cesta „…_strana2.pdf"), správce „scan.pdf (strana 2)".
function stranaDokladu(d) {
  const n = String(d.file_name || ''), c = String(d.file_path || '');
  const m = n.match(/_strana(\d+)_/) || n.match(/\(strana (\d+)\)\s*$/) || c.match(/_strana(\d+)\.[a-z0-9]+$/i);
  return m && parseInt(m[1], 10) >= 2 ? 'zadni' : 'predni';
}
// Cesta k souboru v úložišti `documents`, jak ji má řádek zapsanou. Bere se
// file_path, a když tam je celá adresa (starší řádky), vyčte se z ní —
// stejně jako při mazání v appce. Nic nekontroluje, jen vyčte.
function cestaVKosi(d) {
  let c = String(d.file_path || '').trim();
  if (!c || /^https?:/i.test(c)) {
    const u = (/^https?:/i.test(c) ? c : String(d.file_url || '').trim()).split('?')[0];
    const pred = SUPABASE_URL + '/storage/v1/object/public/documents/';
    if (!u.startsWith(pred)) return '';
    try { c = decodeURIComponent(u.slice(pred.length)); } catch (e) { return ''; }
  }
  return c;
}
// Jak appka doklady do úložiště pojmenovává (subbau_final.html):
//   pracovník: <druh>_<Date.now()>.<přípona>, zadní strana <druh>_<Date.now()>_strana2.pdf
//   správce:   <Date.now()>_<bezpečné jméno souboru>   (listy 2–5: Date.now()+N)
// U pracovníka musí být <druh> PRACOVNÍ — soubor „op_…", „pas_…", „other_…"
// ani faktura „faktura_…"/„zaloha_…" (leží ve stejné složce) tudy neprojde,
// ani když si pracovník k němu sám založí řádek „a1".
const NAHRANO_PRACOVNIKEM = /^(?:zivnost|gewerbeschein|a1|a1_zadost|freistellung|ridicak)_\d{10,16}(?:_strana\d{1,2})?\.[a-z0-9]{1,5}$/i;
const NAHRANO_SPRAVCEM = /^\d{10,16}_[a-z0-9._-]{1,200}$/i;
// Cesta k souboru PRACOVNÍHO dokladu, nebo '' když soubor ven nesmí.
// Soubor MUSÍ ležet ve složce toho člověka: řádek si pracovník zakládá sám,
// a bez téhle kontroly by si do něj mohl zapsat cestu k cizímu souboru.
// A jméno souboru musí vypadat jako nahraný pracovní doklad (viz výš) —
// jinak by si mohl zapsat cestu ke své faktuře nebo občance.
function cestaDokladu(d) {
  const c = cestaVKosi(d);
  const slozka = String(d.worker_id || '');
  if (!c || !slozka || c.length > 500 || !c.startsWith(slozka + '/')) return '';
  if (/[\u0000-\u001f\u007f\\]/.test(c)) return '';
  const casti = c.split('/');
  if (casti.length !== 2 || casti.some(k => !k || k === '.' || k === '..')) return '';
  if (!NAHRANO_PRACOVNIKEM.test(casti[1]) && !NAHRANO_SPRAVCEM.test(casti[1])) return '';
  return c;
}
function platnostDokladu(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
const TYPY_SOUBORU = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
};
function priponaSouboru(cesta) {
  const m = String(cesta).match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : '';
}
// Stejně jako bezpecnyNazevSouboru v appce: bez háčků, jen písmena, číslice, podtržítko.
function bezpecnyNazevSouboru(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Fotka pracovníka jde na odkaz, jen když je to odkaz do NAŠEHO úložiště
// fotek (bucket avatars). Profil si pracovník upravuje sám, takže do
// avatar_url by si mohl dát cokoli — cizí adresa by odběrateli načetla
// obrázek odkudkoli.
function bezpecnaFotka(url) {
  const u = String(url || '').trim();
  if (!u || u.length > 400) return '';
  return u.startsWith(SUPABASE_URL + '/storage/v1/object/public/avatars/') && !/["'<>\s\\]/.test(u) ? u : '';
}

// Tvar tokenu — 64 hex znaků. Kontrola je tu proto, aby se do dotazu na
// databázi nedostalo nic jiného než to, co jsme sami vyrobili.
const TVAR_TOKENU = /^[0-9a-f]{64}$/;

// Směna a zaokrouhlování — MUSÍ souhlasit s appkou (applyAttendanceRules
// v subbau_final.html). Kdyby se to rozešlo, klient by viděl jiná čísla,
// než jsou na faktuře, kterou od SubBau dostane.
// zacatekPauzy = SHIFT.breakStart v appce (11:00).
const SMENA = { start: 7 * 60, zacatekPauzy: 11 * 60, delkaPauzy: 30 };
// 10 minut po celé hodině dolů platí už jen pro dny před 4. 11. 2026 —
// od toho dne (majitel 3. 11.) příchod VŽDY nahoru na celou nebo půl hodinu.
// Stejně jako hajenaDobaPrichodu v appce.
const HAJENA_DOBA_MIN = 10;
const PRICHOD_BEZ_HAJENE_DOBY_OD = '2026-11-04';
function hajenaDobaPrichodu(z) {
  const den = String((z && z.work_date) || '').slice(0, 10);
  return (den && den < PRICHOD_BEZ_HAJENE_DOBY_OD) ? HAJENA_DOBA_MIN : 0;
}

// ---------------------------------------------------------------------
// CO KLIENT VIDÍ A KDY — dva přepínače na jednom místě
// ---------------------------------------------------------------------
// Den se klientovi ukáže až takhle dlouho po odchodu. Nemá koukat naživo,
// kdo je zrovna na stavbě; navíc je tím čas, kdy si SubBau může zápis
// v klidu opravit dřív, než ho odběratel uvidí.
const PRODLEVA_PO_ODCHODU_MIN = 20;

// Co si smí odběratel u člověka uložit. Zapisuje sem někdo, kdo se nepřihlásil —
// jen s odkazem — takže na velikost i tvar musí být server přísný.
const MAX_FOTKA = 250 * 1024;    // znaků data URI ≈ 180 kB obrázku
const MAX_POZNAMKA = 1000;
const MAX_UBYTOVANI = 300;       // adresa ubytování — jeden řádek textu
// Den, u kterého ještě neuplynulo zdržení, se z přehledu nevyhazuje —
// klient u něj vidí jméno a adresu stavby, ale místo časů a hodin nápis
// „Stundenerfassung läuft". Ví tedy, kdo mu na stavbě je, ale hodiny uvidí,
// až budou hotové a SubBau je stihne případně opravit.

// VTEŘINY SE NEPOČÍTAJÍ — stejně jako v appce (timeToMin). Mobil ukládá příchod
// i s vteřinami a 07:10:30 by tu vyšlo jako „po hájené době" a zaokrouhlilo se na
// 07:30, zatímco appka (a faktura) počítá 07:00 (audit 30. 9. 2026).
function naMinuty(t) {
  if (!t) return null;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
function naCas(m) {
  if (m == null) return null;
  const c = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
}

// Zaokrouhlení jednoho dne — stejná pravidla jako v appce:
// příchod nahoru na nejbližší celou nebo půl hodinu (u dnů před 4. 11. 2026
// ještě do 10 minut po celé hodině dolů na celou).
// Odchod vždycky dolů na půlhodinu. Pauza kratší než 30 minut se počítá jako 30.
function upravDen(z, nyni) {
  const ci = naMinuty(z.check_in);
  let co = naMinuty(z.check_out);
  if (ci == null) return null;

  // Směna, která ještě běží. Ukazuje se jen dnešní — u starých dnů znamená
  // chybějící odchod zapomenutý zápis, ne práci, a appka je taky přeskakuje.
  const bezi = co == null;
  if (bezi) {
    if (!nyni || z.work_date !== nyni.den) return null;
    co = nyni.minuty;
    if (co < ci) return null;    // ještě nezačala (nemělo by nastat)
  }

  const poCele = ci % 60;
  const adjCi = poCele <= hajenaDobaPrichodu(z) ? ci - poCele : Math.ceil(ci / 30) * 30;

  // U běžící směny se čas NEZAOKROUHLUJE dolů na půlhodinu — jinak by první
  // půlhodinu po příchodu svítila nula a klient by si myslel, že nikdo nedělá.
  let adjCo = bezi ? co : Math.floor(co / 30) * 30;
  const presPulnoc = !bezi && co < ci;
  if (presPulnoc) adjCo += 24 * 60;
  if (adjCo < adjCi) adjCo = adjCi;

  // Všechny pauzy dne. `breaks` je novější tvar, break_start/2 starší —
  // bereme obojí, ať staré záznamy nevypadnou.
  const pauzy = [];
  // Prázdné pole = pauzy jsou jen ve starších sloupcích (appka to bere stejně).
  if (Array.isArray(z.breaks) && z.breaks.length) {
    for (const b of z.breaks) if (b && b.bs) pauzy.push({ bs: b.bs, be: b.be });
  } else {
    if (z.break_start) pauzy.push({ bs: z.break_start, be: z.break_end });
    if (z.break2_start) pauzy.push({ bs: z.break2_start, be: z.break2_end });
  }
  let pauzaMin = 0;
  const kPrehledu = [];
  // Délka pauzy se počítá PŘESNĚ jako attBreakMinutes v appce (audit 3. 11. 2026, D5)
  // — kdo by to měnil, ať změní obojí. Bez uložených hodin (total_hours) by se jinak
  // odběrateli ukázaly jiné hodiny, než jsou ve výkazu.
  for (const p of pauzy) {
    const zacSurovy = naMinuty(p.bs);
    const kon = naMinuty(p.be);
    if (zacSurovy == null || kon == null) continue;
    // Pauza začínající 1–2 minuty před 11:00 se počítá od 11:00.
    const posunuty = (zacSurovy < SMENA.zacatekPauzy && SMENA.zacatekPauzy - zacSurovy <= 2)
      ? SMENA.zacatekPauzy : zacSurovy;
    // Posun na 11:00 nesmí přeskočit konec pauzy (10:58–10:59): jinak by vyšla
    // záporná, přičetl by se den a odečetlo by se 1439 minut. Konec mezi skutečným
    // začátkem a 11:00 = počítá se od skutečného začátku. Noční pauza (23:50–0:20)
    // má konec před skutečným začátkem, takže se jí to netýká.
    const zac = (kon <= posunuty && kon >= zacSurovy) ? zacSurovy : posunuty;
    // Pauza přes půlnoc: konec je v minutách dne menší než začátek, ale uplynula
    // kladná doba — záporná délka se NEpřeskakuje, přičte se den.
    const surova = kon - zac;
    const delka = surova < 0 ? surova + 24 * 60 : surova;
    if (delka <= 0) continue;
    const zapocteno = delka < SMENA.delkaPauzy ? SMENA.delkaPauzy : delka;
    pauzaMin += zapocteno;
    kPrehledu.push({ od: naCas(zac), do: naCas(zac + zapocteno) });
  }

  // Hodiny bereme ULOŽENÉ, ne přepočítané — je to přesně to číslo, které je
  // na výkazu i na faktuře, včetně ručních oprav od SubBau. Dopočítáme jen
  // tehdy, když v databázi chybí.
  const hodiny = (!bezi && z.total_hours != null && !isNaN(z.total_hours))
    ? Number(z.total_hours)
    : Math.round(Math.max(0, adjCo - adjCi - pauzaMin) * 100 / 60) / 100;

  return { prichod: naCas(adjCi), odchod: bezi ? null : naCas(adjCo % 1440),
           pauzy: kPrehledu, hodiny, bezi };
}

// Uplynulo od odchodu dost času, aby se den směl ukázat klientovi?
// Konec směny se skládá z data a času odchodu; u směny přes půlnoc leží
// odchod až v následujícím dni, proto se přičítá 24 hodin.
function uzSeSmiUkazat(z, nyni) {
  const ci = naMinuty(z.check_in);
  const co = naMinuty(z.check_out);
  if (co == null) return false;                   // ještě neskončil
  if (!nyni) return true;
  let konec = co;
  if (ci != null && co < ci) konec += 24 * 60;
  const dnu = Math.round(
    (Date.parse(nyni.den + 'T00:00:00Z') - Date.parse(String(z.work_date).slice(0, 10) + 'T00:00:00Z'))
    / 86400000);
  if (!Number.isFinite(dnu)) return true;         // nečitelné datum radši ukážeme
  const odKonce = dnu * 24 * 60 + nyni.minuty - konec;
  return odKonce >= PRODLEVA_PO_ODCHODU_MIN;
}

// Adresa stavby pro klienta. Pořadí jako v appce: ručně zapsaná stavba,
// jinak adresa zapsaná při příchodu. Značky ✍️ / 📍, kterými správce v appce
// rozlišuje ruční zápis od GPS, se sem záměrně nedávají — a kdyby se emoji
// dostalo přímo do textu, useknem ho, ať klient nepozná, odkud adresa je.
function adresaStavby(z) {
  const cs = String(z.construction_site || '').trim();
  const adr = cs || String(z.location_address || '').trim();
  if (!adr) return null;
  return adr.replace(/^[\u200d\u2600-\u27bf\ufe0f\u{1f300}-\u{1faff}\s]+/u, '').trim() || null;
}

// Dnešek a čas podle ČESKÉHO času, ne podle času serveru. Server běží v UTC —
// v neděli po 22:00 by mu už bylo pondělí a klient by uviděl prázdný nový týden,
// zatímco na stavbě je pořád neděle.
function ted() {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const t = f.format(new Date());              // „2026-09-03 21:45"
  return { den: t.slice(0, 10), minuty: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)) };
}

// ISO týden (KW) — stejné počítání jako v appce.
function tydenKDatu(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const den = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - den);
  const zacRoku = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const kw = Math.ceil((((t - zacRoku) / 86400000) + 1) / 7);
  return { kw, rok: t.getUTCFullYear() };
}
// Pondělí ISO týdne podle jeho čísla a roku. Potřeba, aby si odběratel mohl
// listovat zpátky — ne jen koukat na probíhající týden.
function pondeliTydne(kw, rok) {
  // 4. leden leží vždycky v prvním ISO týdnu roku.
  const ctvrty = new Date(Date.UTC(rok, 0, 4));
  const den = ctvrty.getUTCDay() || 7;
  const pondeliPrvniho = new Date(ctvrty);
  pondeliPrvniho.setUTCDate(pondeliPrvniho.getUTCDate() - (den - 1));
  const p = new Date(pondeliPrvniho);
  p.setUTCDate(p.getUTCDate() + (kw - 1) * 7);
  return p;
}

// Pondělí a neděle týdne, ve kterém dnešek leží.
function tydenOdDo(dnes) {
  const den = dnes.getUTCDay() || 7;
  const po = new Date(dnes);
  po.setUTCDate(po.getUTCDate() - (den - 1));
  const ne = new Date(po);
  ne.setUTCDate(ne.getUTCDate() + 6);
  const iso = d => d.toISOString().slice(0, 10);
  return { od: iso(po), do: iso(ne) };
}

// Jediné povolené barvy poznámky. Co tu není, se uloží jako „bez barvy".
const BARVY_POZNAMKY = ['cervena', 'oranzova', 'zelena', 'modra', 'cerna'];

const OKNO_ODKAZU = new Map();
function okenniPocet(id) {
  const ted = Date.now();
  let z = OKNO_ODKAZU.get(id);
  if (!z || ted - z.od > 3600000) {
    if (OKNO_ODKAZU.size > 2000) OKNO_ODKAZU.clear();
    z = { od: ted, n: 0 };
    OKNO_ODKAZU.set(id, z);
  }
  return ++z.n;
}

async function db(cesta, klic) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${cesta}`, {
    headers: { apikey: klic, Authorization: `Bearer ${klic}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const telo = await r.text().catch(() => '');
    // Podrobnosti jen do logu na Vercelu. Ven půjde jen číslo a kód chyby,
    // ať se z odpovědi nedá vyčíst, jak je databáze postavená.
    console.error('[klient-dochazka] Supabase', r.status, telo.slice(0, 300));
    const e = new Error('db ' + r.status);
    e.stav = r.status;
    try { e.kod = JSON.parse(telo).code } catch (x) { e.kod = null }
    throw e;
  }
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

// Všechny řádky, po stránkách. Supabase vrací nejvýš „max-rows" řádků
// (výchozí 1000) a zbytek POTICHU zahodí. U dokladů by to znamenalo, že
// nejstarší doklady ze seznamu zmizí bez jediné chyby. Čte se proto, dokud
// nepřijde prázdná stránka — funguje to při jakémkoli stropu. `cesta` musí
// mít jednoznačné řazení (order …,id), jinak by se stránky mohly překrývat.
const STRANKA_DB = 1000;
//
// VÝKON (12. 11. 2026): první stránka sama (malý výpis = jeden dotaz jako dřív), a když
// je plná, další stránky se čtou po vlnách VLNA_DB naráz — ne jedna po druhé. Seznam
// týdnů při prvním otevření čte docházku od roku 2000 (u 200 lidí přes 50 000 řádků):
// po jedné stránce to bylo 50 obrátek za sebou a strop 50 stránek ho přitom usekl
// chybou. Stránky se skládají ve stejném pořadí; strop je 300 stránek (300 000 řádků).
const VLNA_DB = 6;
const MAX_STRANEK_DB = 300;
async function dbVsechno(cesta, klic) {
  const vse = [];
  const prvni = await db(`${cesta}&limit=${STRANKA_DB}&offset=0`, klic);
  if (!prvni || !prvni.length) return vse;
  for (const r of prvni) vse.push(r);
  if (prvni.length < STRANKA_DB) return vse;
  for (let strana = 1; strana < MAX_STRANEK_DB; strana += VLNA_DB) {
    const pocet = Math.min(VLNA_DB, MAX_STRANEK_DB - strana);
    const davka = await Promise.all(Array.from({ length: pocet }, (_, i) =>
      db(`${cesta}&limit=${STRANKA_DB}&offset=${(strana + i) * STRANKA_DB}`, klic)));
    for (const kus of davka) {
      if (!kus || !kus.length) return vse;
      for (const r of kus) vse.push(r);
      if (kus.length < STRANKA_DB) return vse;
    }
  }
  throw new Error('příliš mnoho řádků: ' + cesta.split('?')[0]);
}

// Seznam id do `in.(…)` po kusech. 200 uuid v jedné adrese je přes 7 kB a brány před
// databází mají strop na délku adresy kolem 8 kB — odkaz s plnou firmou by spadl na 414.
// `cteni(seznamVKusu)` vrací pole řádků jednoho kusu; kusy jdou souběžně a skládají se za
// sebou. `razeni` (volitelné) srovná složený výsledek zpátky do pořadí jednoho dotazu.
const KUS_ID = 100;
async function podleId(ids, cteni, razeni) {
  const seznam = Array.from(ids || []);
  if (seznam.length <= KUS_ID) return cteni(seznam.map(encodeURIComponent).join(','));
  const kusy = [];
  for (let i = 0; i < seznam.length; i += KUS_ID) kusy.push(seznam.slice(i, i + KUS_ID));
  const vysledky = await Promise.all(kusy.map(k => cteni(k.map(encodeURIComponent).join(','))));
  const vse = [];
  for (const v of vysledky) for (const r of (v || [])) vse.push(r);
  return razeni ? vse.sort(razeni) : vse;
}

module.exports = async (req, res) => {
  // Odpověď se nesmí nikde uložit do mezipaměti. Kdyby se uložila, klient by
  // po zneplatnění odkazu koukal na data dál z paměti prohlížeče.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, chyba: 'metoda' }); return;
  }

  const klic = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!klic) {
    console.error('[klient] chybí SUPABASE_SERVICE_ROLE_KEY');
    res.status(503).json({ ok: false, chyba: 'nedostupne' });
    return;
  }

  const token = String((req.query && req.query.t) || '');
  if (!TVAR_TOKENU.test(token)) { res.status(404).json({ ok: false, chyba: 'neplatny' }); return; }

  // Doklady pro stavbyplán (oddíl nahoře). Klíč se kontroluje dřív, než se
  // sáhne do databáze; neplatný odkaz s dobrým klíčem pak dopadne stejně
  // jako dnes (404 neplatny). Jen čtení — POST na tohle nereaguje.
  const dotaz = req.query || {};
  const chceSoubor = req.method === 'GET' && dotaz.doklad != null && String(dotaz.doklad) !== '';
  const rezimDokladu = chceSoubor || (req.method === 'GET' && String(dotaz.doklady || '') === '1');
  if (rezimDokladu && !klicStavbyplanuSedi(req.headers && req.headers['x-stavbyplan-klic'])) {
    res.status(403).json({ ok: false, chyba: 'bez_klice' }); return;
  }

  try {
    const odkazy = await db(
      `client_links?select=id,nazev,aktivni,plati_do,pocet_navstev&token=eq.${token}&limit=1`, klic);
    const odkaz = odkazy && odkazy[0];

    // Neexistuje, vypnutý i prošlý — navenek úplně stejná odpověď. Ať se
    // z ní nedá poznat, jestli takový odkaz vůbec kdy existoval.
    const dnesIso = ted().den;
    if (!odkaz || !odkaz.aktivni || (odkaz.plati_do && odkaz.plati_do < dnesIso)) {
      res.status(404).json({ ok: false, chyba: 'neplatny' });
      return;
    }

    // Brzda proti pumpování dat: počítáme podle ODKAZU, ne podle IP adresy —
    // tu si útočník v hlavičce napíše jakou chce, takže by to nic nedrželo.
    // Brzda je v časovém okně (hodina, po instanci funkce), ne podle celoživotního počtu
    // návštěv — ten po dosažení hranice zablokoval platný odkaz napořád.
    if (okenniPocet(odkaz.id) > 10000) {
      res.status(429).json({ ok: false, chyba: 'prilis_mnoho' });
      return;
    }

    // ---------------------------------------------------------------
    // ČTENÍ (GET): DOTAZY SOUBĚŽNĚ, NE ZA SEBOU (1. 10. 2026)
    //
    // Majitel: „otevření odkazu trvá asi 8 s, přepnutí týdne asi 10 s."
    // Funkce běží na Vercelu ve Washingtonu (iad1), databáze v Irsku
    // (eu-west-1) — každý dotaz je cesta přes Atlantik a zpátky, kolem
    // 0,1 s. Do teď se čekalo na 10–11 dotazů postupně, i když většina
    // z nich výsledek toho předchozího vůbec nepotřebuje.
    //
    // Teď se ptá v pěti kolech (v šestém, jen když chybí sazba šéfa firmy):
    //   1. odkaz podle tokenu — musí být první, bez platného odkazu nic
    //   2. party odkazu + kdo je mimo výkaz + poznámky + odškrtnutý týden
    //   3. lidé v partách + docházka s partou (+ seznam týdnů s partou)
    //   4. stará docházka bez party (+ seznam týdnů bez party)
    //   5. jména, sazby, doklady, provize, historie, ubytování, fotky, dovolené
    //   6. sazba, provize a historie šéfů firem
    // Dotazy jsou TYTÉŽ jako dřív (stejné tabulky, sloupce i filtry), jen
    // odcházejí dřív. Ven jde totéž.
    //
    // KAŽDÝ DŘÍV PUŠTĚNÝ DOTAZ JE OBALENÝ (`potom`). Slib, který se odmítne
    // dřív, než na něj kód dojde, by Node jinak vzal jako neošetřenou chybu
    // a shodil celou funkci. `vybal` chybu vyhodí až tam, kde ji kód čekal
    // dřív — co dřív končilo chybou 500, končí jí i teď, a co se dřív
    // potichu přeskočilo, přeskočí se i teď.
    // ---------------------------------------------------------------
    const potom = (slib) => slib.then(v => ({ v }), e => ({ e }));
    const vybal = (x) => { if (x.e) throw x.e; return x.v; };

    // Co si odběratel u lidí poznamenal — fotka, poznámka, známka. Nezávisí
    // na partách ani na týdnu, proto se na to ptá hned ve druhém kole.
    // Chybu nikdy nevyhodí: při potížích vrátí prázdno, stejně jako dřív.
    const nactiPoznamky = async () => {
      const poznamky = {};
      try {
        // Migrace mohla proběhnout jen zčásti — například ukončená spolupráce už
        // v databázi je, ale barva poznámky ještě ne. Proto se zkouší postupně
        // od nejúplnějšího dotazu k nejchudšímu. Dřív to bylo všechno-nebo-nic
        // a chybějící barva zahodila i ukončenou spolupráci, kterou databáze měla.
        const ZAKLAD = 'worker_id,foto,poznamka,hodnoceni';
        const varianty = [
          ZAKLAD + ',spoluprace_ukoncena,spoluprace_do,pozn_tucne,pozn_barva',
          ZAKLAD + ',spoluprace_ukoncena,spoluprace_do',
          ZAKLAD + ',pozn_tucne,pozn_barva',
          ZAKLAD,
        ];
        let pz = null, posledniChyba = null;
        for (const sloupce of varianty) {
          try {
            pz = await db(`client_link_workers?select=${sloupce}&link_id=eq.${odkaz.id}`, klic);
            break;
          } catch (e) {
            // POZOR: db() hlásí jen „db 400", podrobnosti jsou v e.kod.
            // Zkoušet dál smí jen u chybějícího sloupce, ne při výpadku sítě.
            if (e.kod !== '42703' && e.stav !== 400) throw e;
            posledniChyba = e;
          }
        }
        if (pz === null) throw posledniChyba;
        for (const p of (pz || [])) {
          poznamky[p.worker_id] = { foto: p.foto || null, poznamka: p.poznamka || '',
                                    hodnoceni: p.hodnoceni || null,
                                    spoluprace_ukoncena: !!p.spoluprace_ukoncena,
                                    spoluprace_do: p.spoluprace_do || '',
                                    pozn_tucne: !!p.pozn_tucne,
                                    pozn_barva: BARVY_POZNAMKY.includes(p.pozn_barva) ? p.pozn_barva : '' };
        }
      } catch (e) { console.warn('[klient] poznámky se nenačetly:', e.message); }
      return poznamky;
    };

    const cteni = req.method === 'GET';
    let nyni = null, kw = 0, rok = 0, od = '', doDne = '', prvniOtevreni = false;
    let slibMimo = null, slibPoznamky = null, slibUhrazeno = null;
    if (cteni) {
      nyni = ted();
      const dnes = new Date(nyni.den + 'T12:00:00Z');   // poledne, ať posun pásma nikdy nepřehodí den
      const tedTyden = tydenKDatu(dnes);

      // Odběratel si smí listovat zpátky. Čísla bereme z adresy, ale jen jako
      // celá čísla v rozumném rozsahu — do dotazu do databáze nesmí jít nic jiného.
      kw = tedTyden.kw; rok = tedTyden.rok;
      const zadanyKw = parseInt(String((req.query && req.query.kw) || ''), 10);
      const zadanyRok = parseInt(String((req.query && req.query.rok) || ''), 10);
      if (Number.isInteger(zadanyKw) && zadanyKw >= 1 && zadanyKw <= 53 &&
          Number.isInteger(zadanyRok) && zadanyRok >= 2020 && zadanyRok <= 2100) {
        // Do budoucna se listovat nedá — nemá to co ukázat.
        if (zadanyRok < tedTyden.rok || (zadanyRok === tedTyden.rok && zadanyKw <= tedTyden.kw)) {
          kw = zadanyKw; rok = zadanyRok;
        }
      }
      const po = pondeliTydne(kw, rok);
      const ne = new Date(po); ne.setUTCDate(ne.getUTCDate() + 6);
      const iso = d => d.toISOString().slice(0, 10);
      od = iso(po); doDne = iso(ne);

      // Počítadlo otevření — viz zápis návštěvy níž.
      prvniOtevreni = String((req.query && req.query.prvni) || '') === '1';

      // Druhé kolo: nic z toho nepotřebuje znát party.
      slibMimo = potom(db(`profiles?select=id&ve_vykazu=is.false`, klic));
      // Doklady nepotřebují poznámky ani stav týdne.
      if (!rezimDokladu) {
        slibPoznamky = nactiPoznamky();
        slibUhrazeno = potom(db(
          `client_link_weeks?select=uhrazeno&link_id=eq.${odkaz.id}` +
          `&kw=eq.${kw}&rok=eq.${rok}&limit=1`, klic));
      }
    }

    const vazby = await db(
      `client_link_teams?select=team_id&link_id=eq.${odkaz.id}`, klic);
    const teamIds = (vazby || []).map(v => v.team_id).filter(Boolean);

    // ---------------------------------------------------------------
    // ZÁPIS POZNÁMKY (POST) — fotka, poznámka a známka u pracovníka
    //
    // Tohle je jediné místo, kam smí zapsat někdo nepřihlášený. Proto se
    // kontroluje všechno: platnost odkazu (výš), tvar dat, velikost, a hlavně
    // že ten pracovník do vybraných skupin opravdu patří. Bez té poslední
    // kontroly by šlo přes cizí odkaz psát poznámky komukoli ve firmě.
    // ---------------------------------------------------------------
    if (req.method === 'POST') {
      const telo = (req.body && typeof req.body === 'object') ? req.body : {};

      // Odškrtnutí týdne jako uhrazeného. Je to jen přehled pro odběratele —
      // do plateb v Provizích to nesahá a nic v nich nepřepisuje.
      if ('uhrazeno' in telo) {
        const tKw = parseInt(String(telo.kw), 10);
        const tRok = parseInt(String(telo.rok), 10);
        if (!(Number.isInteger(tKw) && tKw >= 1 && tKw <= 53 &&
              Number.isInteger(tRok) && tRok >= 2020 && tRok <= 2100)) {
          res.status(400).json({ ok: false, chyba: 'spatny_tyden' }); return;
        }
        try {
          const r = await fetch(`${SUPABASE_URL}/rest/v1/client_link_weeks` +
                                `?on_conflict=link_id,kw,rok`, {
            method: 'POST',
            headers: { apikey: klic, Authorization: `Bearer ${klic}`,
                       'Content-Type': 'application/json',
                       Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ link_id: odkaz.id, kw: tKw, rok: tRok,
                                   uhrazeno: !!telo.uhrazeno,
                                   upraveno: new Date().toISOString() }),
          });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            console.error('[klient] odškrtnutí týdne:', r.status, t.slice(0, 300));
            await zapisChybuOdkazu('tyden', 'Odškrtnutí týdne odběratelem se neuložilo (HTTP ' + r.status + ')', r.status, kodZTela(t));
            res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
          }
        } catch (e) {
          console.error('[klient] odškrtnutí týdne:', e);
          await zapisChybuOdkazu('tyden', 'Odškrtnutí týdne odběratelem spadlo (' + kodVyjimky(e) + ')', stavVyjimky(e), kodVyjimky(e));
          res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
        }
        res.status(200).json({ ok: true }); return;
      }

      const workerId = String(telo.worker_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(workerId)) {
        res.status(400).json({ ok: false, chyba: 'spatny_pracovnik' }); return;
      }

      // Smí se psát jen k lidem, kteří v těch skupinách jsou — nebo v nich
      // pracovali (docházka se skupinou odkazu). Odkaz je ukazuje i po přesunu
      // jinam a právě po konci spolupráce potřebuje odběratel zaškrtnout
      // „ukončená spolupráce" (majitel 1. 11. 2026: „nemůžu dát v odkazu
      // Košaře, že jsme s ním ukončili spolupráci" — zápis spadl na cizi_pracovnik).
      let patriSem = false, pracovalTu = false;
      if (teamIds.length) {
        const skupiny = teamIds.map(encodeURIComponent).join(',');
        try {
          const p = await db(
            `profiles?select=id&id=eq.${encodeURIComponent(workerId)}` +
            `&team_id=in.(${skupiny})&limit=1`, klic);
          patriSem = !!(p && p.length);
        } catch (e) { console.error('[klient] kontrola pracovníka:', e); }
        if (!patriSem) {
          try {
            const a = await db(
              `attendance?select=id&worker_id=eq.${encodeURIComponent(workerId)}` +
              `&team_id=in.(${skupiny})&limit=1`, klic);
            pracovalTu = !!(a && a.length);
          } catch (e) { console.error('[klient] kontrola docházky pracovníka:', e); }
        }
      }
      if (!patriSem && !pracovalTu) { res.status(403).json({ ok: false, chyba: 'cizi_pracovnik' }); return; }

      // ADRESA UBYTOVÁNÍ — jde přímo do profilu pracovníka, ne k odkazu.
      // Tutéž adresu vidí SubBau v Pracovnících a pracovník u sebe v appce,
      // a co tam zapíše SubBau, uvidí odběratel tady. Kódy od ubytování sem
      // nechodí a tahle funkce je ani nečte.
      // Bývalému (v skupinách odkazu už není) profil měnit nesmí — ten už může
      // bydlet jinde a pracovat pro jiného odběratele.
      if ('ubytovani' in telo && !patriSem) { res.status(403).json({ ok: false, chyba: 'cizi_pracovnik' }); return; }
      if ('ubytovani' in telo) {
        const text = String(telo.ubytovani == null ? '' : telo.ubytovani)
          .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > MAX_UBYTOVANI) {
          res.status(413).json({ ok: false, chyba: 'adresa_prilis_dlouha' }); return;
        }
        // `select=id` — zpátky jen počet trefených řádků, nic z profilu.
        const zapis = (data) => fetch(`${SUPABASE_URL}/rest/v1/profiles` +
                                      `?id=eq.${encodeURIComponent(workerId)}&select=id`, {
          method: 'PATCH',
          headers: { apikey: klic, Authorization: `Bearer ${klic}`,
                     'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(data),
        });
        try {
          // Druhý, starší sloupec se srovná na prázdno — jinak by v appce
          // mohla zůstat viset stará adresa vedle nové.
          let r = await zapis({ accommodation_address: text || null, ubytovani_adresa: null });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            if (/ubytovani_adresa/.test(t) && /42703|PGRST204|does not exist|schema cache/i.test(t)) {
              r = await zapis({ accommodation_address: text || null });
            } else {
              console.error('[klient] zápis ubytování:', r.status, t.slice(0, 300));
              await zapisChybuOdkazu('ubytovani', 'Adresa ubytování z odkazu se neuložila (HTTP ' + r.status + ')', r.status, kodZTela(t));
              res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
            }
          }
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            console.error('[klient] zápis ubytování:', r.status, t.slice(0, 300));
            await zapisChybuOdkazu('ubytovani', 'Adresa ubytování z odkazu se neuložila (HTTP ' + r.status + ')', r.status, kodZTela(t));
            res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
          }
          // Zápis, který netrefí řádek, projde bez chyby — musí se to poznat.
          const trefeno = await r.json().catch(() => null);
          if (!Array.isArray(trefeno) || trefeno.length !== 1) {
            console.error('[klient] zápis ubytování: trefených řádků', trefeno && trefeno.length);
            await zapisChybuOdkazu('ubytovani', 'Adresa ubytování z odkazu netrefila řádek profilu (' + (Array.isArray(trefeno) ? trefeno.length : 'nic') + ')', r.status, 'zapis-nic');
            res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
          }
        } catch (e) {
          console.error('[klient] zápis ubytování:', e);
          await zapisChybuOdkazu('ubytovani', 'Zápis adresy ubytování z odkazu spadl (' + kodVyjimky(e) + ')', stavVyjimky(e), kodVyjimky(e));
          res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
        }
        res.status(200).json({ ok: true, ubytovani: text }); return;
      }

      const zmena = { link_id: odkaz.id, worker_id: workerId, upraveno: new Date().toISOString() };

      if ('foto' in telo) {
        const f = telo.foto == null ? null : String(telo.foto);
        if (f !== null) {
          if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(f)) {
            res.status(400).json({ ok: false, chyba: 'spatna_fotka' }); return;
          }
          if (f.length > MAX_FOTKA) {
            res.status(413).json({ ok: false, chyba: 'fotka_prilis_velka' }); return;
          }
        }
        zmena.foto = f;
      }
      if ('poznamka' in telo) {
        zmena.poznamka = String(telo.poznamka || '').slice(0, MAX_POZNAMKA) || null;
      }
      if ('hodnoceni' in telo) {
        const h = parseInt(String(telo.hodnoceni), 10);
        zmena.hodnoceni = (Number.isInteger(h) && h >= 1 && h <= 6) ? h : null;
      }
      // Ukončená spolupráce. Zaškrtnutí a datum jdou zvlášť — odběratel může
      // zaškrtnout hned a datum doplnit až potom, až si ho dohledá.
      // Zvýraznění poznámky. Ukládá se jen „tučně ano/ne" a NÁZEV barvy —
      // nikdy ne HTML ani kus stylu, ať se do stránky nedá nic propašovat.
      if ('pozn_tucne' in telo) {
        zmena.pozn_tucne = !!telo.pozn_tucne;
      }

      if ('pozn_barva' in telo) {
        const b = String(telo.pozn_barva || '').trim();
        zmena.pozn_barva = BARVY_POZNAMKY.includes(b) ? b : null;
      }
      if ('spoluprace_ukoncena' in telo) {
        zmena.spoluprace_ukoncena = !!telo.spoluprace_ukoncena;
      }
      if ('spoluprace_do' in telo) {
        const d = String(telo.spoluprace_do || '').trim();
        if (!d) {
          zmena.spoluprace_do = null;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) {
          zmena.spoluprace_do = d;
        } else {
          res.status(400).json({ ok: false, chyba: 'spatne_datum' }); return;
        }
      }

      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/client_link_workers` +
                              `?on_conflict=link_id,worker_id`, {
          method: 'POST',
          headers: { apikey: klic, Authorization: `Bearer ${klic}`,
                     'Content-Type': 'application/json',
                     Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(zmena),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          console.error('[klient] zápis poznámky:', r.status, t.slice(0, 300));
          // Chybějící sloupec = migrace ještě neproběhla. Ať to odběratel
          // pozná jako „tahle funkce ještě není připravená", ne jako závadu.
          const chybiSloupec = /42703|does not exist|schema cache/i.test(t);
          if (chybiSloupec) console.error('[klient] SPUSŤTE supabase-migrace-ukoncena-spoluprace.sql');
          await zapisChybuOdkazu('poznamka', chybiSloupec
            ? 'Poznámka z odkazu se neuložila — v databázi chybí sloupec (migrace?)'
            : 'Poznámka z odkazu se neuložila (HTTP ' + r.status + ')', r.status, kodZTela(t));
          res.status(chybiSloupec ? 503 : 500)
             .json({ ok: false, chyba: chybiSloupec ? 'funkce_neni_pripravena' : 'nelze_ulozit' });
          return;
        }
      } catch (e) {
        console.error('[klient] zápis poznámky:', e);
        await zapisChybuOdkazu('poznamka', 'Zápis poznámky z odkazu spadl (' + kodVyjimky(e) + ')', stavVyjimky(e), kodVyjimky(e));
        res.status(500).json({ ok: false, chyba: 'nelze_ulozit' }); return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    // Lidé, kteří do vybraných part patří. Potřeba kvůli starší docházce:
    // u záznamů z doby před zavedením part není parta zapsaná, takže by je
    // odkaz nikdy neukázal a odběrateli by chyběly starší týdny.
    //
    // Docházka se čte ve dvou kusech: dny s partou z vybraných skupin (k tomu
    // stačí znát party, proto se pouští HNED, souběžně s dotazem na lidi)
    // a staré dny BEZ party u lidí, kteří do těch skupin patří (ten musí počkat
    // na seznam lidí). Dny se zapsanou CIZÍ partou se nepřidávají — ty patří
    // jinému odběrateli. Seznam týdnů (`tydny`) se čte stejně a ve stejné chvíli.
    let lideVeSkupinach = [];
    // Adresa: nejdřív ručně zapsaná stavba, a když chybí, adresa z příchodu —
    // stejné pořadí, jaké má správce v appce (attDisplaySite). Bez té druhé
    // by u části dnů nebyla adresa žádná.
    // Ven jde jen TEXT adresy. Souřadnice (location_lat/lng) ani údaj o tom,
    // jestli ji člověk psal ručně nebo přišla z GPS (address_source), se
    // nečtou — klient tak nepozná rozdíl a ani ho poznat nemá.
    const SLOUPCE_DOCHAZKY =
      'id,worker_id,work_date,check_in,check_out,break_start,break_end,' +
      'break2_start,break2_end,breaks,total_hours,construction_site,location_address,work_description,' +
      // Výjimky u jednoho dne. Bez nich by se tady počítalo po staru a nikdo
      // by se to nedozvěděl — Supabase u chybějícího sloupce v tomhle dotazu
      // nevrátí chybu, jen by se sem nic nedoneslo.
      'bez_vyplaty,bez_provize_den,vyplata_castka';
    const SLOUPCE_TYDNU = 'kw,kw_year,worker_id,work_date';
    // `poradi` jen u seznamu týdnů: NEJNOVĚJŠÍ NAPŘED. Databáze vrací nejvýš
    // určitý počet řádků (v Supabase výchozí 1000) — se vzestupným pořadím by
    // při delší historii v přepínači chyběly právě nejnovější týdny (rozbor
    // výkonu 1. 10. 2026). Na pořadí v seznamu nezáleží, řadí se níž.
    // `&limit=5000` tu dřív nic neznamenalo — Supabase i tak vrátí nejvýš
    // „max-rows" (výchozí 1000) a zbytek potichu zahodí (stejná past jako
    // v appce u Kalendáře, audit 16. 10. 2026). `dbVsechno` dotahuje po
    // stránkách, dokud řádky nedojdou; `,id.asc` v řazení je nutný tiebreaker
    // — bez něj by se stránky u dnů se stejným work_date mohly překrývat
    // nebo přeskočit řádek.
    const sPartou = (sloupce, odDne, doDne2, poradi = 'asc') => potom(dbVsechno(`attendance?select=${sloupce}` +
      `&team_id=in.(${teamIds.map(encodeURIComponent).join(',')})` +
      `&work_date=gte.${odDne}&work_date=lte.${doDne2}&order=work_date.${poradi},id.asc`, klic));
    // Lidé po kusech (adresa s 200 uuid je přes 7 kB); složené zpátky do pořadí dotazu (datum, id).
    const bezParty = (sloupce, odDne, doDne2, poradi = 'asc') => potom(podleId(lideVeSkupinach,
      (seznam) => dbVsechno(`attendance?select=${sloupce}&team_id=is.null` +
        `&worker_id=in.(${seznam})` +
        `&work_date=gte.${odDne}&work_date=lte.${doDne2}&order=work_date.${poradi},id.asc`, klic),
      (a, b) => {
        const d = String(a.work_date).localeCompare(String(b.work_date));
        const o = poradi === 'desc' ? -d : d;
        return o || String(a.id == null ? '' : a.id).localeCompare(String(b.id == null ? '' : b.id));
      }));

    // Třetí kolo: docházka s partou (a týdny s partou) souběžně s lidmi.
    // (U dokladů se docházka nečte — viz rezimDokladu níž.)
    const dochSPartou = (teamIds.length && !rezimDokladu) ? sPartou(SLOUPCE_DOCHAZKY, od, doDne) : null;
    const tydnySPartou = (prvniOtevreni && teamIds.length && !rezimDokladu)
      ? sPartou(SLOUPCE_TYDNU, '2000-01-01', nyni.den, 'desc') : null;
    if (teamIds.length) {
      try {
        const p = await db(
          `profiles?select=id&team_id=in.(${teamIds.map(encodeURIComponent).join(',')})`, klic);
        lideVeSkupinach = (p || []).map(x => x.id).filter(Boolean);
      } catch (e) {
        // U dokladů NE potichu: prázdný seznam by stavbyplán vzal jako
        // „nikdo nemá doklady". Radši 500 (chyba_serveru). Docházka beze změny.
        if (rezimDokladu) throw e;
        console.warn('[klient] lidé ve skupinách:', e.message);
      }
    }

    const mimoVykaz = new Set();
    try {
      const v = vybal(await slibMimo);
      (v || []).forEach(x => { if (x.id) mimoVykaz.add(x.id); });
    } catch (e) {
      // Neověřený filtr = ven by mohli jít lidé vyřazení z výkazu (docházka, telefon…),
      // proto 500 v obou režimech. Výjimka: sloupec ve_vykazu ještě neexistuje (migrace
      // neproběhla) — pak nikdo vyřazený není.
      if (e.kod !== '42703') throw e;
      console.warn('[klient] ve_vykazu se nenačetlo (migrace?):', e.message);
    }
    if (mimoVykaz.size) {
      lideVeSkupinach = lideVeSkupinach.filter(id => !mimoVykaz.has(id));
    }

    // ---------------------------------------------------------------
    // DOKLADY PRO STAVBYPLÁN — lidé jsou TÍŽ jako u docházky výš (party
    // odkazu bez těch mimo výkaz). Klíč už je ověřený. Návštěva se
    // nezapisuje: tohle je stavbyplán, ne odběratel u stránky.
    // ---------------------------------------------------------------
    if (rezimDokladu) {
      const lideOdkazu = new Set(lideVeSkupinach);
      const seznamLidi = [...lideOdkazu].map(encodeURIComponent).join(',');
      const druhyVDotazu = [...DRUHY_DOKLADU.keys()].join(',');
      // Soubory, na které ukazuje NEPRACOVNÍ řádek (občanka, pas, jiný…)
      // těch lidí. Takový soubor nejde ven, ani když na něj ukazuje i řádek
      // „a1" — správce nahrává všechno jako <čas>_<jméno>, takže občanka
      // od správce má jméno stejného tvaru jako A1. Čtou se jen cesty.
      const zakazaneSoubory = async (lide) => {
        const radky = await podleId(String(lide).split(',').map(decodeURIComponent), (seznam) =>
          dbVsechno(`documents?select=file_path,file_url` +
            `&worker_id=in.(${seznam})&or=(doc_type.is.null,doc_type.not.in.(${druhyVDotazu}))` +
            `&order=id.asc`, klic));
        return new Set((radky || []).map(cestaVKosi).filter(Boolean));
      };

      if (!chceSoubor) {
        const doklady = {};
        if (lideOdkazu.size) {
          const [radkyD, zakazane] = await Promise.all([
            podleId([...lideOdkazu], (seznam) => dbVsechno(`documents?select=${SLOUPCE_DOKLADU}` +
              `&worker_id=in.(${seznam})&doc_type=in.(${druhyVDotazu})` +
              `&order=uploaded_at.desc,id.asc`, klic), (a, b) => {
              // pořadí jednoho dotazu: nahráno sestupně, pak id vzestupně
              const u = String(b.uploaded_at == null ? '' : b.uploaded_at).localeCompare(String(a.uploaded_at == null ? '' : a.uploaded_at));
              return u || String(a.id).localeCompare(String(b.id));
            }),
            zakazaneSoubory(seznamLidi),
          ]);
          const videne = new Set();   // řádek přidaný mezi stránkami se může zopakovat
          for (const d of (radkyD || [])) {
            // Databáze už filtrovala — tady to platí ještě jednou, ať jedna
            // chyba v dotazu nepustí ven občanku nebo cizího člověka.
            const druh = druhDokladu(d);
            if (!druh || dokladZamitnuty(d) || !lideOdkazu.has(d.worker_id)) continue;
            if (videne.has(String(d.id))) continue;
            videne.add(String(d.id));
            const cesta = cestaDokladu(d);
            (doklady[d.worker_id] = doklady[d.worker_id] || []).push({
              id: d.id, druh, platnost_do: platnostDokladu(d.valid_until),
              strany: (cesta && !zakazane.has(cesta)) ? [stranaDokladu(d)] : [],
            });
          }
        }
        res.status(200).json({ ok: true, doklady });
        return;
      }

      // Jeden soubor. Cokoli nesedí — cizí člověk, nepovolený druh,
      // zamítnutý doklad, strana bez souboru — je navenek totéž: 404.
      const nenalezen = () => res.status(404).json({ ok: false, chyba: 'doklad_nenalezen' });
      const idDokladu = String(dotaz.doklad);
      const strana = String(dotaz.strana || '');
      if (!TVAR_ID_DOKLADU.test(idDokladu) || (strana !== 'predni' && strana !== 'zadni') ||
          !lideOdkazu.size) { nenalezen(); return; }
      const nalez = await podleId([...lideOdkazu], (seznam) => db(`documents?select=${SLOUPCE_DOKLADU}` +
        `&id=eq.${encodeURIComponent(idDokladu)}` +
        `&worker_id=in.(${seznam})&doc_type=in.(${druhyVDotazu})&limit=1`, klic));
      const d = nalez && nalez[0];
      const druh = d && druhDokladu(d);
      const cesta = druh ? cestaDokladu(d) : '';
      if (!d || String(d.id).toLowerCase() !== idDokladu.toLowerCase() || !druh ||
          dokladZamitnuty(d) || !lideOdkazu.has(d.worker_id) || !cesta ||
          stranaDokladu(d) !== strana) { nenalezen(); return; }
      if ((await zakazaneSoubory(encodeURIComponent(d.worker_id))).has(cesta)) { nenalezen(); return; }

      // Podepsaná adresa na 5 minut. Soubor zůstává v SubBau, stavbyplán si
      // ho jen na chvíli vypůjčí.
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/` +
                            cesta.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST',
        headers: { apikey: klic, Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: PLATNOST_ADRESY_S }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('[klient] podpis dokladu:', r.status, t.slice(0, 300));
        // Řádek je, soubor v úložišti ne → pro stavbyplán „doklad není".
        if (r.status === 400 || r.status === 404) { nenalezen(); return; }
        throw new Error('podpis ' + r.status);
      }
      const podpis = await r.json().catch(() => null);
      const adresa = podpis && (podpis.signedURL || podpis.signedUrl);
      if (typeof adresa !== 'string' || !adresa.startsWith('/object/sign/documents/')) {
        throw new Error('podpis bez adresy');
      }

      let jmeno = '';
      try {
        const p = await db(`profiles?select=full_name&id=eq.${encodeURIComponent(d.worker_id)}&limit=1`, klic);
        jmeno = (p && p[0] && p[0].full_name) || '';
      } catch (e) { console.warn('[klient] jméno k dokladu:', e.message); }
      const pripona = priponaSouboru(cesta);
      const nazev = [NAZVY_DOKLADU_DE[druh], jmeno, strana === 'zadni' ? 'Rueckseite' : 'Vorderseite']
        .map(bezpecnyNazevSouboru).filter(Boolean).join('_') + (pripona ? '.' + pripona : '');

      res.status(200).json({ ok: true, url: SUPABASE_URL + '/storage/v1' + adresa,
                             typ: TYPY_SOUBORU[pripona] || 'application/octet-stream', nazev });
      return;
    }

    // Čtvrté kolo: stará docházka bez party (a týdny bez party).
    const dochBezParty = lideVeSkupinach.length ? bezParty(SLOUPCE_DOCHAZKY, od, doDne) : null;
    const tydnyBezParty = (prvniOtevreni && lideVeSkupinach.length)
      ? bezParty(SLOUPCE_TYDNU, '2000-01-01', nyni.den, 'desc') : null;

    // Složí oba kusy v pořadí „s partou, pak bez party" — jako dřív — a vyřadí
    // lidi mimo výkaz. Když kterýkoli kus selhal, chyba se vyhodí (dřív stejně
    // z Promise.all).
    const nactiDochazku = async (sKus, bezKus) => {
      const casti = (await Promise.all([sKus, bezKus].filter(Boolean))).map(vybal);
      const videno = new Set(), vse = [];
      for (const c of casti) for (const r of (c || [])) {
        if (r.worker_id && mimoVykaz.has(r.worker_id)) continue;
        const k = r.id || (r.worker_id + '|' + r.work_date + '|' + (r.check_in || ''));
        if (videno.has(k)) continue;
        videno.add(k); vse.push(r);
      }
      return vse;
    };

    let radky = [];
    // Telefon a řidičák u každého člověka. Sestavuje se uvnitř bloku níž,
    // ale deklaruje se TADY: odpověď se skládá až za ním a `let` uvnitř
    // bloku by z ní udělal nedefinovanou proměnnou.
    let lide = {};
    let slibDovolene = null;
    if (teamIds.length || lideVeSkupinach.length) {
      const dochazka = await nactiDochazku(dochSPartou, dochBezParty);

      const ids = [...new Set((dochazka || []).map(z => z.worker_id))];

      // KTERÉ DNY SE UKÁŽOU — rozhoduje se hned, ne až po jménech a sazbách.
      // Pravidla jsou tatáž jako dřív a nepotřebují nic z profilů. Díky tomu
      // je hned známo, kdo v přehledu bude, a dotaz na dovolené (jen pro ty
      // lidi) může odejít souběžně se jmény a sazbami, ne až po nich.
      const vybraneDny = [];
      for (const z of (dochazka || [])) {
        // Ještě neuplynulo zdržení po odchodu (nebo směna pořád běží):
        // klient uvidí, kdo a kde je, ale žádné časy ani hodiny.
        if (!uzSeSmiUkazat(z, nyni)) {
          const dnesniBezOdchodu = !z.check_out && String(z.work_date).slice(0, 10) === (nyni && nyni.den);
          // Starý den bez odchodu je zapomenutý zápis, ne práce — ten se
          // neukazuje vůbec, stejně jako ho přeskakuje appka.
          if (!z.check_out && !dnesniBezOdchodu) continue;
          vybraneDny.push({ z, u: null });
          continue;
        }
        const u = upravDen(z, nyni);
        if (!u) continue;
        vybraneDny.push({ z, u });
      }

      // Dovolené a nemoci. Odběratel potřebuje vědět, kdo mu nepřijde a dokdy —
      // bere se všechno, co ještě neskončilo před začátkem zobrazeného týdne,
      // tedy i budoucí. Bez toho se to dozví, až ten člověk nedorazí.
      // Páté kolo — výsledek se zpracuje až níž.
      const ids2 = [...new Set(vybraneDny.map(d => d.z.worker_id))].filter(Boolean);
      if (ids2.length) {
        // Po kusech (viz podleId); strop 300 řádků a pořadí platí pro celek jako dřív.
        slibDovolene = potom(podleId(ids2, (seznam2) => db(
          `vacations?select=worker_id,date_from,date_to,type,note` +
          `&worker_id=in.(${seznam2})&date_to=gte.${od}` +
          `&order=date_from.asc&limit=300`, klic),
          (a, b) => String(a.date_from).localeCompare(String(b.date_from))).then(v => v.length > 300 ? v.slice(0, 300) : v));
      }

      let jmena = {}, sazbaTed = {}, provizeTed = {}, bezProvize = new Set(), historie = {};
      // Zaměstnanec firmy → id firmy (šéfa), podle které se počítají peníze.
      const sefPodle = {};
      // Zaměstnanci s vlastní provizí a kdo má provizi vůbec vyplněnou (null ≠ 0).
      const vlastniProvize = new Set(), provizeZadana = new Set();
      // Telefon a řidičák — od 23. 9. 2026 na přání SubBau. Odběratel volá
      // lidem na stavbu přímo a potřebuje vědět, koho smí poslat s dodávkou.
      let telefony = {}, ridicaky = {}, ubytovani = {}, fotky = {};
      if (ids.length) {

        // ČTYŘI DOTAZY NARÁZ, NE ČTYŘI ZA SEBOU.
        //
        // Žádný z nich nepotřebuje výsledek toho předchozího — všechny se
        // ptají na tytéž `ids`. Do 23. 9. 2026 se přesto čekalo postupně
        // a každý stál celou cestu na Supabase a zpátky. Majitel: „strašně
        // dlouho se načítá ten odkaz." Změřeno: probuzení funkce a JEDEN
        // dotaz trvá 0,4 s (2,2 s po studeném startu), a stránka jich
        // dělala čtrnáct v řadě.
        //
        // KAŽDÝ MÁ VLASTNÍ OŠETŘENÍ CHYBY, jinak by jeden výpadek shodil
        // všechny ostatní — Promise.all padá na první odmítnuté sliby.
        // Výjimka je `profiles`: bez jmen nemá stránka co ukázat, takže
        // ten se schválně NECHYTÁ a chyba projde ven jako dřív.
        const tise = (popis) => (e) => {
          console.warn('[klient] ' + popis + ':', e.message); return null;
        };
        // Podklady pro PENÍZE (provize, historie sazeb, zařazení pod firmu): výpadek nesmí
        // dát potichu nulovou provizi nebo dnešní sazbu u historického týdne → chyba 500.
        // Jen chybějící tabulka/sloupec (migrace neproběhla) se přeskočí jako dřív.
        const tisePenize = (popis) => (e) => {
          if (e && (e.kod === '42703' || e.kod === '42P01' || e.kod === 'PGRST204' || e.kod === 'PGRST205')) {
            console.warn('[klient] ' + popis + ':', e.message); return null;
          }
          throw e;
        };
        const [lidi, dokl, prov, h, ubyt, zam, fot, vlastni] = await Promise.all([
          // Jméno, hodinová sazba a telefon. SubBau si přeje, aby odběratel
          // viděl u každého člověka sazbu i provizi — vyžádal si to sám, aby
          // si mohl fakturu překontrolovat. V appce zůstává provize dál jen
          // pro správce.
          podleId(ids, (s) => db(`profiles?select=id,full_name,hourly_rate_worker,phone&id=in.(${s})`, klic)),
          // ŘIDIČÁK SE POSUZUJE STEJNĚ JAKO V UPOMÍNCE (check-expiring-docs):
          // doklad platí, dokud nebyl odmítnutý nebo označený jako nečitelný.
          // Druhé, vlastní pravidlo by se časem rozešlo s appkou — přesně
          // jako by se rozešlo zaokrouhlování hodin, kdyby se počítalo dvakrát.
          // NEJDE VEN SAMOTNÝ DOKLAD ANI JEHO ČÍSLO, jen „má / nemá" a datum.
          podleId(ids, (s) => db(`documents?select=worker_id,status,valid_until&doc_type=eq.ridicak` +
             `&worker_id=in.(${s})`, klic)).catch(tise('řidičáky se nenačetly')),
          podleId(ids, (s) => db(`worker_commissions?select=worker_id,provize,bez_provize&worker_id=in.(${s})`,
             klic)).catch(tisePenize('provize se nenačetly')),
          // Historie sazeb — bez ní by se týden, ve kterém se sazba měnila,
          // spočítal celý novou sazbou a nesedělo by to s fakturou.
          podleId(ids, (s) => db(`worker_rate_history?select=worker_id,druh,hodnota,valid_from&worker_id=in.(${s})` +
             `&order=valid_from.asc`, klic), (a, b) => String(a.valid_from).localeCompare(String(b.valid_from))).catch(tisePenize('historie sazeb se nenačetla')),
          // Adresa ubytování (od 30. 9. 2026). Zvlášť a s vlastním ošetřením —
          // bez ní se stránka obejde. Starší sloupec ubytovani_adresa nemusí
          // existovat, proto záloha jen s hlavním. KÓDY SE NEČTOU NIKDY.
          podleId(ids, (s) => db(`profiles?select=id,accommodation_address,ubytovani_adresa&id=in.(${s})`, klic))
            .catch(() => podleId(ids, (s) => db(`profiles?select=id,accommodation_address&id=in.(${s})`, klic)))
            .catch(tise('ubytování se nenačetlo')),
          // Zaměstnanci firem (s.r.o.) — jejich hodiny fakturuje firma její
          // sazbou a provize se počítá její provizí. Stejně jako Provize,
          // report firmy i faktura firmy v appce.
          podleId(ids, (s) => db(`profiles?select=id,zamestnavatel_id&id=in.(${s})`, klic))
            .catch(tisePenize('zařazení pod firmu se nenačetlo')),
          // Fotka pracovníka z appky (majitel 1. 10. 2026: „aby se ty fotky
          // propsaly i do toho odkazu"). Zvlášť a potichu — bez fotky se
          // stránka obejde. Ven jde jen odkaz do našeho úložiště fotek.
          podleId(ids, (s) => db(`profiles?select=id,avatar_url&id=in.(${s})`, klic))
            .catch(tise('fotky se nenačetly')),
          // Vlastní provize zaměstnance (od 1. 10. 2026, stejně jako v appce):
          // kdo ji má zapnutou a vyplněnou, počítá se jeho sazbou místo šéfovy.
          // Bez migrace sloupec není → nikdo, jako dosud.
          podleId(ids, (s) => db(`worker_commissions?select=worker_id&vlastni_provize_zamestnance=is.true&worker_id=in.(${s})`, klic))
            .catch(tisePenize('vlastní provize zaměstnanců se nenačetly')),
        ]);
        for (const p of (vlastni || [])) vlastniProvize.add(p.worker_id);
        for (const p of (zam || [])) {
          if (p.zamestnavatel_id && p.zamestnavatel_id !== p.id) sefPodle[p.id] = p.zamestnavatel_id;
        }
        // Šéfové, kteří sami ten týden nedělali, v `ids` nejsou — jejich sazbu,
        // provizi a historii je potřeba dočíst.
        const sefove = [...new Set(Object.values(sefPodle))].filter(id => !ids.includes(id));
        let sefLidi = [], sefProv = [], sefHist = [];
        if (sefove.length) {
          const seznamSefu = sefove.map(encodeURIComponent).join(',');
          [sefLidi, sefProv, sefHist] = await Promise.all([
            db(`profiles?select=id,hourly_rate_worker&id=in.(${seznamSefu})`, klic).catch(tisePenize('sazba firmy se nenačetla')),
            db(`worker_commissions?select=worker_id,provize,bez_provize&worker_id=in.(${seznamSefu})`, klic).catch(tisePenize('provize firmy se nenačetla')),
            db(`worker_rate_history?select=worker_id,druh,hodnota,valid_from&worker_id=in.(${seznamSefu})&order=valid_from.asc`, klic).catch(tisePenize('historie firmy se nenačetla')),
          ]);
        }
        for (const p of (sefLidi || [])) sazbaTed[p.id] = Number(p.hourly_rate_worker) || 0;

        for (const p of (lidi || [])) {
          jmena[p.id] = p.full_name;
          sazbaTed[p.id] = Number(p.hourly_rate_worker) || 0;
          telefony[p.id] = (p.phone || '').trim();
        }
        for (const p of (fot || [])) {
          const f = bezpecnaFotka(p.avatar_url);
          if (f) fotky[p.id] = f;
        }
        for (const p of (ubyt || [])) {
          const a = String(p.accommodation_address || p.ubytovani_adresa || '').trim();
          if (a) ubytovani[p.id] = a.slice(0, MAX_UBYTOVANI);
        }
        for (const d of (dokl || [])) {
          if (d.status === 'rejected' || d.status === 'unreadable') continue;
          const doKdy = d.valid_until ? String(d.valid_until).slice(0, 10) : '';
          const stav = ridicaky[d.worker_id];
          // Kdyby jich měl víc, platí ten s nejdelší platností. Doklad bez
          // data je slabší než doklad s datem v budoucnu, ale silnější než
          // propadlý — proto se prázdno řadí doprostřed, ne na konec.
          // Pořadí: platný v budoucnu (později končící výš) > bez data > propadlý.
          const poradi = (x) => x === '' ? 1 : (x >= dnesIso ? 2 : 0);
          const lepsi = !stav || poradi(doKdy) > poradi(stav.do) ||
            (poradi(doKdy) === poradi(stav.do) && doKdy > stav.do);
          if (lepsi) ridicaky[d.worker_id] = { do: doKdy };
        }
        for (const p of (prov || []).concat(sefProv || [])) {
          if (p.provize != null) provizeZadana.add(p.worker_id);
          if (p.bez_provize) { bezProvize.add(p.worker_id); continue; }
          provizeTed[p.worker_id] = Number(p.provize) || 0;
        }
        for (const r of (h || []).concat(sefHist || [])) {
          const kos = (historie[r.druh] = historie[r.druh] || {});
          (kos[r.worker_id] = kos[r.worker_id] || []).push({
            od: String(r.valid_from).slice(0, 10), hodnota: Number(r.hodnota) || 0,
          });
        }

        // Jedna položka na člověka. Kdo nemá telefon, řidičák ani adresu
        // ubytování, do mapy se nedostane — stránka pak u něj ukáže jen
        // prázdné políčko pro adresu.
        // Ubytování jen u lidí, kteří do skupin odkazu patří TEĎ (audit 3. 11. 2026).
        // Staré dny přinesou i bývalé — jejich současnou adresu (třeba u jiného
        // odběratele) tenhle odkaz vidět nesmí. Stejné pravidlo jako u zápisu.
        const patriTed = new Set(lideVeSkupinach);
        for (const id of ids) {
          const tel = telefony[id] || '';
          const rp = ridicaky[id] || null;
          const ub = patriTed.has(id) ? (ubytovani[id] || '') : '';
          const fo = fotky[id] || '';
          if (!tel && !rp && !ub && !fo) continue;
          lide[id] = { telefon: tel, ridicak: rp ? { do: rp.do || '' } : null, ubytovani: ub, fotka: fo };
        }
      }
      // Kolik platilo v konkrétní den. Když u člověka historie není, platí dnešní.
      const kDni = (druh, wid, den, vychozi) => {
        const h = historie[druh] && historie[druh][wid];
        if (!h || !h.length) return vychozi;
        let v = null;
        for (let i = 0; i < h.length; i++) { if (h[i].od <= den) v = h[i].hodnota; else break; }
        return v == null ? vychozi : v;
      };

      for (const { z, u } of vybraneDny) {
        const zaklad = {
          worker: z.worker_id,
          jmeno: jmena[z.worker_id] || '—',
          datum: String(z.work_date).slice(0, 10),
          stavba: adresaStavby(z),
          prace: (z.work_description || '').trim() || null,
        };

        // Den, u kterého ještě neuplynulo zdržení (vybraný výš bez `u`):
        // klient uvidí, kdo a kde je, ale žádné časy ani hodiny.
        if (!u) {
          radky.push({ ...zaklad, probiha: true, prichod: null, odchod: null, pauzy: [], hodiny: 0 });
          continue;
        }

        // Den, za který pracovník nedostane zaplaceno, se nefakturuje — sazba
        // je nula. Provize SubBau za něj běží dál, pokud není vypnutá zvlášť.
        // U zaměstnance firmy platí sazba a provize FIRMY (viz sefPodle výš).
        const kdoPlati = sefPodle[z.worker_id] || z.worker_id;
        const sazbaZHistorie = Number(kDni('sazba', kdoPlati, zaklad.datum, sazbaTed[kdoPlati] || 0)) || 0;
        const pevnaCastka = (z.vyplata_castka != null && z.vyplata_castka !== '')
          ? Math.max(0, Number(z.vyplata_castka) || 0) : null;
        const sazbaDne = z.bez_vyplaty
          ? 0
          : (pevnaCastka != null && u.hodiny > 0 ? pevnaCastka / u.hodiny : sazbaZHistorie);
        // Provize: „bez provize" řídí ten, kdo platí; sazba může být zaměstnancova vlastní.
        const provizeOd = (sefPodle[z.worker_id] && vlastniProvize.has(z.worker_id)
          && provizeZadana.has(z.worker_id)) ? z.worker_id : kdoPlati;
        const provizeDne = (bezProvize.has(kdoPlati) || z.bez_provize_den)
          ? 0
          : Number(kDni('provize', provizeOd, zaklad.datum, provizeTed[provizeOd] || 0)) || 0;
        radky.push({
          ...zaklad,
          probiha: false,
          prichod: u.prichod,
          odchod: u.odchod,
          pauzy: u.pauzy,
          hodiny: u.hodiny,
          sazba: sazbaDne,
          provize: provizeDne,
          // Ať stránka pozná, že u dne je výjimka, a může ho označit.
          bezVyplaty: !!z.bez_vyplaty,
          bezProvize: !!z.bez_provize_den,
        });
      }
    }

    // Počítadlo otevření. Stránka se sama obnovuje jednou za minutu, a kdyby
    // se počítalo každé takové doptání, ukazovalo by číslo, jak dlouho měl
    // klient okno otevřené, ne kolikrát se přišel podívat. Proto se zvyšuje
    // jen při skutečném otevření — stránka to pozná a pošle `prvni=1`.
    // Čas poslední návštěvy se naopak zapisuje vždycky.
    // Zápis se spustí hned a počká se na něj až před odpovědí (serverová funkce by jinak
    // mohla skončit dřív, než zápis doběhne). Čas jen dopředu (opožděný zápis nepřepíše
    // novější návštěvu); počet jen z přečené hodnoty (souběžný zápis ji nepřepíše starším).
    const nyniIso = new Date().toISOString();
    const zapisNavstevu = (async () => {
      try {
        const casPodm = `or(posledni_navsteva.is.null,posledni_navsteva.lt.${encodeURIComponent(nyniIso)})`;
        let filtr = `id=eq.${odkaz.id}`;
        const zmena = { posledni_navsteva: nyniIso };
        if (prvniOtevreni) {
          const pocet = Number(odkaz.pocet_navstev || 0);
          // Nula i NULL jsou „ještě nenavštíveno" (eq.0 by NULL nezachytilo).
          const pocetPodm = pocet === 0 ? 'or(pocet_navstev.is.null,pocet_navstev.eq.0)' : `pocet_navstev.eq.${pocet}`;
          filtr += `&and=(${casPodm},${pocetPodm})`;
          zmena.pocet_navstev = pocet + 1;
        } else {
          filtr += `&or=(posledni_navsteva.is.null,posledni_navsteva.lt.${encodeURIComponent(nyniIso)})`;
        }
        const rz = await fetch(`${SUPABASE_URL}/rest/v1/client_links?${filtr}`, {
          method: 'PATCH',
          headers: { apikey: klic, Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(zmena),
          signal: AbortSignal.timeout(4000),
        });
        if (!rz.ok) console.warn('[klient] návštěva se nezapsala:', rz.status);
      } catch (e) { console.warn('[klient] návštěva se nezapsala:', (e && e.name) || e); }
    })();

    // Dovolené — dotaz odešel výš, souběžně se jmény a sazbami.
    let dovolene = {};
    try {
      if (slibDovolene) {
        const abs = vybal(await slibDovolene);
        for (const a of (abs || [])) {
          // Absence (neomluvená, zapisuje jen správce) je interní věc kanceláře —
          // odběratel ji vidět nemá (majitel 21. 10. 2026), proto se přeskočí.
          if (a.type === 'absence') continue;
          // Nemoc se pozná podle sloupce type; starší záznamy ji mají jen
          // v poznámce, proto i ta záloha — stejně jako to dělá appka.
          const nemoc = a.type === 'nemoc'
            || (!a.type && /^nemoc/i.test(String(a.note || '').trim()));
          (dovolene[a.worker_id] = dovolene[a.worker_id] || []).push({
            od: a.date_from, do: a.date_to, nemoc,
          });
        }
      }
    } catch (e) { console.warn('[klient] dovolené se nenačetly:', e.message); }

    // Co si odběratel u lidí poznamenal — dotaz odešel hned ve druhém kole.
    const poznamky = await slibPoznamky;

    // Je tenhle týden odběratelem odškrtnutý jako uhrazený? (taky druhé kolo)
    let uhrazeno = false;
    try {
      const u = vybal(await slibUhrazeno);
      uhrazeno = !!(u && u[0] && u[0].uhrazeno);
    } catch (e) { console.warn('[klient] stav týdne:', e.message); }

    // Které týdny má smysl nabídnout v přepínači. Bereme je z docházky těch
    // part, ať se odběratel neproklikává do prázdných týdnů.
    //
    // POČÍTÁ SE JEN PŘI SKUTEČNÉM OTEVŘENÍ STRÁNKY, ne při každém obnovení
    // ani při přepnutí týdne. Je to zdaleka nejdražší dotaz celé funkce:
    // tahá docházku OD ROKU 2000 DO DNEŠKA (až 5000 řádků) jen proto, aby
    // z ní vypadl seznam různých týdnů. Do 23. 9. 2026 běžel pokaždé —
    // i když odběratel jen přepnul týden. Seznam se mezi dvěma obnoveními
    // stejně nezmění, tak si ho drží stránka (`tydny: null` znamená
    // „nech si ten, co máš"). Od 1. 10. 2026 odchází souběžně s docházkou
    // týdne (třetí a čtvrté kolo), ne až úplně na konci.
    let tydny = null;
    if (prvniOtevreni && (teamIds.length || lideVeSkupinach.length)) {
      tydny = [];
      try {
        // Od začátku spolupráce až do dneška — odběratel má vidět celou dobu,
        // co pro něj ti lidé dělají, ne jen probíhající týden.
        const vse = await nactiDochazku(tydnySPartou, tydnyBezParty);
        const videno = new Set();
        for (const r of (vse || [])) {
          const k = r.kw_year + '-' + r.kw;
          if (!videno.has(k) && r.kw && r.kw_year) { videno.add(k); tydny.push({ kw: r.kw, rok: r.kw_year }); }
        }
        tydny.sort((a, b) => b.rok - a.rok || b.kw - a.kw);
      } catch (e) { console.warn('[klient] seznam týdnů:', e.message); }
    }

    await zapisNavstevu;
    res.status(200).json({ ok: true, nazev: odkaz.nazev, kw, rok, od, do: doDne,
                           radky, tydny, poznamky, dovolene, uhrazeno, lide });
  } catch (e) {
    // Podrobnosti si nechá log na Vercelu. Ven jde jen obecná hláška, ať
    // z ní nejde vyčíst, jak je databáze postavená. Do deníku jen stav a kód.
    console.error('[klient-dochazka]', e);
    await zapisChybuOdkazu('beh', 'Odkaz pro odběratele spadl (' + kodVyjimky(e) + ')', stavVyjimky(e), kodVyjimky(e));
    res.status(500).json({ ok: false, chyba: 'chyba_serveru' });
  }
};
