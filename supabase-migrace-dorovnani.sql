-- =====================================================================
-- DOROVNÁNÍ DATABÁZE DOCHÁZKY (1. 10. 2026)
--
-- CO TO DĚLÁ
--   1) Doplní zapomenutou migraci z 23. 8. 2026 (supabase-migrace-faktura-
--      original.sql): do tabulky worker_invoices přidá dva prázdné sloupce
--      original_pdf_url a original_pdf_path. Do nich appka odkládá PŮVODNÍ
--      PDF faktury od pracovníka, když do faktury zapíšete zálohu.
--      Bez nich appka původní PDF nesmaže, ale ztratí na něj odkaz —
--      tlačítko „Původní" ho neukáže a appka hlásí „původní verzi neuchovám".
--   2) JEN ČTE a vypíše, jestli v databázi sedí dvě starší opravy:
--      a) pravidlo typů dokladů (documents_doc_type_check) — povoluje všech
--         10 typů, které appka používá?
--      b) pojistka proti dvojitým podskupinám (index subteams_team_name_uniq)
--         a jestli nějaké dvojité podskupiny nezůstaly.
--
-- CO SE NEMĚNÍ
--   - Žádná data se nemažou ani nepřepisují. Nové sloupce zůstanou prázdné.
--   - Na worker_invoices se kromě dvou nových sloupců nic nemění
--     (práva, pravidla, spouště zůstávají).
--   - Na documents a subteams se NIC nemění — staré skripty
--     (typy-dokladu, oprava-duplicitni-podskupiny) se znovu NEPOUŠTĚJÍ:
--     první by přepsal novější seznam typů, druhý maže řádky.
--
-- JAK SPUSTIT: Supabase → SQL Editor → vložit celé → Run.
--   Dá se pustit opakovaně; podruhé už nic nepřidá, jen znovu vypíše stav.
--   Na konci se ukáže jedna tabulka. První řádek začíná „OK" nebo „POZOR".
--   Při „POZOR" je ve sloupci co_s_tim, co dělat.
-- =====================================================================

begin;

-- Když tabulku zrovna drží jiný dotaz, radši po 5 s skončit chybou,
-- než nechat appku čekat. Pak stačí pustit znovu.
set local lock_timeout = '5s';

-- ── 1) Původní verze faktury (věrně podle migrace z 23. 8. 2026) ─────
alter table public.worker_invoices
  add column if not exists original_pdf_url  text,
  add column if not exists original_pdf_path text;

comment on column public.worker_invoices.original_pdf_url is
  'Odkaz na PDF faktury v podobě, v jaké ji poslal pracovník — před tím, než do ní SubBau zapsal zálohu. Prázdné = faktura se nikdy neupravovala.';
