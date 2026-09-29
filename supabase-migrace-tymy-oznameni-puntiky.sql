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
-- 5) KÓDY K UBYTOVÁNÍ JEN PRO TOHO ČLOVĚKA
--    Kódy od domu a pokyny se stěhují z profilu do vlastní tabulky, kterou
--    vidí jen správce a ten jeden pracovník. Profily si totiž přečte každý
--    přihlášený, takže kódy v profilu by vyčetl i kolega. Adresa ubytování
--    v profilu zůstává (tu smí vidět i odběratel).
--
-- DATA SE NEMAŽOU. Jediná změna v existujících datech: případné kódy
-- zapsané do profilu se PŘESTĚHUJÍ do nové tabulky a v profilu se vymažou
-- (aby tam nezůstaly čitelné). Spustit se dá klidně víckrát.
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

-- Funkce pro pracovníka: „chce moje firma docházku jen s polohou?"
-- Vrací JEN ano/ne o firmě přihlášeného — pracovník tak nepotřebuje právo
-- číst tabulku firem. security definer, proto pevná search_path.
create or replace function public.muj_zapis_jen_gps()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select t.zapis_jen_gps
      from public.teams t
      join public.profiles p on p.team_id = t.id
     where p.id = auth.uid()
  ), false)
$$;
revoke all on function public.muj_zapis_jen_gps() from public, anon;
grant execute on function public.muj_zapis_jen_gps() to authenticated;

-- Odchylka od běžné pracovní doby, kterou správce označil „v pořádku".
-- Jen značka pro výkaz správce — na hodiny ani faktury vliv nemá.
alter table public.attendance add column if not exists odchylka_ok boolean not null default false;
comment on column public.attendance.odchylka_ok is
  'Správce označil odchylku od běžné pracovní doby firmy jako v pořádku.';

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

-- ── 5. Kódy k ubytování ──────────────────────────────────────────────
create table if not exists public.ubytovani_kody (
  worker_id   uuid primary key references public.profiles(id) on delete cascade,
  kody        text,
  upraveno_v  timestamptz not null default now(),
  upravil     uuid references public.profiles(id) on delete set null
);
comment on table public.ubytovani_kody is
  'Kódy od domu a pokyny k ubytování. Vidí je jen správce a ten pracovník — NIKDY odběratel.';

revoke all on public.ubytovani_kody from anon, authenticated, public;
grant select, insert, update, delete on public.ubytovani_kody to authenticated;
alter table public.ubytovani_kody enable row level security;

drop policy if exists "ubytovani_kody: spravuje spravce" on public.ubytovani_kody;
create policy "ubytovani_kody: spravuje spravce"
  on public.ubytovani_kody for all to authenticated
  using ((select public.je_spravce())) with check ((select public.je_spravce()));

-- Pracovník SVOJE jen čte. Zapsat ani smazat nesmí — kódy dává SubBau.
drop policy if exists "ubytovani_kody: svoje vidi pracovnik" on public.ubytovani_kody;
create policy "ubytovani_kody: svoje vidi pracovnik"
  on public.ubytovani_kody for select to authenticated
  using (worker_id = (select auth.uid()));

-- Přestěhování z profilu. „on conflict do nothing": kdo už v nové tabulce
-- řádek má, tomu se nic nepřepíše — proto se to dá pustit víckrát.
insert into public.ubytovani_kody (worker_id, kody)
select p.id, p.ubytovani_poznamka
  from public.profiles p
 where coalesce(btrim(p.ubytovani_poznamka), '') <> ''
on conflict (worker_id) do nothing;

-- A z profilu pryč, ať kódy nezůstanou čitelné pro každého přihlášeného.
-- Maže se jen tam, kde je kopie v nové tabulce — jinak by šlo o data přijít.
update public.profiles p
   set ubytovani_poznamka = null
 where coalesce(btrim(p.ubytovani_poznamka), '') <> ''
   and exists (select 1 from public.ubytovani_kody k where k.worker_id = p.id);

comment on column public.profiles.ubytovani_poznamka is
  'NEPOUŽÍVÁ SE. Kódy k ubytování jsou v tabulce ubytovani_kody.';

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi ten výpis celý. Řádky „sloupec:" musí být ŠEST, „funkce"
-- jedna, tabulky puntiky a ubytovani_kody po DVOU pravidlech a „kódy
-- zbylé v profilech" musí být 0. Poslední řádky ukážou, jak jsou
-- nastavená pravidla ČTENÍ profilů — to potřebuju vidět.
select 'sloupec: ' || table_name || '.' || column_name as co, data_type as podrobnost
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'teams' and column_name in ('zapis_jen_gps','prac_doba_od','prac_doba_do'))
     or (table_name = 'notifications' and column_name in ('vyzaduje_potvrzeni','potvrzeno_v'))
     or (table_name = 'attendance' and column_name = 'odchylka_ok'))
union all
select 'funkce muj_zapis_jen_gps', 'ANO'
  from pg_proc where proname = 'muj_zapis_jen_gps' and pronamespace = 'public'::regnamespace
union all
select 'tabulka ' || tablename || ', pravidel: ' || count(*)::text, 'RLS'
  from pg_policies where schemaname = 'public' and tablename in ('puntiky','ubytovani_kody')
 group by tablename
union all
select 'kódy přestěhované do ubytovani_kody', count(*)::text from public.ubytovani_kody
union all
select 'kódy zbylé v profilech', count(*)::text
  from public.profiles where coalesce(btrim(ubytovani_poznamka), '') <> ''
union all
select 'ČTENÍ profilů: ' || policyname, coalesce(qual, '(bez podmínky)')
  from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd in ('SELECT','ALL')
 order by 1;
