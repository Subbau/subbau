-- =====================================================================
-- UBYTOVÁNÍ — CIZÍ LIDÉ NA POKOJI, ZAPLACENO OD–DO, FIRMY S UBYTOVÁNÍM
--
-- CO TO DĚLÁ: majitel 1. 10. 2026 večer —
--   „tlačítko, že na pokoji jsou další cizí osoby, a kolik, případně jména…
--    pokoj je pro 5 lidí, jsou tam dva cizí, tak ať je vidět, že ještě jedno
--    místo je volný", „od kdy do kdy je ubytování zaplacený" a „tlačítko,
--    který firmy řeším ubytování — ostatní mě nezajímají".
--
-- K ubytování (skupinky) přibudou čtyři sloupce:
--   cizi_pocet    kolik cizích lidí (ne našich) na pokoji bydlí — výchozí 0
--   cizi_jmena    jejich jména, nepovinně
--   zaplaceno_od  od kdy je ubytování zaplacené
--   zaplaceno_do  do kdy je zaplacené (appka hlásí blížící se konec)
-- K firmám jeden — „firma" je tu skupina z Týmů (teams), tak ji appka
-- ukazuje u lidí v Pracovnících; odběratelé (companies) to nejsou:
--   resime_ubytovani  ubytování téhle firmy řešíme my — v sekci Ubytování
--                     se pak nabízejí jen lidi z takových firem
--
-- PRÁVA SE NEMĚNÍ. Nové sloupce dědí pravidla svých tabulek: ubytování vidí
-- a mění jen správce; u skupin (teams) platí, co platí dnes — kontrolní výpis
-- na konci ukáže, kolik pravidel na nich je.
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
    raise exception 'Chybí tabulka skupinky — nejdřív spusťte supabase-migrace-skupinky.sql. Nic se nezměnilo.';
  end if;
  if to_regclass('public.teams') is null then
    raise exception 'Chybí tabulka teams (skupiny v Týmech). Nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.skupinky
  add column if not exists cizi_pocet integer not null default 0,
  add column if not exists cizi_jmena text,
  add column if not exists zaplaceno_od date,
  add column if not exists zaplaceno_do date;

-- Meze jako pojmenovaná omezení, založená jen když chybí — opakované
-- spuštění je tak neškodné.
do $meze$
begin
  if not exists (select 1 from pg_constraint where conname = 'skupinky_cizi_pocet_meze'
                   and conrelid = 'public.skupinky'::regclass) then
    alter table public.skupinky add constraint skupinky_cizi_pocet_meze
      check (cizi_pocet between 0 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'skupinky_cizi_jmena_delka'
                   and conrelid = 'public.skupinky'::regclass) then
    alter table public.skupinky add constraint skupinky_cizi_jmena_delka
      check (cizi_jmena is null or length(cizi_jmena) <= 1000);
  end if;
  -- „Zaplaceno do" před „od" je překlep, ne skutečnost.
  if not exists (select 1 from pg_constraint where conname = 'skupinky_zaplaceno_poradi'
                   and conrelid = 'public.skupinky'::regclass) then
    alter table public.skupinky add constraint skupinky_zaplaceno_poradi
      check (zaplaceno_od is null or zaplaceno_do is null or zaplaceno_do >= zaplaceno_od);
  end if;
end $meze$;

alter table public.teams
  add column if not exists resime_ubytovani boolean not null default false;

-- Ať appka nové sloupce uvidí hned, ne až PostgREST sám obnoví mezipaměť.
notify pgrst, 'reload schema';

commit;

-- Kontrola: pět nových sloupců, tři meze a práva beze změny.
select 'skupinky' as tabulka,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'skupinky'
          and column_name in ('cizi_pocet', 'cizi_jmena', 'zaplaceno_od', 'zaplaceno_do')) as novych_sloupcu,
       (select count(*) from pg_constraint where conrelid = 'public.skupinky'::regclass
          and conname in ('skupinky_cizi_pocet_meze', 'skupinky_cizi_jmena_delka', 'skupinky_zaplaceno_poradi')) as mezi,
       (select relrowsecurity from pg_class where oid = 'public.skupinky'::regclass) as rls_zapnute,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'skupinky') as pravidel
union all
select 'teams',
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'teams'
          and column_name = 'resime_ubytovani'),
       0,
       (select relrowsecurity from pg_class where oid = 'public.teams'::regclass),
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'teams');
