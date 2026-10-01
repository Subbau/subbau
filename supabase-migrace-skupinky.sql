-- =====================================================================
-- UBYTOVÁNÍ A AUTA (SKUPINKY)
--
-- CO TO DĚLÁ: majitel 1. 10. 2026 — „vytvářet skupinky, každý může mít i víc
-- těch skupinek, a podle toho se ty lidi budou řadit k sobě, že jsou na jednom
-- ubytování nebo jedou spolu v autě" a „sekce ubytování: adresa, název, počet
-- míst celkem, dám tam ty lidi a přiřadím jim barvu té skupiny".
--
-- Dvě nové tabulky:
--   skupinky       — ubytování nebo auto: název, adresa, počet míst, barva
--   skupinky_lide  — kdo do které patří. V jednom ubytování a v jednom autě
--                    je člověk vždycky jen jednou (unikátní index), ubytování
--                    a auto může mít zároveň.
-- Vidí a mění to JEN SPRÁVCE (je_spravce()). Pracovník ani odběratel do
-- tabulek nevidí; adresu ubytování dostanou jako dosud z profilu.
--
-- ŽÁDNÁ STÁVAJÍCÍ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

create table if not exists public.skupinky (
  id uuid primary key default gen_random_uuid(),
  druh text not null default 'ubytovani' check (druh in ('ubytovani', 'auto')),
  nazev text not null check (length(btrim(nazev)) between 1 and 120),
  adresa text check (adresa is null or length(adresa) <= 300),
  pocet_mist integer check (pocet_mist is null or pocet_mist between 0 and 500),
  barva text check (barva is null or barva ~ '^#[0-9a-fA-F]{6}$'),
  poznamka text check (poznamka is null or length(poznamka) <= 1000),
  aktivni boolean not null default true,
  vytvoreno timestamptz not null default now(),
  -- kvůli složenému cizímu klíči ze skupinky_lide (druh musí sedět)
  unique (id, druh)
);

create table if not exists public.skupinky_lide (
  skupinka_id uuid not null,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  druh text not null check (druh in ('ubytovani', 'auto')),
  pridano timestamptz not null default now(),
  primary key (skupinka_id, worker_id),
  foreign key (skupinka_id, druh) references public.skupinky (id, druh) on delete cascade on update cascade
);

-- Jedno ubytování a jedno auto na člověka.
create unique index if not exists skupinky_lide_jeden_druh on public.skupinky_lide (worker_id, druh);

alter table public.skupinky enable row level security;
alter table public.skupinky_lide enable row level security;

revoke all on public.skupinky from anon, authenticated, public;
revoke all on public.skupinky_lide from anon, authenticated, public;
grant select, insert, update, delete on public.skupinky to authenticated;
grant select, insert, update, delete on public.skupinky_lide to authenticated;

drop policy if exists skupinky_jen_spravce on public.skupinky;
create policy skupinky_jen_spravce on public.skupinky
  for all to authenticated using (public.je_spravce()) with check (public.je_spravce());

drop policy if exists skupinky_lide_jen_spravce on public.skupinky_lide;
create policy skupinky_lide_jen_spravce on public.skupinky_lide
  for all to authenticated using (public.je_spravce()) with check (public.je_spravce());

commit;

-- Kontrola: dvě tabulky, u obou zapnuté RLS a jedna politika.
select c.relname as tabulka, c.relrowsecurity as rls_zapnute,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politik
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('skupinky', 'skupinky_lide')
 order by 1;
