-- KÓD SPRÁVCE (17. 11. 2026)
-- Správce má ve spodku menu místo jména kód (písmeno jména + čtyři číslice).
-- Tenhle sloupec kód drží natrvalo: jednou uložený kód se už nemění a databáze
-- hlídá, že ho nemají dva lidé. Kód si každý správce uloží sám při přihlášení.
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

comment on column public.profiles.kod_spravce is
  'Kód správce zobrazený místo jména ve spodku menu. Ukládá se jednou a nemění se.';

notify pgrst, 'reload schema';

-- Kontrola (mělo by vypsat jeden řádek: kod_spravce | text | 1):
select c.column_name as "sloupec", c.data_type as "typ",
       (select count(*) from pg_indexes
         where schemaname = 'public' and indexname = 'profiles_kod_spravce_jedinecny') as "jedinecny index"
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'profiles' and c.column_name = 'kod_spravce';
