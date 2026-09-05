-- =====================================================================
-- VZHLED FAKTURY U PRACOVNÍKA
--
-- CO TO DĚLÁ: u každého pracovníka se zapamatuje, který z deseti vzhledů
-- faktury se mu má tisknout. Jednou ho nastavíte a příště se faktura
-- vystaví ve stejné podobě.
--
-- Vzhled 1 je ten dosavadní. Kdo nemá nastaveno nic, dostane jedničku,
-- takže se nikomu nic nezmění, dokud to sami nepřepnete.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

alter table public.profiles
  add column if not exists invoice_design smallint;

-- Deset vzhledů, nic jiného se sem nedostane ani omylem.
alter table public.profiles
  drop constraint if exists profiles_invoice_design_check;
alter table public.profiles
  add constraint profiles_invoice_design_check
  check (invoice_design is null or invoice_design between 1 and 10);

comment on column public.profiles.invoice_design is
  'Který z deseti vzhledů faktury se pracovníkovi tiskne. Prázdno = vzhled 1 (původní).';

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select full_name, invoice_design from public.profiles
--  where role in ('osvec','partak') order by full_name;
