-- =====================================================================
-- POZNÁMKY K DNI (12. 11. 2026)
--
-- U člověka v dnešním přehledu docházky jde napsat poznámku k jednomu dni
-- („nemá telefon — rozbitý", „přesouvá se na stavbu"). Platí jen na ten den,
-- v historii ale zůstává (v profilu pracovníka u docházky).
--
-- Vidí je jen správci SubBau a Monika ze Stavbyplánu (přes odkaz s klíčem
-- Stavbyplánu — ten zapisuje server s klíčem, ne prohlížeč). Pracovník ani
-- odběratel ne: tabulka nemá žádné pravidlo pro ně.
--
-- Na člověka a den jich může být víc, každá se jménem autora a časem.
-- Svou poznámku smí upravit jen její autor; smazat smí autor i kterýkoli správce.
-- Poznámky Moniky (zdroj = 'stavbyplan') mění jen server přes odkaz.
--
-- Pravidla jdou přes (select public.je_admin()) — funkce je SECURITY DEFINER,
-- takže se nic nezacyklí (viz supabase-migrace-profiles-rekurze.sql).
--
-- Bezpečné spustit i opakovaně. Appka funguje i bez této migrace — jen ukáže
-- „poznámky zatím nejdou".
-- =====================================================================
do $$
begin
  if to_regprocedure('public.je_admin()') is null then
    raise exception 'Chybí funkce je_admin() — nejdřív spusťte supabase-migrace-profiles-rekurze.sql. Nic se nezměnilo.';
  end if;
end $$;

create table if not exists public.poznamky_dne (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  den         date not null,
  text        text not null check (char_length(btrim(text)) between 1 and 1000),
  autor_id    uuid references public.profiles(id) on delete set null,
  autor_jmeno text not null check (char_length(btrim(autor_jmeno)) between 1 and 120),
  zdroj       text not null default 'spravce' check (zdroj in ('spravce', 'stavbyplan')),
  vytvoreno   timestamptz not null default now(),
  upraveno    timestamptz not null default now()
);

create index if not exists poznamky_dne_den_idx    on public.poznamky_dne (den);
create index if not exists poznamky_dne_worker_idx on public.poznamky_dne (worker_id, den);

alter table public.poznamky_dne enable row level security;

drop policy if exists "poznamky_dne: cte spravce" on public.poznamky_dne;
create policy "poznamky_dne: cte spravce"
  on public.poznamky_dne for select to authenticated
  using ((select public.je_admin()));

drop policy if exists "poznamky_dne: vklada spravce" on public.poznamky_dne;
create policy "poznamky_dne: vklada spravce"
  on public.poznamky_dne for insert to authenticated
  with check ((select public.je_admin()) and zdroj = 'spravce' and autor_id = (select auth.uid()));

drop policy if exists "poznamky_dne: upravuje autor" on public.poznamky_dne;
create policy "poznamky_dne: upravuje autor"
  on public.poznamky_dne for update to authenticated
  using ((select public.je_admin()) and zdroj = 'spravce' and autor_id = (select auth.uid()))
  with check ((select public.je_admin()) and zdroj = 'spravce' and autor_id = (select auth.uid()));

drop policy if exists "poznamky_dne: maze spravce" on public.poznamky_dne;
create policy "poznamky_dne: maze spravce"
  on public.poznamky_dne for delete to authenticated
  using ((select public.je_admin()));

comment on table public.poznamky_dne is
  'Poznámky správců a Moniky ke dni u pracovníka. Pracovník ani odběratel je nevidí.';

-- Kontrola (mělo by vypsat tabulku se 4 pravidly):
select count(*) as "pravidel na poznamky_dne"
  from pg_policies where schemaname = 'public' and tablename = 'poznamky_dne';
