-- =====================================================================
-- INDEXY A PRAVIDLA PRO 200 LIDÍ (12. 11. 2026, rozbor rychlosti)
--
-- Co to dělá: přidá indexy, které appka potřebuje při ostrém objemu
-- (200 lidí = ~50 000 řádků docházky za rok, ~10 000 faktur, tisíce zpráv
-- a přihlášení), a zabalí pár starších pravidel (RLS) tak, aby se
-- `auth.uid()` vyhodnotilo jednou na dotaz, ne na každý řádek.
--
-- BEZPEČNÉ: spustit jde kdykoli a vícekrát (nic se nemaže, žádná data se
-- nemění). Index se vytvoří, jen když ještě takový (se stejnými úvodními
-- sloupci) není — appka proto fungovala i bez téhle migrace, jen pomaleji.
-- Tabulka nebo sloupec, který v databázi chybí, se přeskočí a vypíše se to.
-- Vytvoření indexu na tabulce s desítkami tisíc řádků trvá zlomek vteřiny
-- (zápisy do tabulky na tu chvíli počkají).
--
-- Pozn.: základní tabulky (attendance, profiles, documents…) vznikly v dobách,
-- kdy se SQL do repa neukládalo, proto se jejich stávající indexy tady
-- nedají vyčíst — kontrola „už existuje“ se dělá až v databázi.
--
-- SPUSTIT: Supabase → SQL Editor → vložit celé → Run. Na konci vyjde
-- tabulka „co se stalo“ (vytvořeno / už je / přeskočeno) a řádky POZOR u pravidel
-- s neobaleným auth.uid() (pokud nějaká zbyla).
-- =====================================================================

-- ── 0. Pomocná funkce (jen pro tuhle relaci, po skončení zmizí) ──────
-- p_sloupce  = sloupce, které index musí mít na začátku (ve stejném pořadí);
--              pokud takový plný index už existuje, nedělá se nový
-- p_definice = text do závorky create index (třeba 'worker_id, work_date desc')
-- p_srovnat  = false → bere se jen podle jména (částečné indexy, text_pattern_ops,
--              smíšené řazení — tam „stejné sloupce“ neznamená „stejný index“)
create or replace function pg_temp.sb_index(
  p_tabulka text, p_nazev text, p_definice text, p_sloupce text[],
  p_srovnat boolean default true, p_kde text default null)
returns text
language plpgsql
as $$
declare
  v_reg    regclass;
  v_chybi  text;
  v_ma     boolean := false;
begin
  v_reg := to_regclass('public.' || quote_ident(p_tabulka));
  if v_reg is null then
    return p_tabulka || ' / ' || p_nazev || ': tabulka není, přeskočeno';
  end if;

  select string_agg(c, ', ') into v_chybi
    from unnest(p_sloupce) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = p_tabulka and column_name = c);
  if v_chybi is not null then
    return p_tabulka || ' / ' || p_nazev || ': chybí sloupec ' || v_chybi || ', přeskočeno';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = p_nazev and c.relkind = 'i') then
    return p_tabulka || ' / ' || p_nazev || ': už je';
  end if;

  if p_srovnat then
    select exists (
      select 1 from pg_index i
       where i.indrelid = v_reg and i.indisvalid and i.indpred is null
         and (select array_agg(a.attname::text order by k.ord)
                from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
                join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
               where k.ord <= cardinality(p_sloupce)) = p_sloupce
    ) into v_ma;
    if v_ma then
      return p_tabulka || ' / ' || p_nazev || ': index se stejnými sloupci už existuje';
    end if;
  end if;

  begin
    execute format('create index if not exists %I on public.%I (%s)%s',
                   p_nazev, p_tabulka, p_definice,
                   case when p_kde is null then '' else ' where ' || p_kde end);
  exception when others then
    -- Jeden nepovedený index nesmí zastavit ostatní (třeba jiný typ sloupce).
    return p_tabulka || ' / ' || p_nazev || ': NEPODAŘILO SE (' || sqlerrm || ')';
  end;
  return p_tabulka || ' / ' || p_nazev || ': VYTVOŘENO';
end
$$;

-- ── 1. Indexy ────────────────────────────────────────────────────────
drop table if exists pg_temp._sb_vysledek;
create temp table _sb_vysledek (poradi serial, stav text);

