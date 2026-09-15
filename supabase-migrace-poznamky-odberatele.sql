-- =====================================================================
-- POZNÁMKY ODBĚRATELE — fotka, poznámka a známka u pracovníka
--
-- CO TO DĚLÁ: odběratel si v odkazu může u každého člověka nastavit
-- profilovou fotku, napsat si poznámku a dát známku 1 až 6 (1 nejlepší).
-- Slouží to jemu — ať pozná, kdo je kdo, a udrží si přehled.
--
-- KAŽDÝ ODKAZ MÁ SVOJE. Když máte víc odběratelů, jeden nevidí, co si
-- napsal druhý. Klíčem je dvojice odkaz + pracovník.
--
-- DO DATABÁZE PRACOVNÍKŮ TO NESAHÁ. Fotka ani známka se nikde nepropíše
-- do profilu — pracovník o nich neví a v appce je nikdo neuvidí.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jedna nová tabulka.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

create table if not exists public.client_link_workers (
  link_id    uuid not null references public.client_links(id) on delete cascade,
  worker_id  uuid not null references public.profiles(id)     on delete cascade,
  -- Fotka se ukládá rovnou sem jako obrázek zmenšený v prohlížeči (data URI).
  -- Schválně ne do úložiště souborů: tam by se musel otevřít zápis komukoli
  -- s odkazem, a to je díra, kterou nechceme. Velikost hlídá server.
  foto       text,
  poznamka   text,
  -- Německé školní známkování: 1 nejlepší, 6 nejhorší.
  hodnoceni  smallint check (hodnoceni between 1 and 6),
  upraveno   timestamptz not null default now(),
  primary key (link_id, worker_id)
);

comment on table public.client_link_workers is
  'Co si odběratel poznamenal u pracovníka v odkazu: fotka, poznámka, známka 1–6.
   Patří to odkazu, ne pracovníkovi — jiný odběratel to nevidí a v appce se to nezobrazuje.';

create index if not exists client_link_workers_link on public.client_link_workers (link_id);

-- Do tabulky vidí jen správce. Odběratel k ní nemá přímý přístup — zapisuje
-- přes serverovou funkci, která ověří odkaz a povolí jen jeho vlastní lidi.
alter table public.client_link_workers enable row level security;

drop policy if exists client_link_workers_admin on public.client_link_workers;
create policy client_link_workers_admin on public.client_link_workers
  for all to authenticated
  using (public.je_admin()) with check (public.je_admin());

-- ---------------------------------------------------------------------
-- ODFAJFKOVANÉ TÝDNY
-- Odběratel si u týdne odškrtne, že za něj má uhrazené faktury. Je to
-- jeho vlastní přehled — SubBau to vidí, ale s placením v appce (sekce
-- Provize, „uhrazeno") to nemá nic společného a nic tam nepřepisuje.
-- ---------------------------------------------------------------------

create table if not exists public.client_link_weeks (
  link_id   uuid not null references public.client_links(id) on delete cascade,
  kw        smallint not null check (kw between 1 and 53),
  rok       smallint not null check (rok between 2020 and 2100),
  uhrazeno  boolean not null default false,
  upraveno  timestamptz not null default now(),
  primary key (link_id, kw, rok)
);

comment on table public.client_link_weeks is
  'Týdny, které si odběratel v odkazu odškrtl jako uhrazené. Jen jeho přehled —
   do plateb v Provizích to nezasahuje.';

alter table public.client_link_weeks enable row level security;

drop policy if exists client_link_weeks_admin on public.client_link_weeks;
create policy client_link_weeks_admin on public.client_link_weeks
  for all to authenticated
  using (public.je_admin()) with check (public.je_admin());

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='client_link_workers'
--  order by ordinal_position;
