-- =====================================================================
-- VZHLEDY FAKTUR 11 AŽ 20 — povolit je v databázi
--
-- PROČ: appka umí 20 vzhledů faktur, ale databáze má u obou sloupců
-- podmínku „jen 1 až 10". Když si u někoho zvolíte vzhled 11 a výš,
-- databáze zápis odmítne a volba se neuloží. Deset nových vzhledů se
-- tak nedá vůbec použít.
--
-- CO SKRIPT DĚLÁ: rozšíří obě podmínky z 1–10 na 1–20. Nic víc.
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU — už uložené vzhledy 1–10 platí dál.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Spustit se dá klidně víckrát, nic to nerozbije.
-- =====================================================================

begin;

-- 1) Vzhled nastavený u pracovníka (platí pro jeho další faktury)
alter table public.profiles
  drop constraint if exists profiles_invoice_design_check;
alter table public.profiles
  add constraint profiles_invoice_design_check
  check (invoice_design is null or invoice_design between 1 and 20);

-- 2) Vzhled zapsaný u konkrétní vystavené faktury
alter table public.worker_invoices
  drop constraint if exists worker_invoices_design_idx_check;
alter table public.worker_invoices
  add constraint worker_invoices_design_idx_check
  check (design_idx is null or design_idx between 1 and 20);

commit;

-- =====================================================================
-- KONTROLA — po spuštění musí obě řádky ukazovat „between 1 and 20"
-- =====================================================================
-- select conrelid::regclass as tabulka, conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conname in ('profiles_invoice_design_check',
--                    'worker_invoices_design_idx_check');
--
-- Kontrolní pokus (MUSÍ projít, po migraci už ne spadnout):
-- update public.profiles set invoice_design = 17
--  where id = (select id from public.profiles where role in ('osvec','partak') limit 1);
