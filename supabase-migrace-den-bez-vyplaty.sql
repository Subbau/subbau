-- =====================================================================
-- JEDNOTLIVÝ DEN: BEZ VÝPLATY / BEZ PROVIZE / RUČNÍ ČÁSTKA
--
-- PROČ: občas se stane, že pracovník za konkrétní den nedostane zaplaceno
-- (něco zničil, udělal špatně), ale provize nám za ten den běží dál.
-- Nebo naopak — pracovník zaplaceno dostane, ale my za ten den provizi nemáme.
-- A občas je potřeba částku za den prostě přepsat ručně.
--
-- CO SKRIPT DĚLÁ: přidá k jednomu dni docházky tři údaje. Dokud se u dne
-- nepoužijí, nic se nemění a všechno počítá jako dosud.
--
--   bez_vyplaty      — pracovník za ten den nedostane nic a den se
--                      NEFAKTURUJE (nejsou v něm hodiny ani peníze)
--   bez_provize_den  — SubBau za ten den nemá provizi; pracovníka se to netýká
--   vyplata_castka   — ručně přepsaná částka za ten den místo hodiny × sazba;
--                      provizi to nemění
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

alter table public.attendance
  add column if not exists bez_vyplaty boolean not null default false;

alter table public.attendance
  add column if not exists bez_provize_den boolean not null default false;

alter table public.attendance
  add column if not exists vyplata_castka numeric(12,2);

alter table public.attendance
  drop constraint if exists attendance_vyplata_castka_check;
alter table public.attendance
  add constraint attendance_vyplata_castka_check
  check (vyplata_castka is null or vyplata_castka >= 0);

-- Kdo a kdy tu výjimku nastavil — ať se dá dohledat, proč ten den vypadl.
alter table public.attendance
  add column if not exists vyplata_poznamka text;

comment on column public.attendance.bez_vyplaty is
  'Pracovník za tenhle den nedostane zaplaceno a den se mu nefakturuje. Provize SubBau běží dál.';
comment on column public.attendance.bez_provize_den is
  'SubBau za tenhle den nemá provizi. Výplaty pracovníka se to netýká.';
comment on column public.attendance.vyplata_castka is
  'Ručně přepsaná částka za den místo hodiny × sazba. Provizi nemění.';
comment on column public.attendance.vyplata_poznamka is
  'Proč je u dne výjimka — vidí jen správce.';

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select work_date, total_hours, bez_vyplaty, bez_provize_den, vyplata_castka, vyplata_poznamka
--   from public.attendance
--  where bez_vyplaty or bez_provize_den or vyplata_castka is not null
--  order by work_date desc;
