-- =====================================================================
-- DOVOLENOU A NEMOC SMÍ UPRAVIT SPRÁVCE
--
-- PROČ: majitel 8. 10. 2026: „nemůžu upravit dovolenou, a ne abych ji psal
-- znova". Appka teď u každé nepřítomnosti ukazuje „Upravit" a ukládá změnu
-- do téhož řádku (UPDATE tabulky vacations). Pravidla pro dovolené se ale
-- zakládala ručně v Supabase a pravidlo pro ÚPRAVU mezi nimi není — databáze
-- by úpravu tiše zahodila (bez chyby, jen 0 změněných řádků). Appka to pozná
-- a pošle správce sem.
--
-- CO TO DĚLÁ:
--   1. Přidá pravidlo „vacations: nepritomnost upravi spravce" — měnit
--      zapsanou dovolenou nebo nemoc smí JEN správce (role admin v profilu,
--      funkce public.je_spravce()). Platí i pro nový stav řádku (with check).
--   2. Přihlášeným (authenticated) dá právo UPDATE na tabulku. V Supabase
--      ho obvykle mají odjakživa; tady je jen pro jistotu. Kdo smí co změnit,
--      dál určují pravidla — pracovník ani nikdo jiný úpravu nedostal.
--
-- CO TO NEDĚLÁ:
--   • ostatní pravidla dovolených (čtení, zápis, mazání) nemění ani neruší,
--   • nepřihlášenému (anon) nedává nic,
--   • pracovníkovi nedává úpravu ani vlastní dovolené (může ji smazat
--     a zapsat znovu, jako dosud),
--   • ochranu řádků nezapíná ani nevypíná.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
-- Když cokoli selže, neuloží se nic.
--
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- Supabase se kvůli slovu „drop" může zeptat, jestli to opravdu spustit —
-- ruší se jen pravidlo tohoto souboru (aby šlo spustit znovu), ne data.
-- Na konci se vypíšou všechna pravidla dovolených — mezi nimi musí být
-- „vacations: nepritomnost upravi spravce" s cmd = UPDATE a druh = PERMISSIVE.
-- Pozor na řádky s druh = RESTRICTIVE a cmd UPDATE nebo ALL: takové pravidlo
-- (třeba založené v dashboardu) úpravu správci zablokuje i po této migraci.
-- =====================================================================

begin;

-- Kdyby s dovolenými zrovna někdo pracoval, radši to po 5 vteřinách vzdát.
set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $$
begin
  if to_regclass('public.vacations') is null then
    raise exception 'Tabulka public.vacations neexistuje. Nic se nezměnilo.';
  end if;
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí funkce public.je_spravce() — nejdřív spusťte supabase-migrace-fotka-pracovnika.sql. Nic se nezměnilo.';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.vacations'::regclass) then
    raise notice 'POZOR: ochrana řádků je na vacations VYPNUTÁ — úprava projde i bez tohoto pravidla. Pravidlo se přesto založí; zapnutí ochrany je samostatný krok.';
  end if;
end $$;

-- ── 1. Pravidlo: upravit smí jen správce ─────────────────────────────
drop policy if exists "vacations: nepritomnost upravi spravce" on public.vacations;
create policy "vacations: nepritomnost upravi spravce"
  on public.vacations
  as permissive
  for update
  to authenticated
  using ((select public.je_spravce()))
  with check ((select public.je_spravce()));

-- ── 2. Právo UPDATE pro přihlášené (pravidla výš rozhodnou, komu projde) ──
grant update on public.vacations to authenticated;

commit;

-- ── KONTROLA (jen čte) ────────────────────────────────────────────────
-- Všechna pravidla tabulky dovolených. Nové je „vacations: nepritomnost
-- upravi spravce": cmd UPDATE, druh PERMISSIVE, roles {authenticated}, qual
-- i with_check volají je_spravce(). Ostatní řádky jsou pravidla, která už tam
-- byla. RESTRICTIVE pravidlo pro UPDATE nebo ALL musí projít navíc — kdyby
-- správce nepustilo, úprava v appce skončí hláškou o téhle migraci.
select p.policyname as nazev,
       p.cmd,
       p.permissive as druh,
       p.roles,
       p.qual,
       p.with_check,
       (select case when c.relrowsecurity then 'zapnutá' else 'VYPNUTÁ' end
          from pg_class c where c.oid = 'public.vacations'::regclass) as ochrana_radku
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'vacations'
 order by p.cmd, p.policyname;
