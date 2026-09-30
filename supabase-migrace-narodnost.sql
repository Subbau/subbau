-- =====================================================================
-- NÁRODNOST PRACOVNÍKA (vlaječka u fotky)
--
-- Majitel 30. 9. 2026: „všude, kde bude fotka, přes roh bude vlaječka
-- kulatá, jaké národnosti je — a to se bude zadávat v profilu."
--
-- Přidává se jeden sloupec: kód země podle ISO (CZ, SK, PL, UA, RO…).
-- Zadává se v kartě pracovníka (Profil → Národnost). Prázdné = neuvedeno,
-- pak se vlaječka prostě neukáže.
--
-- (Obdélníček „umí německy" za jménem žádnou migraci nepotřebuje — bere se
-- z úrovně němčiny, která v profilu už je.)
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles add column if not exists narodnost text;

comment on column public.profiles.narodnost is
  'Národnost pracovníka — kód země podle ISO (CZ, SK, PL, UA…). Vlaječka u fotky.';

-- Hlídá tvar: dvě velká písmena. Překlep typu „cz " nebo „Česko" by se
-- jinak uložil a vlaječka by se nenakreslila.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_narodnost_tvar') then
    alter table public.profiles
      add constraint profiles_narodnost_tvar check (narodnost is null or narodnost ~ '^[A-Z]{2}$');
  end if;
end $$;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis. Musí být JEDEN řádek: sloupec narodnost typu text
-- a vedle něj „ANO" u kontroly tvaru.
select c.column_name as sloupec,
       c.data_type   as typ,
       case when exists (select 1 from pg_constraint where conname = 'profiles_narodnost_tvar')
            then 'ANO' else 'NE' end as hlida_tvar
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'narodnost';
