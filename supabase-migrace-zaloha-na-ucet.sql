-- =====================================================================
-- ZÁLOHA UHRAZENÁ NA ÚČET
--
-- CO TO DĚLÁ: u faktury si appka zapamatuje, JAK byla už uhrazená část
-- zaplacená — jestli v hotovosti, nebo převodem na účet. Podle toho se
-- na faktuře objeví jiná věta:
--   hotovost → „Uhrazeno v hotovosti · Bar erhalten · Paid in cash"
--   na účet  → „Po odečtení již uhrazené zálohy ·
--               Abzüglich bereits geleisteter Anzahlung ·
--               Less advance payment received"
--
-- Prázdná hodnota = hotovost, tedy přesně to, co platilo doteď.
-- U žádné existující faktury se tím nic nezmění.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.worker_invoices
  add column if not exists cash_paid_typ text;

alter table public.worker_invoices drop constraint if exists worker_invoices_cash_paid_typ_check;
alter table public.worker_invoices add constraint worker_invoices_cash_paid_typ_check
  check (cash_paid_typ is null or cash_paid_typ in ('hotovost', 'ucet'));

comment on column public.worker_invoices.cash_paid_typ is
  'Jak byla už uhrazená část zaplacená: hotovost, nebo ucet (převodem). '
  'Prázdno = hotovost (tak se chovaly všechny faktury před touhle změnou).';

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select invoice_number, cash_paid, cash_paid_typ, cash_paid_note
--   from public.worker_invoices where cash_paid > 0 order by created_at desc limit 20;