insert into _sb_vysledek (stav)
select pg_temp.sb_index(t, n, d, s, sr, k) from (values
  -- DOCHÁZKA (nejrostoucí tabulka): historie jednoho člověka, rozsahy dnů přes
  -- všechny lidi (Provize, Kalendář, Faktury, Výkazy), skupina + den (odkaz pro
  -- odběratele), týdny jednoho člověka (faktura, výkaz) a otevřené směny.
  ('attendance', 'attendance_pracovnik_den',   'worker_id, work_date',          array['worker_id','work_date'],           true,  null),
  ('attendance', 'attendance_den',             'work_date',                     array['work_date'],                       true,  null),
  ('attendance', 'attendance_tym_den',         'team_id, work_date',            array['team_id','work_date'],             true,  null),
  ('attendance', 'attendance_pracovnik_tyden', 'worker_id, kw_year, kw',        array['worker_id','kw_year','kw'],        true,  null),
  ('attendance', 'attendance_tyden',           'kw_year, kw',                   array['kw_year','kw'],                    true,  null),
  ('attendance', 'attendance_otevrene',        'worker_id, work_date',          array['worker_id','work_date','check_out'], false, 'check_out is null'),
  -- FAKTURY: složka řazená podle odeslání, týden jednoho člověka, čísla.
  ('worker_invoices', 'worker_invoices_pracovnik_tyden', 'worker_id, kw_year, kw', array['worker_id','kw_year','kw'],      true,  null),
  ('worker_invoices', 'worker_invoices_tyden',           'kw_year, kw',            array['kw_year','kw'],                  true,  null),
  ('worker_invoices', 'worker_invoices_odeslano',        'sent_at desc, id',       array['sent_at','id'],                  false, null),
  ('worker_invoices', 'worker_invoices_cislo',           'invoice_number',         array['invoice_number'],                true,  null),
  ('zalohove_faktury', 'zalohove_faktury_pracovnik',     'worker_id',              array['worker_id'],                     true,  null),
  ('zalohove_faktury', 'zalohove_faktury_vytvoreno',     'created_at desc',        array['created_at'],                    true,  null),
  -- SAZBY: historie jednoho člověka podle druhu a data; celá historie po stránkách.
  ('worker_rate_history', 'worker_rate_history_pracovnik_druh_od', 'worker_id, druh, valid_from', array['worker_id','druh','valid_from'], true, null),
  ('worker_rate_history', 'worker_rate_history_od_id',             'valid_from, id',              array['valid_from','id'],               true, null),
  -- PROVIZE: platby za týden (všichni lidé, jeden týden).
  ('provize_payments',      'provize_payments_obdobi',      'period_type, period_key', array['period_type','period_key'], true, null),
  ('provize_platby_firem',  'provize_platby_firem_obdobi',  'period_key',              array['period_key'],               true, null),
  ('financials',            'financials_pracovnik_tyden',   'worker_id, kw_year, kw',  array['worker_id','kw_year','kw'], true, null),
  ('weekly_hour_sheets',    'weekly_hour_sheets_pracovnik_tyden', 'worker_id, kw_year, kw', array['worker_id','kw_year','kw'], true, null),
  -- ZPRÁVY A UPOZORNĚNÍ: zprávy člověka od nejnovější, seznam konverzací, nepřečtené.
  ('chat_messages', 'chat_messages_pracovnik_vytvoreno', 'worker_id, created_at desc', array['worker_id','created_at'], true,  null),
  ('chat_messages', 'chat_messages_vytvoreno_id',        'created_at desc, id desc',   array['created_at','id'],         false, null),
  ('chat_messages', 'chat_messages_nepreactene',         'worker_id',                  array['worker_id','is_read'],     false, 'is_read = false'),
  ('notifications', 'notifications_pracovnik_vytvoreno', 'worker_id, created_at desc', array['worker_id','created_at'], true,  null),
  ('notifications', 'notifications_vytvoreno',           'created_at desc',            array['created_at'],              true,  null),
  ('notifications', 'notifications_nepreactene',         'worker_id',                  array['worker_id','is_read'],     false, 'is_read = false'),
  -- DOKLADY: seznam člověka, hlídání platnosti (ranní běh), druh dokladu.
  ('documents', 'documents_pracovnik_nahrano', 'worker_id, uploaded_at desc', array['worker_id','uploaded_at'], true, null),
  ('documents', 'documents_platnost',          'valid_until',                 array['valid_until'],             true, null),
  ('documents', 'documents_pracovnik_druh',    'worker_id, doc_type',         array['worker_id','doc_type'],    true, null),
  -- PŘIHLÁŠENÍ, DOVOLENÉ, PŘESUNY, FOTKY, SMLOUVY
  ('login_history', 'login_history_pracovnik_cas', 'worker_id, logged_at desc', array['worker_id','logged_at'], true, null),
  ('login_history', 'login_history_cas',           'logged_at desc',            array['logged_at'],             true, null),
  ('vacations',     'vacations_pracovnik_od',      'worker_id, date_from',      array['worker_id','date_from'], true, null),
  ('vacations',     'vacations_do',                'date_to',                   array['date_to'],               true, null),
  ('team_assignments', 'team_assignments_pracovnik_kdy', 'worker_id, assigned_at desc', array['worker_id','assigned_at'], true, null),
  ('site_photos',   'site_photos_vytvoreno_id',    'created_at desc, id desc',  array['created_at','id'],       false, null),
  ('site_photos',   'site_photos_pracovnik',       'worker_id',                 array['worker_id'],             true, null),
  ('site_photos',   'site_photos_tym',             'team_id',                   array['team_id'],               true, null),
  ('contracts',     'contracts_pracovnik',         'worker_id',                 array['worker_id'],             true, null),
  ('contracts',     'contracts_podpisovy_token',   'sign_token',                array['sign_token'],            true, null),
  -- Fajfky „poslal jinak“, „trvale jinak“, MMI přesuny: hledání podle začátku klíče (like 'xxx%').
  -- text_pattern_ops funguje i v databázi s českým řazením, běžný index na like ne.
  ('doc_alert_dismissals', 'doc_alert_dismissals_klic_prefix', 'dismiss_key text_pattern_ops', array['dismiss_key'], false, null)
) as x(t, n, d, s, sr, k);

