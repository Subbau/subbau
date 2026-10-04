-- PLÁNOVANÝ PŘESUN MEZI UBYTOVÁNÍMI (majitel 4. 10. 2026)
--
-- „Plánování toho přesunu: dám, že se bude přesouvat — tlačítko — a ty osoby,
-- na který kliknu, se tam zařadí; bude u nich napsaný datum, od kdy se tam
-- budou přesouvat." Ten den se člověk přesune SÁM (i s adresou v profilu).
--
-- CO SE ZAKLÁDÁ
--  • skupinky_presuny — kdo, kam (ubytování nebo auto), od kdy. Jeden plán na
--    člověka a druh: nový plán starý nahradí (unikátní worker_id + druh).
--    Práva stejně jako skupinky_lide: jen správce (je_spravce()).
--  • skupinky_proved_presuny() — provede plány, kterým nastal den: přeřadí
--    člověka (týž zápis jako ruční přesun, upsert worker_id + druh), zapíše mu
--    adresu nového ubytování do profilu a plán smaže. KDO JI SPOUŠTÍ: appka
--    správce při načtení ubytování (jakmile u někoho den nastal) a každé ráno
--    server (Vercel Cron /api/check-expiring-docs, 6:00 UTC = 7–8 h u nás).
--    Pracovníkovi neudělá nic: jeho kroky se do historie úprav nezapisují
--    (jen kancelář), a přesun by tak v historii chyběl.
--  • Plány se zapisují do historie úprav (kdo co naplánoval a zrušil), pokud
--    je historie v databázi (supabase-migrace-historie-uprav.sql).
--
-- Pouští se celé v SQL Editoru (Supabase). Dá se pustit opakovaně.
begin;
-- Kdyby nad profily zrovna někdo zapisoval, migrace po 5 s skončí a nic
-- nezmění (stačí ji pustit znovu) — nečeká věčně a nezdrží ostatní.
set local lock_timeout = '5s';

create table if not exists public.skupinky_presuny (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  cil_skupinka_id uuid not null,
  druh text not null check (druh in ('ubytovani', 'auto')),
  od date not null,
  vytvoreno timestamptz not null default now(),
  vytvoril uuid default auth.uid(),
  -- Cíl je ubytování (nebo auto) TÉHOŽ druhu; zmizí-li, zmizí i plán.
  foreign key (cil_skupinka_id, druh) references public.skupinky (id, druh) on delete cascade on update cascade
);
create unique index if not exists skupinky_presuny_jeden on public.skupinky_presuny (worker_id, druh);

alter table public.skupinky_presuny enable row level security;
revoke all on public.skupinky_presuny from anon, authenticated, public;
grant select, insert, update, delete on public.skupinky_presuny to authenticated;
drop policy if exists skupinky_presuny_jen_spravce on public.skupinky_presuny;
create policy skupinky_presuny_jen_spravce on public.skupinky_presuny
  for all to authenticated using (public.je_spravce()) with check (public.je_spravce());

-- Den se počítá v čase firmy (Praha/Berlín), ne v UTC: v 0:30 našeho času je
-- v UTC ještě včera a přesun „od zítřka" by se provedl o den pozdě.
create or replace function public.skupinky_proved_presuny() returns integer
language plpgsql security definer set search_path = public as $proved$
declare
  r       record;
  v_dnes  date := (now() at time zone 'Europe/Prague')::date;
  v_stara text;
  v_nova  text;
  v_n     integer := 0;
begin
  -- Server a SQL Editor (bez přihlášeného) a správce ano; pracovník nic.
  if auth.uid() is not null and not public.je_spravce() then return 0; end if;
  -- skip locked: dvě appky otevřené v tutéž chvíli neprovedou tentýž plán dvakrát.
  for r in select * from public.skupinky_presuny where od <= v_dnes order by od, vytvoreno for update skip locked loop
    v_stara := (select s.adresa from public.skupinky_lide l join public.skupinky s on s.id = l.skupinka_id
                 where l.worker_id = r.worker_id and l.druh = r.druh);
    -- Do zrušeného (neaktivního) ubytování se nestěhuje a neaktivní člověk
    -- (odebraný přístup, archiv) se nestěhuje nikam — plán se jen smaže.
    if exists (select 1 from public.skupinky s where s.id = r.cil_skupinka_id and s.aktivni)
       and exists (select 1 from public.profiles p where p.id = r.worker_id and p.is_active is not false) then
      v_nova := (select s.adresa from public.skupinky s where s.id = r.cil_skupinka_id);
      insert into public.skupinky_lide (skupinka_id, worker_id, druh) values (r.cil_skupinka_id, r.worker_id, r.druh)
        on conflict (worker_id, druh) do update set skupinka_id = excluded.skupinka_id, pridano = now();
      -- Adresa do profilu jako při ručním přesunu; nové ubytování bez adresy
      -- smaže tu starou, ale jen pokud to byla adresa toho, odkud odešel.
      if r.druh = 'ubytovani' then
        if v_nova is not null then
          update public.profiles set accommodation_address = v_nova where id = r.worker_id;
        elsif v_stara is not null then
          update public.profiles set accommodation_address = null where id = r.worker_id and accommodation_address = v_stara;
        end if;
      end if;
      v_n := v_n + 1;
    end if;
    delete from public.skupinky_presuny where id = r.id;
  end loop;
  return v_n;
end $proved$;

revoke all on function public.skupinky_proved_presuny() from public, anon;
grant execute on function public.skupinky_proved_presuny() to authenticated;
do $server$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.skupinky_proved_presuny() to service_role;
  end if;
end $server$;

-- Historie úprav: kdo co naplánoval a zrušil (a že plán zmizel provedením).
do $hist$
begin
  if to_regprocedure('public.zapis_historie_uprav()') is not null then
    drop trigger if exists historie_uprav_trg on public.skupinky_presuny;
    create trigger historie_uprav_trg after insert or update or delete on public.skupinky_presuny
      for each row execute function public.zapis_historie_uprav('worker_id');
  end if;
end $hist$;

commit;

-- Výsledek (editor ukáže jen tenhle řádek): tabulka | RLS | politik | funkce | historie
select 'skupinky_presuny' as tabulka,
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'skupinky_presuny') as rls_zapnute,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'skupinky_presuny') as politik,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'skupinky_proved_presuny') as funkce,
       exists (select 1 from pg_trigger t where t.tgname = 'historie_uprav_trg' and not t.tgisinternal
                and t.tgrelid = 'public.skupinky_presuny'::regclass) as historie;
