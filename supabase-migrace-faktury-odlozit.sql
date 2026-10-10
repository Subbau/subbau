-- =====================================================================
-- FAKTURY: ODLOŽIT
--
-- PROČ: majitel 10. 10. 2026 — „ve fakturách chci tlačítko Odložit,
-- a když na něj kliknu, ať ten řádek zmodrá".
--
-- CO TO DĚLÁ: přidá k fakturám (worker_invoices) sloupec odlozeno_at —
-- kdy správce fakturu odložil. Prázdné = neodložená. Appka podle něj
-- obarví řádek modře; druhým klikem se odložení zruší (vrátí se prázdné).
--
-- CO TO NEDĚLÁ: nemění částky, stav (Zaplaceno / Vyřízeno), Provize
-- ani práva. Nic nemaže. Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.worker_invoices') is null then
    raise exception 'Tabulka faktur (worker_invoices) neexistuje. Nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.worker_invoices add column if not exists odlozeno_at timestamptz;
comment on column public.worker_invoices.odlozeno_at is
  'Kdy správce fakturu odložil (řádek v přehledu modře). Prázdné = neodložená. Na peníze nemá vliv.';

commit;

-- KONTROLA: má vyjít jeden řádek — odlozeno_at, timestamp with time zone.
select column_name as sloupec, data_type as typ
  from information_schema.columns
 where table_schema = 'public' and table_name = 'worker_invoices' and column_name = 'odlozeno_at';
