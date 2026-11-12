-- =====================================================================
-- OPRAVA: „infinite recursion detected in policy for relation "profiles"" (12. 11. 2026)
--
-- Příznak: vedení nejde odebrat přístup, nejde přesouvat lidi mezi týmy
-- (každá ÚPRAVA profilu skončí touto chybou).
--
-- Příčina: pravidlo správce pro úpravu profilů (admin_manage_profiles_team)
-- se ptá přímo na tabulku profiles („existuje profil s mou rolí admin?").
-- Po dnešním zrychlení pravidel (obal auth.uid() do `(select …)`) má
-- i pravidlo pro ČTENÍ profilů vnořený dotaz a Postgres pak tuhle
-- sebe-odkazující dvojici odmítne jako nekonečnou smyčku.
--
-- Oprava: dotaz „jsem správce?" jde přes funkci je_admin() (SECURITY DEFINER,
-- čte profil bez pravidel, takže se nic nezacyklí). VÝZNAM SE NEMĚNÍ — stejní
-- lidé smějí stejné věci. Přepíše se jen vnořený dotaz na správce v pravidlech
-- tabulky profiles; ostatní části pravidel zůstanou.
--
-- Bezpečné spustit i opakovaně. Na konci vypíše, co udělalo, a vlastní zkouškou
-- ověří, že úprava/čtení/mazání profilu už pravidla nerozbíjí.
-- =====================================================================
do $$
declare
  p record;
  q text; w text; sql text;
  -- vnořený dotaz „existuje profil (já) s rolí admin" tak, jak ho vypisuje pg_policies
  re_exists constant text :=
    'EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(public\.)?profiles(\s+\w+)?\s+WHERE\s+[^;]*?role\s*=\s*''admin''(::text)?\s*\)\s*\)\s*\)';
  n int := 0;
  zk text;
begin
  create temp table if not exists _sb_rek_vysledek (poradi serial, stav text) on commit drop;

  -- 1. Funkce je_admin(): založit jen když chybí (stávající se nepřepisuje)
  if to_regprocedure('public.je_admin()') is null then
    execute $f$
      create function public.je_admin()
      returns boolean
      language sql
      stable
      security definer
      set search_path = public
      as $b$
        select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      $b$
    $f$;
    execute 'grant execute on function public.je_admin() to authenticated';
    insert into _sb_rek_vysledek (stav) values ('založena funkce je_admin()');
  else
    insert into _sb_rek_vysledek (stav) values ('funkce je_admin() už existuje — nechána');
  end if;

  -- 2. Pravidla na profiles, která se ptají sama na sebe
  for p in
    select policyname, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'profiles'
       and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'FROM\s+(public\.)?profiles'
  loop
    q := p.qual; w := p.with_check;
    if q is not null then q := regexp_replace(q, re_exists, '(SELECT public.je_admin())', 'gi'); end if;
    if w is not null then w := regexp_replace(w, re_exists, '(SELECT public.je_admin())', 'gi'); end if;
    if q is not distinct from p.qual and w is not distinct from p.with_check then
      insert into _sb_rek_vysledek (stav) values ('POZOR — nepoznaný tvar, nezměněno: ' || p.policyname);
      continue;
    end if;
    sql := format('alter policy %I on public.profiles', p.policyname)
        || case when q is not null then format(' using (%s)', q) else '' end
        || case when w is not null then format(' with check (%s)', w) else '' end;
    begin
      execute sql;
      n := n + 1;
      insert into _sb_rek_vysledek (stav) values ('opraveno: ' || p.policyname);
    exception when others then
      insert into _sb_rek_vysledek (stav) values ('NEPODAŘILO SE: ' || p.policyname || ' — ' || sqlerrm);
    end;
  end loop;
  insert into _sb_rek_vysledek (stav) values ('celkem opraveno pravidel: ' || n);

  -- 3. Zkouška: plán úpravy/čtení/mazání profilu pod rolí přihlášeného (nic se nezapíše)
  foreach zk in array array[
    'explain update public.profiles set id = id where false',
    'explain select 1 from public.profiles where false',
    'explain delete from public.profiles where false'
  ] loop
    begin
      set local role authenticated;
      execute zk;
      reset role;
      insert into _sb_rek_vysledek (stav) values ('ZKOUŠKA OK: ' || split_part(zk, ' ', 2));
    exception when others then
      reset role;
      insert into _sb_rek_vysledek (stav) values ('ZKOUŠKA SELHALA: ' || split_part(zk, ' ', 2) || ' — ' || sqlerrm);
    end;
  end loop;
end $$;

select stav as "co se stalo" from _sb_rek_vysledek order by poradi;

-- Kontrola: pravidla na profiles, která se pořád odkazují na profiles (mělo by být prázdné)
select policyname as "pravidlo, které se pořád ptá na profiles", cmd
  from pg_policies
 where schemaname = 'public' and tablename = 'profiles'
   and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'FROM\s+(public\.)?profiles';
