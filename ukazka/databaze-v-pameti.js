// =====================================================================
// UKÁZKOVÁ VERZE — falešná databáze v paměti prohlížeče
//
// Tenhle soubor se vkládá do ukazka.html místo skutečného připojení
// k Supabase. Appka o tom neví: dostane objekt `sb`, který se chová
// stejně jako ten pravý, jen si data drží v paměti prohlížeče.
//
// PROČ TAKHLE: zájemce si může všechno naklikat — dát příchod, přidat
// pracovníka, vystavit fakturu — a nikam to nejde. Zavře okno a je
// čistý stůl pro dalšího. K ostrým datům SubBau se dostat nemůže:
// v tomhle souboru žádný klíč k databázi není a žádný dotaz neopouští
// prohlížeč.
// =====================================================================

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Pomocné funkce
  // ------------------------------------------------------------------
  const kopie = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  let citac = 0;
  function uuid() {
    // Nemusí být kryptograficky náhodné — je to ukázka, ne ostrý provoz.
    citac++;
    const h = (n) => n.toString(16).padStart(4, '0');
    return h(citac) + '0000-0000-4000-8000-' + String(Date.now()).slice(-12).padStart(12, '0');
  }
  const dnesStr = (posun = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + posun);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  function isoTyden(datum) {
    const t = new Date(datum + 'T00:00:00');
    const d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
    const den = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - den);
    const zac = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { kw: Math.ceil((((d - zac) / 86400000) + 1) / 7), rok: d.getUTCFullYear() };
  }

  // ------------------------------------------------------------------
  // Porovnávání hodnot ve filtrech.
  // PostgREST porovnává i čísla zapsaná jako text, proto se to zkouší
  // obojím způsobem — jinak by `.eq('kw', 36)` nenašlo řádek s "36".
  // ------------------------------------------------------------------
  function stejne(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }
  function porovnej(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    const ca = Number(a), cb = Number(b);
    if (Number.isFinite(ca) && Number.isFinite(cb) && String(a).trim() !== '' && String(b).trim() !== '') {
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    }
    return String(a).localeCompare(String(b), 'cs');
  }

  const DATA = {};        // { tabulka: [řádky] }
  function tab(jmeno) { return (DATA[jmeno] = DATA[jmeno] || []); }

  // ------------------------------------------------------------------
  // Vnořené dotazy typu  select('*, worker:profiles!worker_id(full_name)')
  // Appka je používá na 20 místech; bez nich by se výkazy a přehledy
  // ukázaly prázdné.
  // ------------------------------------------------------------------
  const CIZI_KLICE = {
    // tabulka.sloupec  →  na kterou tabulku ukazuje
    'attendance.worker_id': 'profiles',
    'documents.worker_id': 'profiles',
    'contracts.worker_id': 'profiles',
    'vacations.worker_id': 'profiles',
    'weekly_hour_sheets.worker_id': 'profiles',
    'worker_invoices.worker_id': 'profiles',
    'chat_messages.worker_id': 'profiles',
    'notifications.worker_id': 'profiles',
    'site_photos.worker_id': 'profiles',
    'login_history.worker_id': 'profiles',
    'profiles.team_id': 'teams',
    'teams.company_id': 'companies',
    'subteams.team_id': 'teams',
  };

  // Rozebere seznam sloupců na obyčejné a vnořené.
  function rozeberVyber(vyber) {
    const vysledek = { sloupce: null, vnorene: [] };
    if (!vyber || vyber === '*') return vysledek;
    const casti = [];
    let hloubka = 0, kus = '';
    for (const zn of vyber) {
      if (zn === '(') hloubka++;
      if (zn === ')') hloubka--;
      if (zn === ',' && hloubka === 0) { casti.push(kus); kus = ''; continue; }
      kus += zn;
    }
    if (kus.trim()) casti.push(kus);
    const prosté = [];
    for (const c of casti) {
      const t = c.trim();
      const m = t.match(/^([a-zA-Z0-9_]+)\s*:?\s*([a-zA-Z0-9_]*)(?:!([a-zA-Z0-9_]+))?\s*\((.*)\)$/s);
      if (m) {
        vysledek.vnorene.push({
          nazev: m[1],
          tabulka: m[2] || m[1],
          klic: m[3] || null,
          vyber: m[4],
        });
      } else if (t === '*') {
        prosté.push('*');
      } else {
        prosté.push(t.split(/\s+/)[0]);
      }
    }
    vysledek.sloupce = prosté.includes('*') ? null : prosté;
    return vysledek;
  }

  function dopisVnorene(tabulka, radky, vnorene) {
    for (const v of vnorene) {
      const cilTab = v.tabulka;
      // Který sloupec je ten spojovací
      let klic = v.klic;
      if (!klic) {
        klic = Object.keys(CIZI_KLICE).filter(k => k.startsWith(tabulka + '.') && CIZI_KLICE[k] === cilTab)
          .map(k => k.split('.')[1])[0] || (cilTab.replace(/s$/, '') + '_id');
      }
      const cizi = tab(cilTab);
      const podVyber = rozeberVyber(v.vyber);
      for (const r of radky) {
        const cil = cizi.find(x => stejne(x.id, r[klic]));
        r[v.nazev] = cil ? omezSloupce(kopie(cil), podVyber.sloupce) : null;
      }
    }
  }

  function omezSloupce(radek, sloupce) {
    if (!sloupce || !sloupce.length) return radek;
    const v = {};
    for (const s of sloupce) if (s in radek) v[s] = radek[s];
    return v;
  }

  // ------------------------------------------------------------------
  // Skladač dotazu — napodobuje řetězení .from().select().eq().order()…
  // ------------------------------------------------------------------
  function dotaz(tabulka) {
    const stav = {
      tabulka,
      operace: 'select',
      vyber: '*',
      filtry: [],
      razeni: [],
      limit: null,
      rozsah: null,
      jeden: null,        // 'single' | 'maybeSingle'
      data: null,
      vratit: false,
      pocet: null,
    };

    function proved() {
      const t = tab(stav.tabulka);

      if (stav.operace === 'insert') {
        const nove = (Array.isArray(stav.data) ? stav.data : [stav.data]).map(r => {
          const radek = { id: r.id || uuid(), created_at: new Date().toISOString(), ...kopie(r) };
          if (!radek.id) radek.id = uuid();
          return radek;
        });
        t.push(...nove);
        return { data: stav.vratit ? (stav.jeden ? kopie(nove[0]) : kopie(nove)) : null, error: null };
      }

      let vybrane = t.filter(radek => stav.filtry.every(f => f(radek)));

      if (stav.operace === 'update') {
        vybrane.forEach(r => Object.assign(r, kopie(stav.data)));
        return { data: stav.vratit ? (stav.jeden ? kopie(vybrane[0]) || null : kopie(vybrane)) : null, error: null };
      }
      if (stav.operace === 'delete') {
        DATA[stav.tabulka] = t.filter(r => !vybrane.includes(r));
        return { data: stav.vratit ? kopie(vybrane) : null, error: null };
      }
      if (stav.operace === 'upsert') {
        const vsechny = Array.isArray(stav.data) ? stav.data : [stav.data];
        const klice = (stav.onConflict || 'id').split(',').map(s => s.trim());
        const vysl = [];
        for (const r of vsechny) {
          const stavajici = t.find(x => klice.every(k => stejne(x[k], r[k])));
          if (stavajici) { Object.assign(stavajici, kopie(r)); vysl.push(stavajici); }
          else { const n = { id: r.id || uuid(), created_at: new Date().toISOString(), ...kopie(r) }; t.push(n); vysl.push(n); }
        }
        return { data: stav.vratit ? kopie(vysl) : null, error: null };
      }

      // ---- select ----
      const celkem = vybrane.length;
      for (let i = stav.razeni.length - 1; i >= 0; i--) {
        const { sloupec, vzestupne } = stav.razeni[i];
        vybrane = vybrane.slice().sort((a, b) => (vzestupne ? 1 : -1) * porovnej(a[sloupec], b[sloupec]));
      }
      if (stav.rozsah) vybrane = vybrane.slice(stav.rozsah[0], stav.rozsah[1] + 1);
      if (stav.limit != null) vybrane = vybrane.slice(0, stav.limit);

      const rozbor = rozeberVyber(stav.vyber);
      let vysl = vybrane.map(r => omezSloupce(kopie(r), rozbor.sloupce));
      if (rozbor.vnorene.length) dopisVnorene(stav.tabulka, vysl, rozbor.vnorene);

      if (stav.jeden === 'single') {
        if (vysl.length !== 1) {
          return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
        }
        return { data: vysl[0], error: null, count: celkem };
      }
      if (stav.jeden === 'maybeSingle') return { data: vysl[0] || null, error: null, count: celkem };
      return { data: vysl, error: null, count: celkem };
    }

    const api = {
      select(v, opts) {
        if (stav.operace === 'select') stav.vyber = v || '*';
        else stav.vratit = true;
        if (opts && opts.count) stav.pocet = opts.count;
        return api;
      },
      insert(d, o) { stav.operace = 'insert'; stav.data = d; if (o && o.count) stav.pocet = o.count; return api },
      update(d) { stav.operace = 'update'; stav.data = d; return api },
      upsert(d, o) { stav.operace = 'upsert'; stav.data = d; stav.onConflict = o && o.onConflict; return api },
      delete() { stav.operace = 'delete'; return api },

      eq(s, v) { stav.filtry.push(r => stejne(r[s], v)); return api },
      neq(s, v) { stav.filtry.push(r => !stejne(r[s], v)); return api },
      gt(s, v) { stav.filtry.push(r => porovnej(r[s], v) > 0); return api },
      gte(s, v) { stav.filtry.push(r => porovnej(r[s], v) >= 0); return api },
      lt(s, v) { stav.filtry.push(r => porovnej(r[s], v) < 0); return api },
      lte(s, v) { stav.filtry.push(r => porovnej(r[s], v) <= 0); return api },
      in(s, pole) { const p = (pole || []).map(String); stav.filtry.push(r => p.includes(String(r[s]))); return api },
      is(s, v) {
        stav.filtry.push(r => (v === null ? (r[s] == null) : v === true ? r[s] === true : v === false ? r[s] === false : stejne(r[s], v)));
        return api;
      },
      not(s, op, v) {
        stav.filtry.push(r => {
          if (op === 'is') return v === null ? r[s] != null : !stejne(r[s], v);
          if (op === 'eq') return !stejne(r[s], v);
          if (op === 'in') return !(v || []).map(String).includes(String(r[s]));
          return true;
        });
        return api;
      },
      like(s, vzor) { const re = vzorNaRegex(vzor, false); stav.filtry.push(r => re.test(String(r[s] ?? ''))); return api },
      ilike(s, vzor) { const re = vzorNaRegex(vzor, true); stav.filtry.push(r => re.test(String(r[s] ?? ''))); return api },
      contains(s, v) {
        stav.filtry.push(r => {
          const pole = r[s];
          if (Array.isArray(pole)) return (Array.isArray(v) ? v : [v]).every(x => pole.some(y => stejne(y, x)));
          if (pole && typeof pole === 'object' && v && typeof v === 'object') {
            return Object.keys(v).every(k => stejne(pole[k], v[k]));
          }
          return false;
        });
        return api;
      },
      or(vyraz) {
        // `sloupec.eq.hodnota,jiny.is.null`
        const casti = String(vyraz).split(',').map(c => c.trim()).filter(Boolean);
        stav.filtry.push(r => casti.some(c => {
          const [s, op, ...zbytek] = c.split('.');
          const v = zbytek.join('.');
          if (op === 'eq') return stejne(r[s], v);
          if (op === 'neq') return !stejne(r[s], v);
          if (op === 'is') return v === 'null' ? r[s] == null : stejne(r[s], v);
          if (op === 'gte') return porovnej(r[s], v) >= 0;
          if (op === 'lte') return porovnej(r[s], v) <= 0;
          return false;
        }));
        return api;
      },
      filter(s, op, v) { return api[op] ? api[op](s, v) : api },
      order(s, o) { stav.razeni.push({ sloupec: s, vzestupne: !(o && o.ascending === false) }); return api },
      limit(n) { stav.limit = n; return api },
      range(a, b) { stav.rozsah = [a, b]; return api },
      single() { stav.jeden = 'single'; return api },
      maybeSingle() { stav.jeden = 'maybeSingle'; return api },
      csv() { return api },
      then(splneno, selhalo) {
        // Malé zpoždění, ať se ukázka chová jako opravdová appka na síti
        // (probliknou načítací hlášky, nic neskočí okamžitě).
        return new Promise(res => setTimeout(() => res(proved()), 40)).then(splneno, selhalo);
      },
      catch(f) { return api.then(v => v, f) },
      finally(f) { return api.then(v => { f && f(); return v }, e => { f && f(); throw e }) },
    };
    return api;
  }

  function vzorNaRegex(vzor, bezOhleduNaVelikost) {
    const utek = String(vzor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + utek.replace(/%/g, '.*').replace(/_/g, '.') + '$', bezOhleduNaVelikost ? 'i' : '');
  }

  window.__demoDATA = DATA;
  window.__demoDotaz = dotaz;
  window.__demoUuid = uuid;
  window.__demoDnes = dnesStr;
  window.__demoTyden = isoTyden;
})();
