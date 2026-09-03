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
      business_type: 'osvec', is_osvec: true, german_level: i % 3 === 0 ? 'B1' : 'A2',
      has_car: i % 4 === 0, ic: String(60000000 + i * 137), is_vat_payer: false,
      invoice_address: 'Nádražní ' + (10 + i) + ', 370 01 České Budějovice',
      cooperation_start: dnes(-200 - i * 10),
      created_at: new Date().toISOString(),
    });
  });

  // Provize (marže) — jen ukázková čísla
  D.worker_commissions = lideId.map((w, i) => ({
    worker_id: w, provize: 3 + (i % 3), payment_terms: '7/14', bez_provize: false,
    updated_at: new Date().toISOString(),
  }));

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
  for (let zpet = 20; zpet >= 0; zpet--) {
    const den = dnes(-zpet);
    const dow = new Date(den + 'T00:00:00').getDay();
    if (dow === 0) continue;                     // v neděli se nedělá
    const t = tyden(den);
    lideId.forEach((w, i) => {
      if ((i + zpet) % 7 === 3) return;           // občas někdo chybí
      const pozde = (i + zpet) % 5 === 0;
      const ci = pozde ? '07:12:00' : '06:58:00';
      const co = ((i + zpet) % 6 === 0) ? '17:30:00' : '16:03:00';
      const hodin = ((i + zpet) % 6 === 0) ? 10 : 8.5;
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
  D.announcements = [{
    id: uuid(), title: 'Vítejte v ukázce', is_active: true,
    message: 'Tohle je ukázková verze systému ' + FIRMA + '. Všechna data jsou vymyšlená a nikam se neukládají — klidně si všechno vyzkoušejte.',
    created_at: new Date().toISOString(),
  }];
  D.chat_messages = [
    { id: uuid(), worker_id: lideId[0], message: 'Zítra potřebujeme na Riem ještě dva lidi.', created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: uuid(), worker_id: id.sef, message: 'Domluveno, pošlu Martina a Tomáše.', created_at: new Date(Date.now() - 5400000).toISOString() },
  ];

  // Tabulky, které appka čte, ale ukázka je nepotřebuje mít plné
  ['notifications', 'weekly_hour_sheets', 'contracts', 'site_photos', 'login_history',
   'team_assignments', 'doc_alert_dismissals', 'provize_payments', 'provize_access',
   'financials', 'worker_rate_history', 'client_links', 'client_link_teams', 'avatars']
    .forEach(t => { D[t] = D[t] || [] });

  window.__demoUcty = {
    sef: id.sef,
    pracovnik: lideId[0],
    firma: FIRMA,
  };
})();
