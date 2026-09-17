-- =====================================================================
-- ŘIDIČSKÝ PRŮKAZ MEZI POVINNÝMI DOKLADY
--
-- CO TO DĚLÁ: appka bude po každém chtít řidičský průkaz (obě strany).
-- Kdo ho nemá, zaškrtne si „nejsem držitelem řidičského průkazu" a appka
-- ho po něm přestane chtít. Tenhle sloupec si to zaškrtnutí pamatuje.
--
-- Samotný typ dokladu se do databáze nepřidává — doklady se ukládají
-- do už existující tabulky documents pod svým názvem.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists bez_ridicaku boolean not null default false;

comment on column public.profiles.bez_ridicaku is
  'Zaškrtnuto = pracovník prohlásil, že nemá řidičský průkaz. '
  'Appka ho po něm pak nevyžaduje a nehlásí ho jako chybějící doklad.';

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select full_name, bez_ridicaku from public.profiles
--  where role in ('osvec','partak') order by full_name;
