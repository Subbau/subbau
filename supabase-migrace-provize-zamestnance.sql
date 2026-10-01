-- =====================================================================
-- VLASTNÍ PROVIZE ZAMĚSTNANCE
--
-- CO TO DĚLÁ: zaměstnanec (pracuje pod šéfem — firmou nebo živnostníkem)
-- se v Provizích dosud počítal VŽDY provizí svého šéfa. Majitel 1. 10. 2026:
-- „aby v provizích šla zadat provize, když je to ten zaměstnanec."
-- Nový sloupec říká, že zaměstnanec má zapnutou vlastní provizi. Pak se jeho
-- hodiny počítají jeho provizí (worker_commissions.provize a historie sazeb),
-- peníze dál jdou šéfovi (ten za něj fakturuje) a „bez provize" se řídí šéfem.
--
-- Výchozí hodnota je false = přesně dnešní stav u všech. Dokud se u někoho
-- v Provizích nezapne „✎ vlastní provize", nezmění se ani cent.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.worker_commissions
  add column if not exists vlastni_provize_zamestnance boolean not null default false;

comment on column public.worker_commissions.vlastni_provize_zamestnance is
  'Zaměstnanec (profiles.zamestnavatel_id) se počítá vlastní provizí místo šéfovy. '
  'Peníze jdou dál šéfovi. Výchozí false = šéfova provize jako dřív.';

commit;

-- Kontrola: má vyjít jeden řádek s data_type = boolean.
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'worker_commissions'
   and column_name = 'vlastni_provize_zamestnance';
