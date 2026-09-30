-- =====================================================================
-- OZNÁMENÍ: KDO HO UVIDÍ, „POROZUMĚL JSEM" A FAJFKY
--
-- Majitel 29.–30. 9. 2026: „v sekci oznámení, abych si mohl vybrat, kdo
-- ho uvidí — firma, parta, člověk" a „když je žlutá, vypíšu to oznámení;
-- když červená, musí tam být tlačítko ‚Porozuměl jsem' a mně se ukáže
-- fajfka, kdo to má odškrtnuté".
--
-- 1) U OZNÁMENÍ SE ULOŽÍ, KOMU PATŘÍ
--    „pro_lidi" = seznam lidí zjištěný při zveřejnění (NULL = všem).
--    „komu" = co správce vybral (firmy, party, lidi) — jen pro výpis.
--    „vyzaduje_potvrzeni" = červené, musí se odkliknout „Porozuměl jsem".
--
-- 2) CIZÍ OZNÁMENÍ SI NIKDO NEPŘEČTE
--    Oznámení pro jednu firmu nevidí lidé z jiné firmy — hlídá to databáze,
--    ne jen appka. Správce vidí všechna.
--
-- 3) KDO CO ODKLIKL
--    Nová tabulka „oznameni_precteno": kdo oznámení zavřel nebo potvrdil
--    „Porozuměl jsem". Zapsat smí každý jen sám za sebe a jen u oznámení,
--    které mu patří; správce vidí všechny, pracovník jen svoje.
--
-- Kdyby na tabulce oznámení nebyla zapnutá práva (RLS), zapnou se: číst
-- smí přihlášení (podle bodu 2), měnit jen správce — přesně jak to appka
-- dělá. Výpis na konci ukáže, jak to bylo a jak to je.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Stávající oznámení platí dál pro
-- všechny. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

-- Jak byla tabulka oznámení nastavená PŘED migrací (pro výpis na konci).
drop table if exists pg_temp._pred;
create temporary table _pred as
  select c.relrowsecurity as rls_bylo
    from pg_class c where c.oid = 'public.announcements'::regclass;

-- ── 1. Komu oznámení patří ───────────────────────────────────────────
alter table public.announcements add column if not exists pro_lidi uuid[];
alter table public.announcements add column if not exists komu jsonb;
alter table public.announcements add column if not exists vyzaduje_potvrzeni boolean not null default false;

comment on column public.announcements.pro_lidi is
  'Komu oznámení patří (id lidí zjištěná při zveřejnění). NULL = všem.';
comment on column public.announcements.komu is
  'Co správce vybral (firmy, party, lidi) — jen pro výpis v Oznámeních.';
comment on column public.announcements.vyzaduje_potvrzeni is
  'Červené: pracovník musí odkliknout „Porozuměl jsem".';

-- ── 2. Práva na oznámení ─────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.announcements'::regclass) then
    -- Práva byla vypnutá: s klíčem z appky šlo oznámení i měnit. Zapnout
    -- a pustit dovnitř jen to, co appka dělá.
    alter table public.announcements enable row level security;
    drop policy if exists "announcements: cte prihlaseny" on public.announcements;
    create policy "announcements: cte prihlaseny" on public.announcements
      for select to authenticated using (true);
    drop policy if exists "announcements: meni spravce" on public.announcements;
    create policy "announcements: meni spravce" on public.announcements
      for all to authenticated
      using ((select public.je_spravce())) with check ((select public.je_spravce()));
  end if;
end $$;

-- „restrictive" = platí VEDLE všech ostatních pravidel čtení (a zužuje je),
-- ať už v databázi jsou jakákoli. Přihlášený vidí oznámení pro všechny,
-- oznámení pro sebe, a správce všechna. Nepřihlášenému (appka oznámení
-- čte až po přihlášení) se nic nepřidává: kde už nějaké čtení měl, zúží
-- se mu jen na oznámení pro všechny.
drop policy if exists "announcements: jen komu patri" on public.announcements;
create policy "announcements: jen komu patri" on public.announcements
  as restrictive for select to authenticated
  using (pro_lidi is null
         or (select auth.uid()) = any(pro_lidi)
         or (select public.je_spravce()));
