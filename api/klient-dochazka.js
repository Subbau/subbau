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
// popis práce. NIC JINÉHO. Sazby, provize, telefony, e-maily, doklady ani
// GPS souřadnice (attendance.location_address) se ven nedostanou — nejsou
// v dotazu do databáze, takže je funkce vůbec nemá.
//
// OBDOBÍ: jen aktuální týden. Týden si klient nevybírá, počítá ho server.
// =====================================================================

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';

// Tvar tokenu — 64 hex znaků. Kontrola je tu proto, aby se do dotazu na
// databázi nedostalo nic jiného než to, co jsme sami vyrobili.
const TVAR_TOKENU = /^[0-9a-f]{64}$/;

// Směna a zaokrouhlování — MUSÍ souhlasit s appkou (applyAttendanceRules
// v subbau_final.html). Kdyby se to rozešlo, klient by viděl jiná čísla,
// než jsou na faktuře, kterou od SubBau dostane.
const SMENA = { start: 7 * 60, delkaPauzy: 30 };
const HAJENA_DOBA_MIN = 10;

function naMinuty(t) {
  if (!t) return null;
  const [h, m, s] = String(t).slice(0, 8).split(':').map(Number);
  return h * 60 + m + (s || 0) / 60;
}
function naCas(m) {
  if (m == null) return null;
  const c = ((Math.round(m) % 1440) + 1440) % 1440;
  return String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
}