-- ── 2. Pravidla (RLS): auth.uid() jednou na dotaz, ne na každý řádek ──
-- Význam pravidel se NEMĚNÍ, jen se volání zabalí do (select …) — Postgres si
-- pak výsledek pamatuje po celý dotaz. Týká se jen těch, která jsou v repu vidět;
-- starší pravidla (attendance, profiles…) ukáže kontrola na konci.
do $$
begin
  if to_regclass('public.souhlasy') is not null then
    drop policy if exists souhlasy_vlozit_svoje on public.souhlasy;
    create policy souhlasy_vlozit_svoje on public.souhlasy
      for insert to authenticated with check (worker_id = (select auth.uid()));
    drop policy if exists souhlasy_cist on public.souhlasy;
    create policy souhlasy_cist on public.souhlasy
      for select to authenticated using (worker_id = (select auth.uid()) or (select public.je_spravce()));
    insert into _sb_vysledek (stav) values ('RLS souhlasy: přepsáno');
  end if;
  if to_regclass('public.zalohove_faktury') is not null then
    drop policy if exists zalohove_faktury_vlastni on public.zalohove_faktury;
    create policy zalohove_faktury_vlastni on public.zalohove_faktury
      for select to authenticated using (worker_id = (select auth.uid()));
    insert into _sb_vysledek (stav) values ('RLS zalohove_faktury_vlastni: přepsáno');
  end if;
  if to_regclass('public.chyby_appky') is not null then
    drop policy if exists chyby_appky_zapis_sam_sebe on public.chyby_appky;
    create policy chyby_appky_zapis_sam_sebe on public.chyby_appky
      for insert to authenticated with check (kdo = (select auth.uid()));
    drop policy if exists chyby_appky_cte_spravce on public.chyby_appky;
    create policy chyby_appky_cte_spravce on public.chyby_appky
      for select to authenticated using ((select public.je_spravce()));
    insert into _sb_vysledek (stav) values ('RLS chyby_appky: přepsáno');
  end if;
end
$$;

-- ── 3. Co se stalo + kontrola pravidel (jedna tabulka; SQL Editor ukáže jen poslední výsledek) ──
-- Řádky „POZOR" = pravidla, která volají auth.uid() bez (select …). Týká-li se to velké
-- tabulky (attendance, worker_invoices, chat_messages, notifications, documents…), je to
-- kandidát na stejné zabalení — pošlete řádky a doplní se jejich přesná podoba.
-- Žádný řádek POZOR = vše v pořádku.
select co as "co se stalo" from (
  select 1 as sk, poradi as por, stav as co from _sb_vysledek
  union all
  select 2, row_number() over (order by tablename, policyname),
         'POZOR pravidlo ' || tablename || ' / ' || policyname || ' (' || cmd || '): ' ||
         coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.uid\(\)'
     and (coalesce(qual, '') || coalesce(with_check, '')) !~* '\(\s*select\s+auth\.uid\(\)'
) v
order by sk, por;
