-- =====================================================================
-- ŽÁDOST O SMAZÁNÍ ÚČTU (App Store)
--
-- PROČ: Apple vyžaduje, aby si uživatel mohl v appce SÁM požádat o smazání
-- účtu — appka ale sama nic nemaže (smazání boří faktury, docházku i
-- historii a je nevratné). Pracovník proto jen odešle žádost; vidí ji
-- kancelář a smazání dál provádí tlačítkem „Smazat natrvalo", které v appce
-- už je.
--
-- CO TO DĚLÁ: přidá k profilu sloupec smazani_zadost_at — kdy pracovník
-- o smazání požádal. Prázdné = nepožádal. Pracovník ho může sám zrušit
-- (appka to nabízí tlačítkem „Zrušit žádost").
--
-- PRÁVA: žádná nová pravidla nejsou potřeba. Pracovník už dnes smí upravit
-- svůj vlastní profil (telefon, auto, fotku…) — totéž právo pokryje i tenhle
-- sloupec. Kdyby to tak nebylo, appka ohlásí chybu a žádost se neuloží.
--
-- CO TO NEDĚLÁ: nic nemaže, žádný účet, nic nemění na docházce ani fakturách.
-- Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Tabulka profiles neexistuje. Nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.profiles add column if not exists smazani_zadost_at timestamptz;
comment on column public.profiles.smazani_zadost_at is
  'Kdy pracovník sám požádal o smazání účtu (App Store). Prázdné = nepožádal. Appka sama nemaže — jen to zapíše; smazání provádí admin.';

commit;

-- KONTROLA: má vyjít jeden řádek — smazani_zadost_at, timestamp with time zone.
select column_name as sloupec, data_type as typ
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'smazani_zadost_at';