// Zaokrouhlení jednoho dne — stejná pravidla jako v appce:
// do 10 minut po celé hodině dolů na celou, jinak nahoru na nejbližší půlhodinu.
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
  const adjCi = poCele <= HAJENA_DOBA_MIN ? ci - poCele : Math.ceil(ci / 30) * 30;

  // U běžící směny se čas NEZAOKROUHLUJE dolů na půlhodinu — jinak by první
  // půlhodinu po příchodu svítila nula a klient by si myslel, že nikdo nedělá.
  let adjCo = bezi ? co : Math.floor(co / 30) * 30;
  const presPulnoc = !bezi && co < ci;
  if (presPulnoc) adjCo += 24 * 60;
  if (adjCo < adjCi) adjCo = adjCi;

  // Všechny pauzy dne. `breaks` je novější tvar, break_start/2 starší —
  // bereme obojí, ať staré záznamy nevypadnou.
  const pauzy = [];
  if (Array.isArray(z.breaks)) {
    for (const b of z.breaks) if (b && b.bs) pauzy.push({ bs: b.bs, be: b.be });
  } else {
    if (z.break_start) pauzy.push({ bs: z.break_start, be: z.break_end });
    if (z.break2_start) pauzy.push({ bs: z.break2_start, be: z.break2_end });
  }
  let pauzaMin = 0;
  const kPrehledu = [];
  for (const p of pauzy) {
    const zac = naMinuty(p.bs);
    const kon = naMinuty(p.be);
    if (zac == null || kon == null) continue;
    const delka = kon - zac;
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

async function db(cesta, klic) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${cesta}`, {
    headers: { apikey: klic, Authorization: `Bearer ${klic}`, Accept: 'application/json' },
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

module.exports = async (req, res) => {
  // Odpověď se nesmí nikde uložit do mezipaměti. Kdyby se uložila, klient by
  // po zneplatnění odkazu koukal na data dál z paměti prohlížeče.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET') { res.status(405).json({ ok: false, chyba: 'metoda' }); return; }

  const klic = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!klic) {
    console.error('[klient] chybí SUPABASE_SERVICE_ROLE_KEY');
    res.status(503).json({ ok: false, chyba: 'nedostupne' });
    return;
  }

  const token = String((req.query && req.query.t) || '');
  if (!TVAR_TOKENU.test(token)) { res.status(404).json({ ok: false, chyba: 'neplatny' }); return; }

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
    if ((odkaz.pocet_navstev || 0) > 100000) {
      res.status(429).json({ ok: false, chyba: 'prilis_mnoho' });
      return;
    }

    const vazby = await db(
      `client_link_teams?select=team_id&link_id=eq.${odkaz.id}`, klic);
    const teamIds = (vazby || []).map(v => v.team_id).filter(Boolean);

    const nyni = ted();
    const dnes = new Date(nyni.den + 'T12:00:00Z');   // poledne, ať posun pásma nikdy nepřehodí den
    const { kw, rok } = tydenKDatu(dnes);
    const { od, do: doDne } = tydenOdDo(dnes);

    let radky = [];
    if (teamIds.length) {
      const seznam = teamIds.map(encodeURIComponent).join(',');
      // Adresa: nejdřív ručně zapsaná stavba, a když chybí, adresa z příchodu —
      // stejné pořadí, jaké má správce v appce (attDisplaySite). Bez té druhé
      // by u části dnů nebyla adresa žádná.
      // Ven jde jen TEXT adresy. Souřadnice (location_lat/lng) ani údaj o tom,
      // jestli ji člověk psal ručně nebo přišla z GPS (address_source), se
      // nečtou — klient tak nepozná rozdíl a ani ho poznat nemá.
      const dochazka = await db(
        `attendance?select=worker_id,work_date,check_in,check_out,break_start,break_end,` +
        `break2_start,break2_end,breaks,total_hours,construction_site,location_address,work_description` +
        `&team_id=in.(${seznam})&work_date=gte.${od}&work_date=lte.${doDne}` +
        `&order=work_date.asc&limit=3000`, klic);

      const ids = [...new Set((dochazka || []).map(z => z.worker_id))];
      let jmena = {};
      if (ids.length) {
        // Z profilů JEN jméno. Nic víc funkce nenačte, takže nic víc nemůže uniknout.
        const lidi = await db(
          `profiles?select=id,full_name&id=in.(${ids.map(encodeURIComponent).join(',')})`, klic);
        for (const p of (lidi || [])) jmena[p.id] = p.full_name;
      }

      for (const z of (dochazka || [])) {
        const u = upravDen(z, nyni);
        if (!u) continue;   // starý den bez odchodu — zapomenutý zápis, nepočítá se
        radky.push({
          jmeno: jmena[z.worker_id] || '—',
          datum: z.work_date,
          prichod: u.prichod,
          odchod: u.odchod,
          pauzy: u.pauzy,
          hodiny: u.hodiny,
          bezi: !!u.bezi,
          stavba: adresaStavby(z),
          prace: (z.work_description || '').trim() || null,
        });
      }
    }

    // Počítadlo otevření. Stránka se sama obnovuje jednou za minutu, a kdyby
    // se počítalo každé takové doptání, ukazovalo by číslo, jak dlouho měl
    // klient okno otevřené, ne kolikrát se přišel podívat. Proto se zvyšuje
    // jen při skutečném otevření — stránka to pozná a pošle `prvni=1`.
    // Čas poslední návštěvy se naopak zapisuje vždycky.
    const prvniOtevreni = String((req.query && req.query.prvni) || '') === '1';
    const zmena = { posledni_navsteva: new Date().toISOString() };
    if (prvniOtevreni) zmena.pocet_navstev = (odkaz.pocet_navstev || 0) + 1;
    fetch(`${SUPABASE_URL}/rest/v1/client_links?id=eq.${odkaz.id}`, {
      method: 'PATCH',
      headers: { apikey: klic, Authorization: `Bearer ${klic}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(zmena),
    }).catch(() => {});

    res.status(200).json({ ok: true, nazev: odkaz.nazev, kw, rok, od, do: doDne, radky });
  } catch (e) {
    // Podrobnosti si nechá log na Vercelu. Ven jde jen obecná hláška, ať
    // z ní nejde vyčíst, jak je databáze postavená.
    console.error('[klient-dochazka]', e);
    res.status(500).json({ ok: false, chyba: 'chyba_serveru' });
  }
};
