-- =====================================================================
-- DALŠÍ SMĚNY VE SKUPINĚ (směna 3, 4, …)
--
-- PROČ: majitel 4. 11. 2026 — „do naší docházky, Týmy, u Máry … přidat
-- ještě jednu směnu. Jo, klidně je tam tlačítko ještě jako na přidání ještě
-- další, ale potřebuji prostě směnu jedna, dva, tři, teď mám 1, 2".
--
-- CO TO DĚLÁ (jen tabulka skupin, public.teams):
--   1. prac_doby_dalsi — začátky a konce směn 3, 4, … jako pole:
--        [ {"od": "HH:MM", "do": "HH:MM"}, … ]
--      První prvek = směna 3, druhý = směna 4 atd. (v appce nejvýš 6 směn).
--      Směna 1 a 2 zůstávají ve svých sloupcích (prac_doba_od/do,
--      prac_doba2_od/do). Prázdné [] = skupina má nejvýš dvě směny jako dosud.
--   2. Pojistka teams_prac_doby_dalsi_pole: ve sloupci je vždy pole.
--   3. Opraví popis sloupce smeny: kdo má jakou směnu, teď 1 až N.
--
-- Je to JEN značka pro správce (kdo přišel nebo odešel mimo svou směnu,
-- svítí ve výkazu modře). Na hodiny, výkazy ani faktury to vliv nemá.
--
-- CO TO NEDĚLÁ:
--   • nemění směnu 1 ani 2, kdo má jakou směnu (smeny), ani nic jiného
--     ve skupinách,
--   • nemění práva — skupiny dál upravuje jen ten, kdo je upravoval dosud
--     (výpis na konci je ukáže),
--   • nic nemaže.
--
-- Spustit se dá klidně víckrát. Když cokoli selže, neuloží se nic.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
declare
  typ text;
begin
  if to_regclass('public.teams') is null then
    raise exception 'Tabulka skupin (teams) neexistuje. Nic se nezměnilo.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'teams'
         and column_name in ('prac_doba2_od', 'prac_doba2_do', 'smeny')) < 3 then
    raise exception 'Chybí směna 2 — nejdřív spusťte supabase-migrace-dve-smeny.sql. Nic se nezměnilo.';
  end if;
  select data_type into typ from information_schema.columns
   where table_schema = 'public' and table_name = 'teams' and column_name = 'prac_doby_dalsi';
  if typ is not null and typ <> 'jsonb' then
    raise exception 'Sloupec teams.prac_doby_dalsi už je, ale jako % (má být jsonb). Nic se nezměnilo.', typ;
  end if;
end $pojistka$;

alter table public.teams add column if not exists prac_doby_dalsi jsonb not null default '[]'::jsonb;

do $tvar$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'teams_prac_doby_dalsi_pole' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_prac_doby_dalsi_pole check (jsonb_typeof(prac_doby_dalsi) = 'array');
  end if;
end $tvar$;

comment on column public.teams.prac_doby_dalsi is 'Směny 3, 4, …: [{"od":"HH:MM","do":"HH:MM"}, …], první prvek = směna 3. Platí jen se směnou 2. Jen na zvýraznění odchylek.';
comment on column public.teams.smeny is 'Kdo má jakou směnu: {"id pracovníka": 1..N} (1 = prac_doba_od/do, 2 = prac_doba2_od/do, 3 a dál = prac_doby_dalsi). Bez záznamu = nehlídá se (jen když má skupina směnu 2).';

commit;

-- KONTROLA: nový sloupec (jsonb, výchozí [], vždy vyplněný), pojistka,
-- popis sloupce smeny a kdo smí skupiny měnit.
select 'sloupec: teams.' || column_name as co,
       data_type || ', výchozí ' || coalesce(column_default, '(žádná)')
         || case is_nullable when 'NO' then ', vždy vyplněný' else ', smí být prázdný' end as podrobnost
  from information_schema.columns
 where table_schema = 'public' and table_name = 'teams' and column_name = 'prac_doby_dalsi'
union all
select 'pojistka: ' || conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.teams'::regclass and conname = 'teams_prac_doby_dalsi_pole'
union all
select 'popis: teams.smeny', col_description('public.teams'::regclass, a.attnum)
  from pg_attribute a
 where a.attrelid = 'public.teams'::regclass and a.attname = 'smeny'
union all
select 'kdo smí měnit skupiny: ' || policyname || ' (' || cmd || ', ' || permissive || ')',
       coalesce(qual, '(bez podmínky)')
  from pg_policies
 where schemaname = 'public' and tablename = 'teams' and cmd in ('UPDATE', 'ALL')
order by 1;
