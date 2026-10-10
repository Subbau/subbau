-- =====================================================================
-- DVĚ SMĚNY VE SKUPINĚ
--
-- PROČ: majitel 10. 10. 2026 — „u nějaké firmy se dělají dvě pracovní
-- doby; v Týmech chci mít dvě pracovní doby a u každého zaškrtnout, že má
-- směnu číslo 1 nebo 2".
--
-- CO TO DĚLÁ (jen tabulka skupin, public.teams):
--   1. prac_doba2_od / prac_doba2_do — začátek a konec SMĚNY 2.
--      Směna 1 zůstává ve stávajících sloupcích prac_doba_od / prac_doba_do.
--   2. smeny — kdo má jakou směnu: { "id pracovníka": 1 nebo 2 }.
--      Prázdné {} = nikdo nemá vybráno. Kdo vybráno nemá, nehlídá se
--      (dokud skupina směnu 2 nemá, platí směna 1 pro všechny jako dřív).
--
-- Je to JEN značka pro správce (kdo přišel nebo odešel mimo svou směnu,
-- svítí ve výkazu modře). Na hodiny, výkazy ani faktury to vliv nemá.
--
-- CO TO NEDĚLÁ:
--   • nemění stávající pracovní dobu ani nic jiného ve skupinách,
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
begin
  if to_regclass('public.teams') is null then
    raise exception 'Tabulka skupin (teams) neexistuje. Nic se nezměnilo.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'teams' and column_name = 'prac_doba_od') then
    raise exception 'Chybí běžná pracovní doba — nejdřív spusťte supabase-migrace-tymy-oznameni-puntiky.sql. Nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.teams add column if not exists prac_doba2_od time;
alter table public.teams add column if not exists prac_doba2_do time;
alter table public.teams add column if not exists smeny jsonb not null default '{}'::jsonb;

do $tvar$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'teams_smeny_objekt' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_smeny_objekt check (jsonb_typeof(smeny) = 'object');
  end if;
end $tvar$;

comment on column public.teams.prac_doba2_od is 'Začátek směny 2 (směna 1 = prac_doba_od). Jen na zvýraznění odchylek.';
comment on column public.teams.prac_doba2_do is 'Konec směny 2 (směna 1 = prac_doba_do).';
comment on column public.teams.smeny is 'Kdo má jakou směnu: {"id pracovníka": 1|2}. Bez záznamu = nehlídá se (jen když má skupina směnu 2).';

commit;

-- KONTROLA: tři nové sloupce (time, time, jsonb) a kdo smí skupiny měnit.
select 'sloupec: teams.' || column_name as co, data_type as podrobnost
  from information_schema.columns
 where table_schema = 'public' and table_name = 'teams'
   and column_name in ('prac_doba2_od', 'prac_doba2_do', 'smeny')
union all
select 'kdo smí měnit skupiny: ' || policyname || ' (' || cmd || ', ' || permissive || ')',
       coalesce(qual, '(bez podmínky)')
  from pg_policies
 where schemaname = 'public' and tablename = 'teams' and cmd in ('UPDATE', 'ALL')
order by 1;
