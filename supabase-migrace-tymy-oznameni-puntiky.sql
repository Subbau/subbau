-- =====================================================================
-- TŘI VĚCI NAJEDNOU: PRAVIDLA FIRMY, POTVRZENÍ OZNÁMENÍ, PUNTÍKY
--
-- 1) U FIRMY SE NASTAVÍ, JAK SE SMÍ ZAPISOVAT DOCHÁZKA
--    „zapis_jen_gps" = tahle firma smí zapisovat příchod a odchod jen
--    s povolenou polohou. Kdo polohu nepovolí, nezapíše.
--
-- 2) U FIRMY SE NASTAVÍ BĚŽNÁ PRACOVNÍ DOBA
--    „prac_doba_od" a „prac_doba_do". Kdo přijde dřív/později nebo
--    odejde jinak, je ve výkazu zvýrazněný, dokud to správce neoznačí
--    jako v pořádku.
--
-- 3) OZNÁMENÍ SE DÁ POSLAT „NA POTVRZENÍ"
--    Červené oznámení musí pracovník odkliknout „Porozuměl jsem".
--    Správce pak vidí, kdo ho už odklikl.
--
-- 4) ČERNÉ PUNTÍKY
--    Nová tabulka. Za každý prohřešek jeden puntík; appka hlídá, kdy
--    se jich sejdou tři. Vidí je správce i ten pracovník.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se čtyři sloupce
-- a jedna tabulka. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

-- ── 1+2. Pravidla firmy ──────────────────────────────────────────────
alter table public.teams add column if not exists zapis_jen_gps boolean not null default false;
alter table public.teams add column if not exists prac_doba_od  time;
alter table public.teams add column if not exists prac_doba_do  time;

comment on column public.teams.zapis_jen_gps is
  'True = příchod a odchod jen s povolenou polohou. Bez polohy se nezapíše.';
comment on column public.teams.prac_doba_od is
  'Běžný začátek pracovní doby firmy. Odchylka se ve výkazu zvýrazní.';
comment on column public.teams.prac_doba_do is
  'Běžný konec pracovní doby firmy.';

-- ── 3. Oznámení na potvrzení ─────────────────────────────────────────
alter table public.notifications add column if not exists vyzaduje_potvrzeni boolean not null default false;
alter table public.notifications add column if not exists potvrzeno_v timestamptz;

comment on column public.notifications.vyzaduje_potvrzeni is
  'True = pracovník musí odkliknout „Porozuměl jsem".';
comment on column public.notifications.potvrzeno_v is
  'Kdy to odklikl. Prázdné = zatím ne.';

-- ── 4. Černé puntíky ─────────────────────────────────────────────────
create table if not exists public.puntiky (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  work_date   date not null default current_date,
  duvod       text,
  -- Kdo puntík dal. Když se účet smaže, puntík zůstane — jinak by se
  -- historie prohřešků dala umazat smazáním účtu správce.
  zadal       uuid references public.profiles(id) on delete set null,
  vytvoreno_v timestamptz not null default now()
);

comment on table public.puntiky is
  'Černé puntíky za prohřešky. Tři puntíky = návrh odečíst 2 hodiny.';

create index if not exists puntiky_worker_idx on public.puntiky (worker_id, work_date);

-- PRÁVA. Nová tabulka dostane od Supabase plná práva všem rolím, proto
-- se nejdřív VŠECHNO odebere a teprve pak se pustí dovnitř politikami.
revoke all on public.puntiky from anon, authenticated, public;
grant select on public.puntiky to authenticated;
grant insert, update, delete on public.puntiky to authenticated;

alter table public.puntiky enable row level security;

-- Správce vidí a spravuje všechno.
drop policy if exists "puntiky: spravuje spravce" on public.puntiky;
create policy "puntiky: spravuje spravce"
  on public.puntiky for all to authenticated
  using ((select public.je_spravce())) with check ((select public.je_spravce()));

-- Pracovník vidí SVOJE puntíky — majitel: „puntíky může vidět i ten sám".
-- Jen čte; přidat ani smazat si je nesmí.
drop policy if exists "puntiky: svoje vidi pracovnik" on public.puntiky;
create policy "puntiky: svoje vidi pracovnik"
  on public.puntiky for select to authenticated
  using (worker_id = (select auth.uid()));

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi ten výpis. Musí být ŠEST řádků: pět sloupců (tři u firem,
-- dva u oznámení) a tabulka puntiky se dvěma pravidly.
select 'sloupec: ' || table_name || '.' || column_name as co, data_type as podrobnost
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'teams' and column_name in ('zapis_jen_gps','prac_doba_od','prac_doba_do'))
     or (table_name = 'notifications' and column_name in ('vyzaduje_potvrzeni','potvrzeno_v')))
union all
select 'tabulka puntiky, pravidel: ' || count(*)::text, 'RLS zapnuté'
  from pg_policies where schemaname = 'public' and tablename = 'puntiky'
 order by 1;
