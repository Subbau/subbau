-- =====================================================================
-- Výkon správcovských sekcí při 200 lidech (12. 11. 2026)
--
-- 1) Funkce tymy_tydny_pdf(): týdny s docházkou po skupinách JEDNÍM dotazem.
--    Sekce Týmy dřív pro každou skupinu stahovala po stránkách celou historii
--    docházky (desítky dotazů, několik MB) jen proto, aby poskládala nabídku
--    „Týden 45/2026" u tlačítka Vygenerovat PDF. Appka funkci použije, když
--    existuje; bez ní jede původní (pomalejší) cesta, nic se nerozbije.
--    Funkce běží s právy volajícího (security invoker) — vidí jen to, co mu
--    pustí RLS u tabulky attendance, stejně jako dosavadní dotazy.
--
-- 2) Indexy pro dotazy, které správcovské sekce posílají nejčastěji.
--    Každý se vytvoří JEN když v tabulce už není index se stejným seznamem
--    sloupců (pod jakýmkoli názvem) — spustit lze opakovaně.
--
-- Spuštění: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

create or replace function public.tymy_tydny_pdf()
returns table (team_id uuid, kw integer, kw_year integer, worker_ids uuid[])
language sql
stable
security invoker
set search_path = public
as $$
  select a.team_id::uuid,
         a.kw::integer,
         a.kw_year::integer,
         array_agg(distinct a.worker_id)::uuid[]
    from public.attendance a
   where a.kw is not null and a.kw_year is not null
   group by a.team_id, a.kw, a.kw_year
$$;

revoke all on function public.tymy_tydny_pdf() from public;
grant execute on function public.tymy_tydny_pdf() to authenticated;

-- ---------------------------------------------------------------------
-- Indexy (jen když ještě nejsou)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- tabulka, seznam sloupců (přesně jak je vypíše pg_indexes), příkaz
      ('attendance', '(work_date)',                  'create index if not exists attendance_work_date_idx on public.attendance (work_date)'),
      ('attendance', '(kw_year, kw)',                'create index if not exists attendance_kw_year_kw_idx on public.attendance (kw_year, kw)'),
      ('attendance', '(team_id, kw_year, kw)',       'create index if not exists attendance_team_kw_idx on public.attendance (team_id, kw_year, kw)'),
      ('attendance', '(worker_id, work_date)',       'create index if not exists attendance_worker_date_idx on public.attendance (worker_id, work_date)'),
      ('historie_uprav', '(tabulka, zaznam_id)',     'create index if not exists historie_uprav_tabulka_zaznam_idx on public.historie_uprav (tabulka, zaznam_id)'),
      ('documents', '(worker_id)',                   'create index if not exists documents_worker_idx on public.documents (worker_id)')
    ) as t(tabulka, sloupce, prikaz)
  loop
    if to_regclass('public.' || r.tabulka) is null then continue; end if;
    if exists (
      select 1 from pg_indexes
       where schemaname = 'public' and tablename = r.tabulka
         and indexdef like '%' || r.sloupce || '%'
         and indexdef not like '%WHERE%'
         -- shoda jen když seznam sloupců začíná tady (ne „(a, b)" uvnitř delšího)
         and position('(' in indexdef) > 0
         and substring(indexdef from '\(.*$') = r.sloupce
    ) then continue; end if;
    begin
      execute r.prikaz;
    exception when undefined_column then
      raise notice 'Přeskočeno (sloupec v tabulce chybí): %', r.prikaz;
    end;
  end loop;
end $$;

-- Rozdělané (otevřené) směny hledá nástěnka a Pracovníci bez omezení data —
-- malý částečný index drží jen záznamy bez odchodu.
do $$
begin
  if to_regclass('public.attendance') is not null
     and not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'attendance' and indexname = 'attendance_otevrene_idx') then
    begin
      create index attendance_otevrene_idx on public.attendance (work_date desc)
        where check_out is null and check_in is not null;
    exception when undefined_column then
      raise notice 'Přeskočeno (sloupec v tabulce chybí): attendance_otevrene_idx';
    end;
  end if;
end $$;

notify pgrst, 'reload schema';
