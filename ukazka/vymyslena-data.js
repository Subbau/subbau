// =====================================================================
// UKÁZKOVÁ VERZE — vymyšlená data
//
// Žádné jméno, adresa, sazba ani zakázka odsud nepatří skutečnému
// člověku ani firmě. Data se skládají při každém otevření znovu, takže
// jsou vždycky „z tohohle týdne" a ukázka nezestárne.
// =====================================================================

(function () {
  'use strict';
  const D = window.__demoDATA;
  const dnes = window.__demoDnes;
  const tyden = window.__demoTyden;
  const uuid = window.__demoUuid;

  const FIRMA = 'StavKo';        // neutrální název místo SubBau

  const id = {
    firma1: uuid(), firma2: uuid(),
    tym1: uuid(), tym2: uuid(), tym3: uuid(),
    sef: uuid(),
  };

  D.companies = [
    { id: id.firma1, name: 'Bauunternehmen Hoffmann GmbH', created_at: new Date().toISOString() },
    { id: id.firma2, name: 'Weber Dach & Fassade GmbH', created_at: new Date().toISOString() },
  ];
  D.teams = [
    { id: id.tym1, name: 'München — Riem', company_id: id.firma1, is_active: true, location: 'Riemer Straße 12, München' },
    { id: id.tym2, name: 'Ingolstadt — Nord', company_id: id.firma1, is_active: true, location: 'Ingolstädter Straße 96, Pfaffenhofen' },
    { id: id.tym3, name: 'Augsburg — Lech', company_id: id.firma2, is_active: true, location: 'Lechhauser Straße 40, Augsburg' },
  ];
  D.subteams = [
    { id: uuid(), team_id: id.tym1, name: 'Parta A', is_active: true },
    { id: uuid(), team_id: id.tym1, name: 'Parta B', is_active: true },
  ];

  const PROFESE = ['Tesař', 'Zedník', 'Sádrokartonář', 'Montážník', 'Klempíř', 'Izolatér'];
  const LIDE = [
    ['Jan Novák', 'Tesař', id.tym1, 22], ['Petr Svoboda', 'Zedník', id.tym1, 21],
    ['Martin Dvořák', 'Sádrokartonář', id.tym1, 23], ['Tomáš Černý', 'Montážník', id.tym1, 20],
    ['Jakub Procházka', 'Klempíř', id.tym2, 24], ['Lukáš Kučera', 'Tesař', id.tym2, 22],
    ['David Veselý', 'Izolatér', id.tym2, 21], ['Michal Horák', 'Zedník', id.tym2, 22],
    ['Ondřej Němec', 'Montážník', id.tym3, 23], ['Filip Marek', 'Tesař', id.tym3, 25],
    ['Radek Pospíšil', 'Zedník', id.tym3, 21], ['Vojtěch Král', 'Sádrokartonář', id.tym3, 23],
  ];

  D.profiles = [{
    id: id.sef, full_name: 'Vedení ' + FIRMA, email: 'sef@ukazka.cz', role: 'admin',
    is_active: true, registration_status: 'approved', phone: '+420 777 000 111',
    created_at: new Date().toISOString(),
  }];

  const lideId = [];
  LIDE.forEach((l, i) => {
    const pid = uuid();
    lideId.push(pid);
    D.profiles.push({
      id: pid, full_name: l[0], profession: l[1], team_id: l[2], role: 'osvec',
      hourly_rate_worker: l[3], is_active: true, registration_status: 'approved',
      email: 'pracovnik' + (i + 1) + '@ukazka.cz', phone: '+420 6' + (10000000 + i * 111111),
      business_type: 'osvec', is_osvec: true,
      // Úroveň němčiny v hodnotách, které appka zná (DE obdélníček za jménem),
      // národnost pro vlaječku u fotky. Bez sloupce narodnost by karta v ukázce
      // hlásila „spusťte migraci" — to zákazník vidět nemá.
      german_level: ['intermediate', 'basic', 'none', 'advanced'][i % 4],
      narodnost: ['CZ', 'SK', 'CZ', 'PL', 'UA', 'CZ', 'RO', 'SK', 'CZ', 'PL', 'CZ', 'UA'][i % 12],
      zamestnavatel_id: null,
      has_car: i % 4 === 0, ic: String(60000000 + i * 137), is_vat_payer: false,
      invoice_address: 'Nádražní ' + (10 + i) + ', 370 01 České Budějovice',
      // Fakturační údaje — ať jde v ukázce projít i vystavení faktury
      // a zálohové faktury. Čísla jsou vymyšlená.
      invoice_iban: 'CZ' + (10 + i) + ' 0600 0000 0002 5309 95' + (10 + i),
      invoice_swift: 'AGBACZPP', invoice_due_days: 14,
      invoice_customer_name: i % 2 ? 'Weber Dach & Fassade GmbH' : 'Bauunternehmen Hoffmann GmbH',
      invoice_customer_address: i % 2
        ? 'Lindenweg 8\n86150 Augsburg\nDeutschland'
        : 'Riemer Straße 12\n81829 München\nDeutschland',
      invoice_customer_id: '8141356' + (10 + i),
      invoice_customer_vat: 'DE8141356' + (10 + i),
      cooperation_start: dnes(-200 - i * 10),
      created_at: new Date().toISOString(),
    });
  });

  // Provize (marže) — jen ukázková čísla
  D.worker_commissions = lideId.map((w, i) => ({
    worker_id: w, provize: 3 + (i % 3), payment_terms: null, bez_provize: false,
    updated_at: new Date().toISOString(),
  }));

  // Den posunutý od dneška (místní čas, ne UTC — v noci by UTC dalo včerejšek).
  const posunDen = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  // Ubytování a auta (od 1. 10. 2026) — ať je v ukázce vidět sekce i řazení podle nich.
  D.skupinky = [
    // Cizí lidé na pokoji a „zaplaceno od–do" (doplňky 1. 10. 2026 večer).
    { id: uuid(), druh: 'ubytovani', nazev: 'Pension Linde', adresa: 'Lindenstraße 4, 85049 Ingolstadt', pocet_mist: 6, barva: '#2a5d8f', poznamka: null, aktivni: true,
      cizi_pocet: 0, cizi_jmena: null, zaplaceno_od: posunDen(-20), zaplaceno_do: posunDen(25) },
    { id: uuid(), druh: 'ubytovani', nazev: 'Monteurzimmer Nord', adresa: 'Nordring 12, 85053 Ingolstadt', pocet_mist: 5, barva: '#2f6f4e', poznamka: 'klíče u majitele', aktivni: true,
      cizi_pocet: 1, cizi_jmena: 'Hans', zaplaceno_od: posunDen(-25), zaplaceno_do: posunDen(4) },
    { id: uuid(), druh: 'auto', nazev: 'VW Crafter', adresa: null, pocet_mist: 9, barva: '#9c3b22', poznamka: null, aktivni: true },
  ];
  D.skupinky_lide = [
    ...lideId.slice(0, 5).map(w => ({ skupinka_id: D.skupinky[0].id, worker_id: w, druh: 'ubytovani' })),
    ...lideId.slice(5, 8).map(w => ({ skupinka_id: D.skupinky[1].id, worker_id: w, druh: 'ubytovani' })),
    ...lideId.slice(0, 6).map(w => ({ skupinka_id: D.skupinky[2].id, worker_id: w, druh: 'auto' })),
  ];

  // ---- Docházka za poslední tři týdny ----
  const STAVBY = [
    'Ingolstädter Straße 96, Pfaffenhofen', 'Riemer Straße 12, München',
    'Lechhauser Straße 40, Augsburg', 'Bahnhofstraße 7, Freising',
  ];
  const PRACE = [
    'Montáž desek na stropy', 'Zateplení fasády', 'Sádrokartonové příčky',
    'Pokládka izolace', 'Bednění stropu', 'Osazení oken', 'Úklid a příprava materiálu',
  ];
  D.attendance = [];
  const dnesniDen = new Date().getDay() || 7;   // 1=Po … 7=Ne
  // Osm týdnů zpět, ať je v ukázce vidět i týden po splatnosti provize
  // a dá se prolistovat historie. Dřív to bylo jen tři týdny.
  for (let zpet = 56; zpet >= 0; zpet--) {
    const den = dnes(-zpet);
    const dow = new Date(den + 'T00:00:00').getDay();
    if (dow === 0) continue;                     // v neděli se nedělá
    const t = tyden(den);
    lideId.forEach((w, i) => {
      if ((i + zpet) % 7 === 3) return;           // občas někdo chybí
      const pozde = (i + zpet) % 5 === 0;
      const ci = pozde ? '07:12:00' : '06:58:00';
      const co = ((i + zpet) % 6 === 0) ? '17:30:00' : '16:03:00';
      // Hodiny musí sedět s applyAttendanceRules ze appky (ukázková vrstva
      // běží PŘED appkou a funkci zavolat nemůže) — jinak admin v Úpravě dne
      // uvidí jiné číslo, než jaké appka sama přepočítá, a zápis se bude tvářit,
      // že se "něco změnilo", i když nikdo nic neupravil (15. 10. 2026, zjištěno
      // při testu vyfakturovano). Pozdní příchod (07:12) se zaokrouhlí na 7:30
      // (jen do 10 min po celé se promíjí) — o tu půlhodinu míň se tedy pracuje.
      const hodin = ((i + zpet) % 6 === 0) ? (pozde ? 9.5 : 10) : (pozde ? 8 : 8.5);
      // Dnešek u části lidí necháme rozdělaný, ať je vidět běžící směna
      const bezOdchodu = zpet === 0 && dow !== 0 && i % 3 === 0;
      D.attendance.push({
        id: uuid(), worker_id: w, work_date: den, kw: t.kw, kw_year: t.rok,
        check_in: ci, check_out: bezOdchodu ? null : co,
        break_start: '11:00:00', break_end: '11:30:00',
        total_hours: bezOdchodu ? null : hodin,
        construction_site: STAVBY[(i + zpet) % STAVBY.length],
        location_address: STAVBY[(i + zpet) % STAVBY.length],
        address_source: 'gps',
        work_description: PRACE[(i + zpet) % PRACE.length],
        team_id: (D.profiles.find(p => p.id === w) || {}).team_id || null,
        is_manual: false, created_at: new Date().toISOString(),
      });
    });
  }

  // ---- Doklady ----
  const DOKLADY = [
    ['op', 'Občanský průkaz'], ['zivnost', 'Živnostenské oprávnění'],
    ['a1', 'Formulář A1'], ['freistellung', 'Freistellung'],
  ];
  D.documents = [];
  lideId.forEach((w, i) => {
    DOKLADY.forEach((d, j) => {
      if ((i + j) % 5 === 4) return;              // někomu doklad chybí
      D.documents.push({
        id: uuid(), worker_id: w, doc_type: d[0], file_name: d[1] + '.pdf',
        file_url: '', status: (i + j) % 7 === 0 ? 'pending' : 'ok',
        valid_until: (i + j) % 4 === 0 ? dnes(20 + i) : dnes(300 + i * 7),
        no_expiry: false, uploaded_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
    });
  });

  // ---- Faktury ----
  // Zálohové faktury — v ukázce prázdné, ať si je jde zkusit vystavit.
  D.zalohove_faktury = [];
  D.worker_invoices = [];
  lideId.slice(0, 8).forEach((w, i) => {
    const t = tyden(dnes(-7));
    D.worker_invoices.push({
      id: uuid(), worker_id: w, invoice_number: String(t.rok) + String(10 + i).padStart(2, '0'),
      kw: t.kw, kw_year: t.rok, total_hours: 42.5, rate: 20 + (i % 5),
      total_amount: 42.5 * (20 + (i % 5)), status: i % 3 === 0 ? 'paid' : (i % 3 === 1 ? 'sent' : 'new'),
      issue_date: dnes(-5), due_date: dnes(9), created_at: new Date().toISOString(),
    });
  });

  // ---- Dovolené, oznámení, chat ----
  D.vacations = [
    { id: uuid(), worker_id: lideId[2], date_from: dnes(14), date_to: dnes(21), type: 'dovolena', note: 'Rodinná dovolená', created_at: new Date().toISOString() },
    { id: uuid(), worker_id: lideId[5], date_from: dnes(-3), date_to: dnes(-1), type: 'nemoc', note: 'Nemoc', created_at: new Date().toISOString() },
  ];
  // Bez oznámení (majitel 5. 10. 2026: při předvádění nemá vyskakovat ani pípat).
  D.announcements = [];
  D.chat_messages = [
    { id: uuid(), worker_id: lideId[0], message: 'Zítra potřebujeme na Riem ještě dva lidi.', created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: uuid(), worker_id: id.sef, message: 'Domluveno, pošlu Martina a Tomáše.', created_at: new Date(Date.now() - 5400000).toISOString() },
  ];

  // Tabulky, které appka čte, ale ukázka je nepotřebuje mít plné
  ['notifications', 'weekly_hour_sheets', 'contracts', 'site_photos', 'login_history',
   'team_assignments', 'doc_alert_dismissals', 'provize_payments', 'provize_access',
   'financials', 'worker_rate_history', 'client_links', 'client_link_teams', 'avatars']
    .forEach(t => { D[t] = D[t] || [] });

  // ---- Deník chyb (2. 11. 2026) ----
  // Ať je v ukázce vidět, co sekce „Deník chyb" umí: stejná chyba jako jedna
  // skupina s počtem, blok „Kdo" a záznamy bez přihlášení. Hlavní příklad je
  // případ, kvůli kterému deník vznikl: pracovníkovi se šest dní nezapisoval
  // příchod, protože telefon nedal polohu (firma „jen s polohou"), a kancelář
  // o tom nevěděla. Časy jsou „před N hodinami" — ukázka je pořád v 7 dnech.
  // BEZ záznamů odhlaseni a pomalost: zkouška denik-odeslani čeká právě jeden
  // odhlaseni, který vznikne až v ní. Pomocné proměnné dch…, ať se nepletou.
  const dchPred = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const dchJmeno = (kdo) => (kdo && (D.profiles.find(p => p.id === kdo) || {}).full_name) || null;
  const dchAndroid = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
  const dchIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const dchMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
  // Kontext, který jádro deníku přidá ke každému řádku (verze, sekce, telefon…).
  const dchKontext = (h, navic) => Object.assign({
    v: 1, t: 'chyba', verze: '2026-11-01 e', sekce: 'prac/dochazka', role: 'osvec',
    zar: 'Android 10 · Chrome 141', ua: dchAndroid, zPlochy: false, online: true, vid: 'visible',
    vznikla: dchPred(h), msOdStartu: 48210, zalozka: 'k3f9', zarId: 'p7x2m4qa',
  }, navic || {});
  // hPrijato: kdy řádek dorazil do databáze (bez signálu později než vznikl).
  const dchRadek = (h, kdo, kde, zprava, detail, hPrijato) => ({
    id: uuid(), kdy: dchPred(hPrijato == null ? h : hPrijato), created_at: dchPred(hPrijato == null ? h : hPrijato),
    kdo: kdo || null, kdo_jmeno: dchJmeno(kdo), kde, zprava, detail,
  });
  // Petr Svoboda: šest dní „Příchod se NEZAPSAL" — poloha zakázaná (kód 1).
  D.chyby_appky = [[146, 1], [122, 2], [98, 1], [50, 3], [26, 4], [2, 2]].map(([h, n]) => dchRadek(h, lideId[1],
    'dochazka-nezapsano|in', 'Příchod se nezapsal — poloha (kód 1)', dchKontext(h, {
      zarId: 'm2v8q1zt', typ: 'in', duvod: 'poloha', kodPolohy: 1, kod: 1, povoleniStart: 'denied', povoleniKonec: 'denied',
      fixu: 0, udaju: 0, msMereni: 12400, msOdTuknuti: 12950, pravidlo: 'rpc', firmaJenGps: true, pokusDnes: n,
      hlaska: '📍 Příchod se NEZAPSAL — vaše firma zapisuje docházku jen s polohou.', pocet: n,
      poprve: dchPred(h), naposled: dchPred(h - 0.3),
    })));
  D.chyby_appky.push(
    // Slabý signál na stavbě: hláška 4× za 10 minut, do deníku odešla až o hodinu později.
    dchRadek(31, lideId[0], 'hlaska|prac/dochazka', '⚠️ Slabý signál — příchod se nezapsal, zkuste to prosím znovu',
      dchKontext(31, { zarId: 'q4w1e8rt', pocet: 4, poprve: dchPred(31), naposled: dchPred(30.85), souhrn: true, odeslanoPozdeji: true }), 30),
    dchRadek(52, lideId[2], 'vypadek', 'výpadek připojení: 5 dotazů nevyšlo (2 zápisy), 74 s',
      dchKontext(52, { zarId: 'z9c3v6bn', zar: 'Android 13 · Samsung 28', pocet: 5, zapisu: 2, trvaloS: 74, cile: ['rest/attendance', 'rpc/muj_zapis_jen_gps'] })),
    dchRadek(75, id.sef, 'db-server|rest/attendance', 'HTTP 500 · PATCH rest/attendance · XX000',
      dchKontext(75, { sekce: 'admin/dochazka', role: 'admin', zar: 'Mac · Safari 18', ua: dchMac,
        zarId: 'a1s2d3f4', stav: 500, kod: 'XX000', metoda: 'PATCH', filtry: ['id'], ms: 812 })),
    dchRadek(70, lideId[3], 'js-chyba|stranka', "TypeError: null is not an object (evaluating 'el.style')",
      dchKontext(70, { zar: 'iPhone · Safari 18', ua: dchIphone, zPlochy: true, zarId: 'h5j6k7l8', sekce: 'login', pred: true,
        soubor: 'stranka', radek: 23117, sloupec: 21, stack: 'mobSv@stranka:27199:14\nonclick@stranka:1:6' })),
    dchRadek(5, lideId[0], 'migrace-chybi|rest/attendance', 'chybí v databázi: odchod_lat (PGRST204)',
      dchKontext(5, { t: 'varovani', zarId: 'q4w1e8rt', stav: 400, kod: 'PGRST204', metoda: 'PATCH', objekt: 'odchod_lat' })),
    // Bez přihlášení (přes /api/chyba): nikdo se nepřihlásil, tak to zapsal server.
    dchRadek(20, null, 'start-knihovna', 'knihovna pro databázi se nenačetla (ani záloha)',
      { v: 1, t: 'chyba', rane: true, sekce: 'start', ua: dchAndroid, zPlochy: true, online: true, vid: 'visible',
        vznikla: dchPred(20), msOdStartu: 20140, zarId: 'n3b4v5c6', pocet: 2, anon: true, zdroj: 'api/chyba' }),
    dchRadek(30, null, 'prihlaseni|server', 'Přihlášení se nepovedlo (server, HTTP 500, unexpected_failure)',
      { v: 1, t: 'chyba', sekce: 'login', zar: 'Android 12 · Chrome 141', ua: dchAndroid, zPlochy: false, online: true, vid: 'visible',
        vznikla: dchPred(30), msOdStartu: 61200, zarId: 'r8t9y0u1', stav: 500, kod: 'unexpected_failure', trida: 'server',
        email: 'pet…@ukazka.cz', pocet: 3, anon: true, zdroj: 'api/chyba' }),
  );

  window.__demoUcty = {
    sef: id.sef,
    pracovnik: lideId[0],
    firma: FIRMA,
  };
})();
