-- =====================================================================
-- UBYTOVÁNÍ A AUTA — ROZLOŽENÍ KARET (kam si je správce přetáhl)
--
-- CO TO DĚLÁ: majitel 2. 10. 2026 —
--   „v ubytování jednotlivá ubytování v pravém horním rohu bod, abych mohl
--    přesouvat ubytování, jak budu potřebovat, můžu si vynechat mezeru,
--    dávat si je do více sloupců, abych si to mohl poskládat podle sebe".
--
-- K ubytování a autům (skupinky) přibudou dva sloupce:
--   pozice_sloupec  ve kterém sloupci karta stojí (0 = první zleva)
--   pozice_radek    ve kterém řádku (0 = nahoře)
-- Prázdné = karta se zařadí sama na první volné místo (jako dosud).
-- Rozložení je SPOLEČNÉ pro všechny správce: kdo si karty poskládá, vidí je
-- tak i ostatní. Na mobilu jsou v jednom sloupci ve stejném pořadí.
--
-- PRÁVA SE NEMĚNÍ: nové sloupce dědí pravidlo tabulky — rozložení vidí
-- a mění jen správce, stejně jako ubytování samo.
-- ŽÁDNÁ STÁVAJÍCÍ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
-- Kdyby zrovna někdo do tabulky zapisoval, migrace nečeká věčně: po pěti
-- vteřinách skončí a nic nezmění. Pak ji stačí pustit znovu.
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.skupinky') is null then
    raise exception 'Chybí tabulka skupinky — nejdřív spusťte supabase-migrace-skupinky.sql.';
  end if;
end $pojistka$;

alter table public.skupinky
  add column if not exists pozice_sloupec integer,
  add column if not exists pozice_radek integer;

-- Mez jako pojmenované omezení, založené jen když chybí — opakované spuštění
-- je tak neškodné. Víc než dvanáct sloupců se na žádnou obrazovku nevejde
-- (appka jich víc nekreslí); pět set řádků je pojistka proti překlepu.
do $meze$
begin
  if not exists (select 1 from pg_constraint where conname = 'skupinky_pozice_meze'
                   and conrelid = 'public.skupinky'::regclass) then
    alter table public.skupinky add constraint skupinky_pozice_meze
      check ((pozice_sloupec is null or pozice_sloupec between 0 and 11)
         and (pozice_radek is null or pozice_radek between 0 and 499));
  end if;
end $meze$;

-- Ať appka nové sloupce uvidí hned, ne až PostgREST sám obnoví mezipaměť.
notify pgrst, 'reload schema';

commit;

-- Kontrola: dva nové sloupce, jedna mez, RLS zapnuté a pravidla beze změny.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'skupinky'
          and column_name in ('pozice_sloupec', 'pozice_radek')) as novych_sloupcu,
       (select count(*) from pg_constraint where conrelid = 'public.skupinky'::regclass
          and conname = 'skupinky_pozice_meze') as mezi,
       (select relrowsecurity from pg_class where oid = 'public.skupinky'::regclass) as rls_zapnute,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'skupinky') as pravidel;
