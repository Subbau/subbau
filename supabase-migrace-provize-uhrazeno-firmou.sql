-- =====================================================================
-- UHRAZENÁ PROVIZE OD FIRMY
--
-- CO TO DĚLÁ: u nadpisu každé firmy v Provizích přibude zaškrtávátko
-- „Uhrazená provize" za zobrazený týden. Je to přehled o tom, jestli FIRMA
-- zaplatila NÁM — nemá to nic společného se zaškrtáváním u jednotlivých lidí,
-- to zůstává, jak bylo.
--
-- Dokud provize nedorazí a projde splatnost, svítí nadpis firmy červeně.
-- Po zaškrtnutí zeleně.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jedna tabulka.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

create table if not exists public.provize_platby_firem (
  firma       text not null,
  period_key  text not null,          -- klíč týdne, stejný jako v provize_payments
  paid        boolean not null default false,
  paid_at     timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (firma, period_key)
);

comment on table public.provize_platby_firem is
  'Zaplatila nám firma provizi za daný týden. Přehled pro SubBau, nesouvisí s uhrazením u jednotlivých pracovníků.';

alter table public.provize_platby_firem enable row level security;

-- Do provizí smí jen správce — sekci Provize v appce nikdo jiný ani neotevře.
drop policy if exists provize_platby_firem_admin on public.provize_platby_firem;
create policy provize_platby_firem_admin on public.provize_platby_firem
  for all to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'admin'));

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select firma, period_key, paid, paid_at
--   from public.provize_platby_firem order by period_key desc, firma;
