-- =====================================================================
-- NOVÁ (DOSUD NEVIDĚNÁ) DOVOLENÁ/NEMOC — ORÁMOVÁNÍ V KALENDÁŘI
--
-- PROČ: majitel 22. 10. 2026: „teď podle mě stojí 3 lidi, nahodili si
-- dovolenou a já nevím, jestli tam měli být nebo ne." Appka teď v kalendáři
-- orámuje den, kde si nepřítomnost zapsal SÁM pracovník a správce ji ještě
-- nezkontroloval. Klepnutím na kterýkoli den toho bloku (je to jeden řádek
-- od–do, ne den po dni) se rámeček zruší u celého bloku najednou.
--
-- CO TO DĚLÁ: přidá sloupec vacations.videno_spravcem (true/false).
--   • Nové sloupce dostanou výchozí false — appka je od teď umí nastavit
--     na true: klepnutím v kalendáři, úpravou záznamu správcem, nebo rovnou
--     při založení, když nepřítomnost zapisuje správce sám (ten už ji „viděl").
--   • VŠECHNY DOSAVADNÍ záznamy (založené před touhle migrací) se rovnou
--     označí jako viděné — jinak by se naráz orámovaly úplně všechny staré
--     dovolené a nemoci, což by appku jen zahltilo. Rámeček má smysl jen
--     u toho, co je OD TEĎ nové.
--
-- CO TO NEDĚLÁ: nic nemaže, žádná práva (RLS) nemění — sloupec čte a píše
-- appka přes stejná pravidla, jaká má na vacations už teď.
--
-- ŽÁDNÁ DATA SE NEZTRATÍ. Spustit se dá klidně víckrát (idempotentní).
--
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.vacations') is null then
    raise exception 'Tabulka public.vacations neexistuje. Nic se nezměnilo.';
  end if;
end $$;

alter table public.vacations
  add column if not exists videno_spravcem boolean not null default false;

-- Dosavadní záznamy (před touhle migrací) rovnou jako viděné — rámeček má
-- platit jen pro nové, ne zahltit kalendář starými.
update public.vacations set videno_spravcem = true where videno_spravcem = false;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Řádek musí být 1 a sloupec musí existovat jako boolean, not null, default false.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'vacations' and column_name = 'videno_spravcem') as sloupec_existuje,
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'vacations' and column_name = 'videno_spravcem') as nullable,
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'vacations' and column_name = 'videno_spravcem') as vychozi,
  (select count(*) from public.vacations where videno_spravcem = false) as zatim_nevidenych,
  (select count(*) from public.vacations) as celkem_zaznamu;
