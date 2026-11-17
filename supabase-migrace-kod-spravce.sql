-- KÓD SPRÁVCE (17. 11. 2026)
-- Správce má ve spodku menu místo jména kód (písmeno jména + čtyři číslice).
-- Tenhle sloupec kód drží natrvalo: jednou uložený kód se už nemění a databáze
-- hlídá, že ho nemají dva lidé a že ho nikdo nezmění ani nesmaže. Kód si každý
-- správce uloží sám při přihlášení.
-- Skript jde pustit opakovaně, nic nemaže.

alter table public.profiles add column if not exists kod_spravce text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_kod_spravce_tvar') then
    alter table public.profiles add constraint profiles_kod_spravce_tvar
      check (kod_spravce is null or kod_spravce ~ '^[A-Z][0-9]{4}$');
  end if;
end $$;

create unique index if not exists profiles_kod_spravce_jedinecny
  on public.profiles (kod_spravce) where kod_spravce is not null;

-- Jednou uložený kód se nemění: pokus o změnu nebo vymazání databáze tiše vrátí
-- na původní hodnotu (ostatní údaje v téže úpravě se uloží normálně). Spouští se
-- jen u úprav, které na sloupec kod_spravce sahají.
-- Kdyby bylo někdy potřeba kód ručně změnit:
--   alter table public.profiles disable trigger profiles_kod_spravce_nemenit;
--   … úprava …
--   alter table public.profiles enable trigger profiles_kod_spravce_nemenit;
create or replace function public.kod_spravce_nemenit() returns trigger
language plpgsql as $$
begin
  if old.kod_spravce is not null and new.kod_spravce is distinct from old.kod_spravce then
    new.kod_spravce := old.kod_spravce;
  end if;
  return new;
end $$;

drop trigger if exists profiles_kod_spravce_nemenit on public.profiles;
create trigger profiles_kod_spravce_nemenit
  before update of kod_spravce on public.profiles
  for each row execute function public.kod_spravce_nemenit();

comment on column public.profiles.kod_spravce is
  'Kód správce zobrazený místo jména ve spodku menu. Ukládá se jednou a nemění se.';

notify pgrst, 'reload schema';

-- Kontrola (mělo by vypsat jeden řádek: kod_spravce | text | 1 | 1):
select c.column_name as "sloupec", c.data_type as "typ",
       (select count(*) from pg_indexes
         where schemaname = 'public' and indexname = 'profiles_kod_spravce_jedinecny') as "jedinecny index",
       (select count(*) from pg_trigger
         where tgname = 'profiles_kod_spravce_nemenit' and not tgisinternal) as "pojistka zmeny"
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'kod_spravce';
