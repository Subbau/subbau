-- =====================================================================
-- REŽIM PŘESTÁVKY U FIRMY
--
-- CO TO DĚLÁ: u každé firmy (skupiny) se dá nastavit, jak lidé zapisují
-- přestávku:
--   • „od-do"  = jak to bylo doteď — dají začátek pauzy a pak konec
--   • „fix30"  = jedno tlačítko, klik = přestávka půl hodiny
--   • „fix60"  = jedno tlačítko, klik = přestávka hodina
-- Podle nastavení uvidí pracovník v mobilu jiné tlačítko.
--
-- Automaticky je všude „od-do", takže dokud u firmy nic nezměníte,
-- nezmění se vůbec nic.
--
-- PROČ TAKY SLOUPEC V DOCHÁZCE: režim se u dne ULOŽÍ tak, jak platil ten
-- den. Kdyby se to nedělalo, přesun člověka do jiné firmy by zpětně
-- přepočítal starou docházku podle nového pravidla a rozešly by se
-- hodiny na už vystavených fakturách.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se dva sloupce.
-- Spustit se dá klidně víckrát, nic to nerozbije.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

alter table public.teams
  add column if not exists rezim_prestavky text not null default 'od-do';

alter table public.teams drop constraint if exists teams_rezim_prestavky_check;
alter table public.teams add constraint teams_rezim_prestavky_check
  check (rezim_prestavky in ('od-do', 'fix30', 'fix60'));

comment on column public.teams.rezim_prestavky is
  'Jak lidé u téhle firmy zapisují přestávku: od-do = začátek a konec (výchozí), '
  'fix30 = jedno tlačítko na půl hodiny, fix60 = jedno tlačítko na hodinu.';

-- Snapshot u dne — co platilo, když se ten den zapisoval.
alter table public.attendance
  add column if not exists rezim_prestavky text;

comment on column public.attendance.rezim_prestavky is
  'Jaký režim přestávky platil v den zápisu. Prázdno = od-do (starší dny). '
  'Drží se u dne schválně, ať přesun člověka do jiné firmy nepřepočítá minulost.';

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select name, rezim_prestavky from public.teams order by name;
--
-- select column_name, column_default from information_schema.columns
--  where table_schema='public' and table_name='attendance'
--    and column_name='rezim_prestavky';
