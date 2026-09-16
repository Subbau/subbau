-- =====================================================================
-- POLOHA I PŘI ODCHODU
--
-- CO TO DĚLÁ: k dennímu záznamu se přidá druhá poloha — ta, kde člověk
-- zmáčkl konec směny. Slouží k tomu, aby bylo poznat, když někdo odejde
-- ze stavby dřív a odchod odklikne až jinde.
--
-- KDO TO UVIDÍ: POUZE SPRÁVCE v docházce. Nikam jinam se to nedostane —
-- ani do PDF výkazů, ani do odkazu pro odběratele, ani pracovníkovi.
-- Ve všech dokladech se dál používá adresa z PŘÍCHODU, přesně jako dosud.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se čtyři sloupce.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.attendance
  add column if not exists odchod_lat        double precision,
  add column if not exists odchod_lng        double precision,
  add column if not exists odchod_adresa     text,
  add column if not exists odchod_gps_cas    timestamptz;

comment on column public.attendance.odchod_adresa is
  'Adresa, kde pracovník zmáčkl konec směny. Jen pro správce — do výkazů '
  'ani k odběrateli se nikdy nedostane, tam platí adresa z příchodu.';
comment on column public.attendance.odchod_lat is 'Zeměpisná šířka při odchodu (jen pro správce).';
comment on column public.attendance.odchod_lng is 'Zeměpisná délka při odchodu (jen pro správce).';
comment on column public.attendance.odchod_gps_cas is 'Kdy se ta poloha zachytila.';

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select work_date, location_address as prichod, odchod_adresa as odchod, odchod_gps_cas
--   from public.attendance where odchod_adresa is not null
--  order by work_date desc limit 20;
