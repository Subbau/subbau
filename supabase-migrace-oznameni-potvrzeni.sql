-- =====================================================================
-- OZNÁMENÍ: „POROZUMĚL JSEM" I U TOHO, KDO ČERVENÉ ZAVŘEL KŘÍŽKEM
--
-- 30. 9. 2026 šlo červené oznámení v telefonu omylem zavřít křížkem (appka
-- to od verze 2026-09-30 d už nedovolí). Kdo to udělal, má v tabulce
-- „kdo co odklikl" (oznameni_precteno) jen „zavřel" — a „Porozuměl jsem"
-- pak nešlo uložit, protože řádek už byl a měnit ho pracovník nesměl.
--
-- Tohle pracovníkovi dovolí JEDINOU věc: SVŮJ řádek přepnout na
-- „potvrzeno". Cizí řádek změnit nesmí, potvrzení vzít zpět nesmí a jiné
-- sloupce než „potvrzeno" a čas taky ne.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Spustit se dá klidně víckrát.
-- Potřebuje, aby už proběhla supabase-migrace-oznameni-komu.sql (proběhla 30. 9.).
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

grant update (potvrzeno, kdy) on public.oznameni_precteno to authenticated;

drop policy if exists "oznameni_precteno: potvrdi jen sam za sebe" on public.oznameni_precteno;
create policy "oznameni_precteno: potvrdi jen sam za sebe" on public.oznameni_precteno
  for update to authenticated
  using (worker_id = (select auth.uid()))
  with check (worker_id = (select auth.uid()) and potvrzeno);

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. Mají tam být ČTYŘI řádky „pravidlo:" (mezi nimi
-- „potvrdi jen sam za sebe (UPDATE)") a DVA řádky „smí měnit sloupec:"
-- (kdy a potvrzeno).
select 'pravidlo: ' || policyname || ' (' || cmd || ')' as co,
       coalesce(qual, '') || coalesce(' / ' || with_check, '') as podrobnost
  from pg_policies where schemaname = 'public' and tablename = 'oznameni_precteno'
union all
select 'smí měnit sloupec: ' || column_name, privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'oznameni_precteno'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by 1;