drop policy if exists "announcements: anon jen pro vsechny" on public.announcements;
create policy "announcements: anon jen pro vsechny" on public.announcements
  as restrictive for select to anon
  using (pro_lidi is null);

-- ── 3. Kdo co odklikl ────────────────────────────────────────────────
-- Typ sloupce oznameni_id se bere z announcements.id (uuid, nebo číslo).
do $$
declare typ text;
begin
  select format_type(a.atttypid, a.atttypmod) into typ
    from pg_attribute a
   where a.attrelid = 'public.announcements'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format($f$
    create table if not exists public.oznameni_precteno (
      oznameni_id %s          not null references public.announcements(id) on delete cascade,
      worker_id   uuid        not null references public.profiles(id) on delete cascade,
      potvrzeno   boolean     not null default false,
      kdy         timestamptz not null default now(),
      primary key (oznameni_id, worker_id)
    )$f$, typ);
end $$;

comment on table public.oznameni_precteno is
  'Kdo oznámení zavřel (potvrzeno = false) nebo odklikl „Porozuměl jsem" (true).';

-- Nová tabulka dostane od Supabase plná práva všem rolím, proto se nejdřív
-- VŠECHNO odebere a pak se pustí dovnitř jen pravidly níž.
revoke all on public.oznameni_precteno from anon, authenticated, public;
grant select, insert on public.oznameni_precteno to authenticated;
alter table public.oznameni_precteno enable row level security;

drop policy if exists "oznameni_precteno: spravce vidi vse" on public.oznameni_precteno;
create policy "oznameni_precteno: spravce vidi vse" on public.oznameni_precteno
  for select to authenticated using ((select public.je_spravce()));

drop policy if exists "oznameni_precteno: svoje vidi pracovnik" on public.oznameni_precteno;
create policy "oznameni_precteno: svoje vidi pracovnik" on public.oznameni_precteno
  for select to authenticated using (worker_id = (select auth.uid()));

-- Zapsat jen sám za sebe a jen u oznámení, které je aktivní a patří mu.
drop policy if exists "oznameni_precteno: odklikne jen sam za sebe" on public.oznameni_precteno;
create policy "oznameni_precteno: odklikne jen sam za sebe" on public.oznameni_precteno
  for insert to authenticated
  with check (
    worker_id = (select auth.uid())
    and exists (select 1 from public.announcements a
                 where a.id = oznameni_id and a.is_active
                   and (a.pro_lidi is null or (select auth.uid()) = any(a.pro_lidi))));

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. Řádky „sloupec:" musí být TŘI, tabulka
-- oznameni_precteno „ANO", u ní TŘI pravidla. Řádky „oznámení:" ukážou
-- pravidla tabulky oznámení — to potřebuju vidět.
select 'sloupec: announcements.' || column_name as co, data_type as podrobnost
  from information_schema.columns
 where table_schema = 'public' and table_name = 'announcements'
   and column_name in ('pro_lidi', 'komu', 'vyzaduje_potvrzeni')
union all
select 'tabulka oznameni_precteno', case when to_regclass('public.oznameni_precteno') is not null then 'ANO' else 'NE' end
union all
select 'práva (RLS) na oznámeních: předtím ' || case when (select rls_bylo from _pred) then 'zapnutá' else 'VYPNUTÁ' end,
       'teď ' || case when (select relrowsecurity from pg_class where oid = 'public.announcements'::regclass) then 'zapnutá' else 'VYPNUTÁ' end
union all
select 'oznámení: ' || policyname || ' (' || cmd || ', ' || permissive || ', ' || array_to_string(roles, ',') || ')',
       coalesce(qual, '') || coalesce(' / ' || with_check, '')
  from pg_policies where schemaname = 'public' and tablename = 'announcements'
union all
select 'oznameni_precteno pravidel: ' || count(*)::text, 'RLS'
  from pg_policies where schemaname = 'public' and tablename = 'oznameni_precteno'
 order by 1;