comment on column public.worker_invoices.original_pdf_path is
  'Cesta k původnímu PDF ve složce documents. Drží se kvůli mazání faktury, aby po ní nezůstal osiřelý soubor.';

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Jen čtení katalogu a počítání. Nic se tu nemění.
with
-- 10 typů dokladů, které appka zapisuje (9 v seznamu dokladů + „ridicak" z rozpoznávání fotek)
typy(t, ord) as (values ('op',1),('pas',2),('zivnost',3),('a1',4),('a1_zadost',5),
  ('ridicak',6),('pobyt',7),('vizum',8),('freistellung',9),('other',10)),
-- 1) nové sloupce na worker_invoices (musí být typu text)
sloupce as (
  select t.c, exists (
           select 1 from pg_attribute a
            where a.attrelid = to_regclass('public.worker_invoices')
              and a.attname = t.c and a.attnum > 0 and not a.attisdropped
              and format_type(a.atttypid, a.atttypmod) = 'text') as je
    from (values ('original_pdf_url'), ('original_pdf_path')) t(c)
),
-- 2a) všechna pravidla (check) na documents, která hlídají sloupec doc_type
pravidla as (
  -- „NOT VALID" na konci jen říká, že se staré řádky neprověřovaly — pro nové zápisy platí
  select c.conname, regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') as def
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.conrelid = to_regclass('public.documents') and c.contype = 'c'
     and a.attname = 'doc_type'
     and regexp_replace(pg_get_constraintdef(c.oid), ' NOT VALID$', '') <> 'CHECK ((doc_type IS NOT NULL))'  -- „nesmí být prázdné" typy neomezuje
),
-- tvar „doc_type in (…)" umíme přečíst; cokoli jiného (NOT, <>, OR, AND, regex…) jen nahlásíme
nectitelna as (
  select conname from pravidla
   where def !~ 'doc_type\)?(::text)? = ANY \(' or def ~ '\mNOT\M|<>| OR | AND |~'
),
-- typ chybí, když ho některé čitelné pravidlo nemá v seznamu
chybi as (
  select y.t, y.ord from typy y
   where exists (select 1 from pravidla p
                  where p.conname not in (select conname from nectitelna)
                    and not exists (select 1 from regexp_matches(p.def, '''([^'']*)''', 'g') m
                                     where m[1] = y.t))
),
-- 2b) pojistka proti dvojitým podskupinám: musí být unikátní, platná a na (team_id, lower(btrim(name)))
pojistka as (
  select exists (
    select 1 from pg_class i
      join pg_namespace n on n.oid = i.relnamespace and n.nspname = 'public'
      join pg_index x on x.indexrelid = i.oid
     where i.relname = 'subteams_team_name_uniq'
       and x.indrelid = to_regclass('public.subteams')
       and x.indisunique and x.indisvalid
       and pg_get_indexdef(i.oid) ~ '\(team_id, lower\(btrim\(name\)\)\)') as je
),
-- aktivní podskupiny se stejným názvem v jednom týmu (velikost písmen a mezery okolo se nepočítají)
dvojice as (
  select count(*) as nazvu, coalesce(sum(n - 1), 0) as navic
    from (select count(*) as n from public.subteams
           where coalesce(is_active, true)
           group by team_id, lower(btrim(name)) having count(*) > 1) g
),
radky(poradi, vysledek, kontrola, podrobnost, co_s_tim) as (
  select 2,
         case when bool_and(je) then 'OK' else 'POZOR' end,
         '1 faktury: původní PDF',
         case when bool_and(je) then 'sloupce original_pdf_url a original_pdf_path jsou (text)'
              else 'chybí nebo nejsou text: ' || string_agg(c, ', ') filter (where not je) end,
         case when bool_and(je) then ''
              else 'pustit znovu; zůstane-li POZOR nebo spadne-li, poslat Claudovi hlášku' end
    from sloupce
  union all
  select 3,
         case when to_regclass('public.documents') is null
                or exists (select 1 from nectitelna) or exists (select 1 from chybi)
              then 'POZOR' else 'OK' end,
         '2a typy dokladů',
         case when to_regclass('public.documents') is null then 'tabulka documents chybí'
              when exists (select 1 from nectitelna)
                then 'pravidlo ' || (select string_agg(conname, ', ') from nectitelna)
                     || ' má neobvyklý tvar, nejde přečíst'
              when exists (select 1 from chybi)
                then 'nepovoluje: ' || (select string_agg(t, ', ' order by ord) from chybi)
              when not exists (select 1 from pravidla)
                then 'pravidlo není — databáze typy nehlídá, projde všech 10'
              else 'pravidlo povoluje všech 10 typů appky' end,
         case when to_regclass('public.documents') is null
                or exists (select 1 from nectitelna) or exists (select 1 from chybi)
              then 'poslat Claudovi; starý skript typy-dokladu NEpouštět (přepíše seznam)'
              else '' end
  union all
  select 4,
         case when d.navic > 0 or not p.je then 'POZOR' else 'OK' end,
         '2b dvojité podskupiny',
         case when d.navic > 0
                then 'názvů víckrát v jednom týmu: ' || d.nazvu || ', podskupin navíc: ' || d.navic
                     || case when p.je then '' else ', pojistka (index) chybí' end
              when not p.je then 'dvojice nejsou, ale pojistka subteams_team_name_uniq chybí'
              else 'dvojice nejsou, pojistka subteams_team_name_uniq je' end,
         case when d.navic > 0 then 'poslat Claudovi; starý skript oprava-podskupiny NEpouštět (maže)'
              when not p.je then 'poslat Claudovi — připraví jen pojistku, nic nemaže'
              else '' end
    from dvojice d, pojistka p
)
select left(vysledek, 100) as vysledek, left(kontrola, 100) as kontrola,
       left(podrobnost, 100) as podrobnost, left(co_s_tim, 100) as co_s_tim
  from (
    select 1 as poradi,
           case when count(*) filter (where vysledek = 'POZOR') = 0 then 'OK' else 'POZOR' end,
           'celkem',
           case when count(*) filter (where vysledek = 'POZOR') = 0
                then 'dorovnání hotové, všechny 3 kontroly v pořádku'
                else 'problémů: ' || count(*) filter (where vysledek = 'POZOR') || ' z 3 — viz řádky níže' end,
           case when count(*) filter (where vysledek = 'POZOR') = 0 then ''
                else 'udělat, co píše sloupec co_s_tim u řádků POZOR' end
      from radky
    union all
    select * from radky
  ) v(poradi, vysledek, kontrola, podrobnost, co_s_tim)
 order by poradi;
