-- =====================================================================
-- VZHLED SI PAMATUJE I SAMA FAKTURA
--
-- PROČ: vzhled se dosud bral z profilu pracovníka. Když jste mu ho přepnuli,
-- změnila se i podoba jeho STARÝCH faktur — při každém přepsání PDF vyjela
-- faktura jinak, než jak ji pracovník původně poslal. Faktura je daňový
-- doklad a má zůstat v té podobě, v jaké byla vystavená.
--
-- CO SKRIPT DĚLÁ: přidá k faktuře sloupec s číslem vzhledu. Nová faktura si
-- ho uloží při vystavení a už si ho drží. Ve složce Faktury se dá u konkrétní
-- faktury vzhled přehodit, aniž by to ovlivnilo ostatní.
--
-- Faktury vystavené dřív mají prázdno — ty se dál chovají jako doteď a berou
-- vzhled z profilu. ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run. Klidně i víckrát.
-- =====================================================================

alter table public.worker_invoices
  add column if not exists design_idx smallint;

alter table public.worker_invoices
  drop constraint if exists worker_invoices_design_idx_check;
alter table public.worker_invoices
  add constraint worker_invoices_design_idx_check
  check (design_idx is null or design_idx between 1 and 10);

comment on column public.worker_invoices.design_idx is
  'Ve kterém z deseti vzhledů byla faktura vystavená. Prázdno = vzhled z profilu pracovníka (staré faktury).';

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select invoice_number, supplier_name, design_idx
--   from public.worker_invoices order by sent_at desc limit 20;
