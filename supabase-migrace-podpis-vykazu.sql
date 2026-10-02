-- =====================================================================
-- FIRMA BEZ PODPISU VÝKAZU HODIN (majitel 2. 10. 2026)
-- U firmy zaškrtnuté v Týmech lidé výkaz hodin nepodepisují: appka jim
-- schová podpis vedoucího, výkaz k podpisu i páteční červené připomenutí
-- a ukáže větu, že hodiny vedeme elektronicky každý den.
--
-- Přidává se jeden sloupec u firem (výchozí = podepisuje se jako dosud)
-- a jedna funkce, přes kterou se pracovník dozví jen ano/ne o své firmě —
-- stejně jako u „jen s polohou" (muj_zapis_jen_gps). Žádná data se nemění
-- ani nemažou. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.companies add column if not exists bez_podpisu_vykazu boolean not null default false;

comment on column public.companies.bez_podpisu_vykazu is
  'True = lidé ve všech skupinách téhle firmy výkaz hodin nepodepisují (hodiny se vedou elektronicky). Majitel 2. 10. 2026.';

-- security definer: pracovník nepotřebuje právo číst firmy ani skupiny,
-- dozví se jen ano/ne o sobě. Proto pevná search_path.
create or replace function public.muj_bez_podpisu_vykazu()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(c.bez_podpisu_vykazu, false)
      from public.profiles p
      left join public.teams t     on t.id = p.team_id
      left join public.companies c on c.id::text = t.company_id::text
     where p.id = auth.uid()
  ), false)
$$;
revoke all on function public.muj_bez_podpisu_vykazu() from public, anon;
grant execute on function public.muj_bez_podpisu_vykazu() to authenticated;

commit;

-- Kontrola (Supabase nevypisuje „raise notice", proto řádek):
-- sloupec = 1, funkce = 1, firem_bez_podpisu = kolik firem už je zaškrtnutých (zatím 0)
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'companies' and column_name = 'bez_podpisu_vykazu') as sloupec,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'muj_bez_podpisu_vykazu') as funkce,
  (select count(*) from public.companies where bez_podpisu_vykazu) as firem_bez_podpisu;
