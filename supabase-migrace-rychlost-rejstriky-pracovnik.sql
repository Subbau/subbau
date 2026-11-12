-- =====================================================================
-- RYCHLOST OD 200 LIDÍ: REJSTŘÍKY PRO DOTAZY APPKY PRACOVNÍKA
--
-- PROČ: appka pracovníka (telefon) pořád čte stejné věci „podle člověka":
--   docházka za den / za týden / všechny týdny, zprávy v chatu a jejich
--   nepřečtený počet (každých 20-60 s), zprávy od SubBau, doklady, smlouvy,
--   dovolená, faktury a historie sazeb. Při 200 lidech je to řádově 30 dotazů
--   za sekundu v klidu a přes 6 000 dotazů při ranním startu. Bez rejstříku
--   na (worker_id, …) čte databáze celé tabulky a čas dotazu roste s tím,
--   jak tabulky tloustnou (docházka 170 000 řádků za rok, zprávy v chatu stovky
--   tisíc).
--
-- CO TO DĚLÁ: pro každou dvojici (tabulka, sloupce) založí rejstřík, ALE
--   • jen když tabulka i všechny sloupce existují (nic nespadne na starší
--     databázi),
--   • jen když tabulka nemá už nějaký rejstřík začínající stejnými sloupci
--     (nevzniknou dva stejné, které by jen zpomalovaly zápis).
--   Appka funguje i bez téhle migrace (jen pomaleji při velkých tabulkách).
--   Opakované spuštění nic nezmění. Nemění žádná data ani práva.
--
-- POZOR: CREATE INDEX krátce zamyká zápisy do tabulky. Spustit mimo špičku
--   (ne v 6-8 ráno, kdy lidé chodí do práce). Při tisících řádků trvá vteřiny.
-- =====================================================================

do $$
declare
  r record;
  sloupce text[];
  c text;
  vse_je boolean;
  uz_je boolean;
begin
  for r in
    select * from (values
      -- tabulka, popis sloupců (pro indexdef i název), tvar (sloupce včetně řazení)
      ('attendance',          'worker_id, work_date',        'worker_id, work_date'),
      ('attendance',          'worker_id, kw_year, kw',      'worker_id, kw_year desc, kw desc'),
      ('chat_messages',       'worker_id, created_at',       'worker_id, created_at desc'),
      ('chat_messages',       'worker_id, sender_role, is_read', 'worker_id, sender_role, is_read'),
      ('notifications',       'worker_id, created_at',       'worker_id, created_at desc'),
      ('documents',           'worker_id',                   'worker_id'),
      ('contracts',           'worker_id',                   'worker_id'),
      ('vacations',           'worker_id',                   'worker_id'),
      ('worker_invoices',     'worker_id, created_at',       'worker_id, created_at desc'),
      ('worker_invoices',     'worker_id, kw_year, kw',      'worker_id, kw_year, kw'),
      ('worker_rate_history', 'worker_id, druh, valid_from', 'worker_id, druh, valid_from'),
      ('login_history',       'worker_id, logged_at',        'worker_id, logged_at'),
      ('weekly_hour_sheets',  'worker_id, kw_year, kw',      'worker_id, kw_year desc, kw desc'),
      ('oznameni_precteno',   'worker_id',                   'worker_id')
    ) as v(tabulka, popis, tvar)
  loop
    -- tabulka existuje?
    if to_regclass('public.' || r.tabulka) is null then
      raise notice 'přeskočeno % (tabulka není)', r.tabulka;
      continue;
    end if;
    -- všechny sloupce existují?
    sloupce := string_to_array(replace(r.popis, ' ', ''), ',');
    vse_je := true;
    foreach c in array sloupce loop
      if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = r.tabulka and column_name = c
      ) then
        vse_je := false;
      end if;
    end loop;
    if not vse_je then
      raise notice 'přeskočeno % (%): chybí sloupec', r.tabulka, r.popis;
      continue;
    end if;
    -- rejstřík začínající stejnými sloupci už je? (pořadí a řazení nerozhoduje)
    select exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = r.tabulka
         and (
           -- indexdef: ... USING btree (worker_id, work_date) ...
           substring(indexdef from '\((.*)\)') like r.popis || '%'
           or replace(substring(indexdef from '\((.*)\)'), ' DESC', '') like r.popis || '%'
         )
    ) into uz_je;
    if uz_je then
      raise notice 'přeskočeno % (%): rejstřík už je', r.tabulka, r.popis;
      continue;
    end if;
    execute format(
      'create index if not exists %I on public.%I (%s)',
      'rychlost_' || r.tabulka || '_' || replace(replace(replace(r.popis, ', ', '_'), ' ', '_'), ',', '_'),
      r.tabulka,
      r.tvar
    );
    raise notice 'založeno: % (%)', r.tabulka, r.tvar;
  end loop;
end $$;

-- Po spuštění (jednou) ať databáze přepočítá statistiky, aby rejstříky hned použila:
do $$
declare t text;
begin
  foreach t in array array['attendance', 'chat_messages', 'notifications'] loop
    if to_regclass('public.' || t) is not null then execute format('analyze public.%I', t); end if;
  end loop;
end $$;
