-- Kdy byla nepřítomnost (dovolená, nemoc, absence) zapsána (12. 11. 2026).
-- Přidá vacations.created_at: nové záznamy dostanou čas zápisu, starší zůstanou prázdné (nevíme, kdy vznikly).
-- Bezpečné spustit opakovaně; nic nemaže ani nepřepisuje. Appka funguje i bez ní (jen nezobrazí „zapsáno …").
do $$
begin
  if to_regclass('public.vacations') is null then
    raise exception 'Tabulka public.vacations neexistuje. Nic se nezměnilo.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'vacations' and column_name = 'created_at') then
    alter table public.vacations add column created_at timestamptz;       -- staré řádky zůstanou NULL
    alter table public.vacations alter column created_at set default now(); -- nové dostanou čas zápisu
  end if;
end $$;

select count(*) as radku, count(created_at) as s_casem_zapisu from public.vacations;
