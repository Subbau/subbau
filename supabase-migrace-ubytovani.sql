-- =====================================================================
-- KDE PRACOVNÍK BYDLÍ (UBYTOVÁNÍ)
--
-- CO TO DĚLÁ: k pracovníkovi se dá zapsat adresa ubytování a k ní
-- poznámky — kódy k domu, patro, číslo pokoje, kontakt na majitele.
-- V seznamu pracovníků přibude sloupec „Ubytování"; kliknutím na něj
-- se adresa i poznámky otevřou k úpravě.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se dva sloupce.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists ubytovani_adresa text;

alter table public.profiles
  add column if not exists ubytovani_poznamka text;

comment on column public.profiles.ubytovani_adresa is
  'Adresa ubytování pracovníka. Ukazuje se v seznamu pracovníků.';
comment on column public.profiles.ubytovani_poznamka is
  'Kódy k ubytování, patro, pokoj, kontakt — cokoli k tomu bydlení patří.';

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi ten výpis. Musí být DVA řádky, oba typu text.
select column_name as sloupec, data_type as typ
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'profiles'
   and column_name in ('ubytovani_adresa', 'ubytovani_poznamka')
 order by column_name;
