-- =====================================================================
-- RUČNÍ ZÁSAH DO VÝPLATY ZA DEN MĚNÍ JEN SPRÁVCE
--
-- CO SE NAŠLO (audit 16. 10. 2026): appka nikde v appce ani v RLS nehlídá,
-- že by si pracovník přes přímé volání API (ne přes appku — ta mu to
-- tlačítko ani neukáže) mohl sám sobě na vlastním řádku docházky nastavit
--   • vyplata_castka   — ruční částka za den místo hodiny × sazba,
--   • bez_vyplaty      — den se do výplaty vůbec nepočítá,
--   • bez_provize_den  — den se nepočítá do provize SubBau.
-- Appka tahle tři pole píše VÝHRADNĚ ze dvou správcovských míst (úprava dne
-- a srážka za černé puntíky) — v žádném pracovníkově vlastním zápisu
-- (příchod, odchod, oprava vlastního dne) se nepoužívají, takže zámek
-- nic neomezí v běžném provozu.
--
-- CO TOHLE NEŘEŠÍ (vědomě): total_hours a team_id appka naopak BĚŽNĚ píše
-- přímo z pracovníkova telefonu (příchod/odchod, oprava vlastního dne) —
-- zámek na ně „vrať se na starou hodnotu" by rovnou rozbil normální zápis
-- docházky všem. Potřebovalo by to jiné řešení (dopočet na straně databáze
-- ze stejného vzorce, jaký má appka) a je to samostatná, opatrnější práce.
--
-- CO TO DĚLÁ: vyplata_castka, bez_vyplaty a bez_provize_den na attendance
-- smí změnit jen
--   • správce (role admin) — v appce v úpravě dne nebo u srážky,
--   • server se servisním klíčem — serverové funkce,
--   • zápis přímo v Supabase (SQL Editor) — tam pracovník nemá heslo.
-- Komukoli jinému se hodnota potichu vrátí na starou (při UPDATE), nebo
-- zůstane prázdná/false (při INSERT) — stejný princip jako u zámku skupiny
-- v profilech (supabase-migrace-zamek-party.sql).
--
-- V APPCE SE NIC NEMĚNÍ. Přidává se jedna funkce a jeden hlídač na
-- attendance. Na konci skript zámek vyzkouší na jednom řádku a zkoušku
-- hned vrátí zpátky — nic z ní se neuloží. Spustit se dá klidně víckrát.
-- Když cokoli selže, neuloží se nic.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Hláška „lock timeout" znamená, že s docházkou zrovna někdo pracoval;
-- stačí pustit znovu.
-- =====================================================================

begin;

set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $$
begin
  if to_regclass('public.attendance') is null then
    raise exception 'Chybí tabulka attendance. Nic se nezměnilo.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'attendance'
         and column_name in ('vyplata_castka', 'bez_vyplaty', 'bez_provize_den')) <> 3 then
    raise exception 'V attendance chybí sloupec vyplata_castka, bez_vyplaty nebo bez_provize_den. Nic se nezměnilo.';
  end if;
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'V profilech není nikdo s rolí admin — výplatu by pak nesměl opravit nikdo. Nic se nezměnilo.';
  end if;
end $$;

-- ── 1. Hlídač ────────────────────────────────────────────────────────
create or replace function public.attendance_zamek_vyplaty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
begin
  -- Žádné ze tří polí se nemění → není co hlídat.
  if tg_op = 'UPDATE'
     and new.vyplata_castka  is not distinct from old.vyplata_castka
     and new.bez_vyplaty     is not distinct from old.bez_vyplaty
     and new.bez_provize_den is not distinct from old.bez_provize_den then
    return new;
  end if;
  -- Nový řádek bez ručního zásahu (tak vypadá každý běžný příchod) → v pořádku.
  if tg_op = 'INSERT'
     and new.vyplata_castka is null
     and coalesce(new.bez_vyplaty, false) = false
     and coalesce(new.bez_provize_den, false) = false then
    return new;
  end if;

  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  -- Server se servisním klíčem.
  if v_claims <> '' and (v_claims::jsonb ->> 'role') = 'service_role' then
    return new;
  end if;

  -- Zápis přímo v Supabase (SQL Editor, tabulky): žádné přihlášení z appky.
  if v_claims = ''
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
     and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Správce (role admin).
  if exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.role = 'admin') then
    return new;
  end if;

  -- Kdokoli jiný: nový řádek nedostane žádný ruční zásah…
  if tg_op = 'INSERT' then
    new.vyplata_castka  := null;
    new.bez_vyplaty     := false;
    new.bez_provize_den := false;
    return new;
  end if;
  -- …stávající zůstává, jak byl.
  new.vyplata_castka  := old.vyplata_castka;
  new.bez_vyplaty     := old.bez_vyplaty;
  new.bez_provize_den := old.bez_provize_den;
  return new;
end $$;

comment on function public.attendance_zamek_vyplaty() is
  'Ruční částku za den, bez_vyplaty a bez_provize_den na attendance mění jen správce, server nebo zápis přímo v Supabase — ne pracovník sám sobě.';

revoke all on function public.attendance_zamek_vyplaty() from public, anon, authenticated;

drop trigger if exists attendance_zamek_vyplaty_trg on public.attendance;
create trigger attendance_zamek_vyplaty_trg
  before insert or update of vyplata_castka, bez_vyplaty, bez_provize_den on public.attendance
  for each row execute function public.attendance_zamek_vyplaty();

-- ── 2. Zkouška naostro, která se hned vrátí ─────────────────────────
do $$
declare
  v_den     uuid;
  v_prac    uuid;
  v_castka  numeric;
  v_bv      boolean;
  v_bp      boolean;
  v_spravce uuid;
  v_po_c    numeric;
  v_po_bv   boolean;
  v_kdo     text;
  v_claims  text;
  v_vysl    text;
begin
  select a.id, a.worker_id, a.vyplata_castka, a.bez_vyplaty, a.bez_provize_den
    into v_den, v_prac, v_castka, v_bv, v_bp
    from public.attendance a
   order by a.id
   limit 1;
  select p.id into v_spravce from public.profiles p where p.role = 'admin' order by p.id limit 1;

  foreach v_kdo in array array['pracovnik', 'spravce', 'server', 'editor'] loop
    if v_den is null then
      v_vysl := 'nebylo na kom vyzkoušet';
    else
      v_claims := case v_kdo
        when 'pracovnik' then json_build_object('sub', v_prac, 'role', 'authenticated')::text
        when 'spravce'   then json_build_object('sub', v_spravce, 'role', 'authenticated')::text
        when 'server'    then json_build_object('role', 'service_role')::text
        else '' end;
      begin
        perform set_config('request.jwt.claims', v_claims, true);
        perform set_config('request.jwt.claim.sub', '', true);
        update public.attendance
           set vyplata_castka = coalesce(v_castka, 0) + 1,
               bez_vyplaty = not coalesce(v_bv, false)
         where id = v_den;
        select a.vyplata_castka, a.bez_vyplaty into v_po_c, v_po_bv
          from public.attendance a where a.id = v_den;
        v_vysl := case when v_po_c is not distinct from v_castka and v_po_bv is not distinct from v_bv
                       then 'nezměnil' else 'změnil' end;
        raise exception using errcode = 'ZK002', message = 'zkouška se vrací';
      exception
        when sqlstate 'ZK002' then null;
        when others then v_vysl := 'chyba: ' || sqlerrm;
      end;
    end if;
    perform set_config('subbau.zamek_vyplaty_' || v_kdo, v_vysl, false);
  end loop;

  if v_den is not null then
    select a.vyplata_castka, a.bez_vyplaty into v_po_c, v_po_bv
      from public.attendance a where a.id = v_den;
    if v_po_c is distinct from v_castka or v_po_bv is distinct from v_bv then
      raise exception 'Zkouška po sobě neuklidila (výplata dne se změnila). Nic se neuložilo, pošlete mi prosím tuhle hlášku.';
    end if;
  end if;

  if current_setting('subbau.zamek_vyplaty_spravce') = 'nezměnil' then
    raise exception 'Zámek by zablokoval i správce — úprava dne by nešla uložit. Nic se nezměnilo, pošlete mi prosím tuhle hlášku.';
  end if;
end $$;

commit;


-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. První řádek má být „OK". Zkouška: pracovník
-- „nezměnil", správce, server a SQL Editor „změnil". Když je první řádek
-- „POZOR", pod ním jsou řádky „problém" s tím, co nesedí.
with
hlidac as (
  select t.tgenabled, p.proname, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as pevna_cesta,
         has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute') as zvenku,
         (select count(*) from pg_attribute a
            where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
              and a.attname in ('vyplata_castka', 'bez_vyplaty', 'bez_provize_den')) = 3 as vsechna_pole
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.attendance'::regclass
     and t.tgname = 'attendance_zamek_vyplaty_trg'
     and not t.tgisinternal
),
zkousky as (
  select x.poradi, x.kdo, x.ceka,
         coalesce(nullif(current_setting('subbau.zamek_vyplaty_' || x.klic, true), ''),
                  'neví se — zkouška neběžela') as vysl
    from (values (3, 'pracovnik', 'zkouška: pracovník mění svůj den', 'nezměnil'),
                 (4, 'spravce',   'zkouška: správce mění den',         'změnil'),
                 (5, 'server',    'zkouška: server (servisní klíč)',   'změnil'),
                 (6, 'editor',    'zkouška: SQL Editor',               'změnil'))
         as x(poradi, klic, kdo, ceka)
),
problemy as (
  select 1 as k, 'hlídač attendance_zamek_vyplaty_trg CHYBÍ' as popis
   where not exists (select 1 from hlidac)
  union all
  select 2, 'hlídač je VYPNUTÝ' from hlidac where hlidac.tgenabled not in ('O', 'A')
  union all
  select 5, 'hlídač nehlídá všechna tři pole' from hlidac where not hlidac.vsechna_pole
  union all
  select 6, 'funkce neběží s právy vlastníka (security definer)' from hlidac where not hlidac.prosecdef
  union all
  select 7, 'funkce nemá pevnou search_path' from hlidac where not hlidac.pevna_cesta
  union all
  select 8, 'funkci jde spustit zvenku (anon/authenticated)' from hlidac where hlidac.zvenku
  union all
  select 9, z.kdo || ': ' || z.vysl
    from zkousky z where z.vysl <> z.ceka and z.vysl <> 'nebylo na kom vyzkoušet'
)
select left(v.co, 100) as co, left(v.podrobnost, 100) as podrobnost
  from (
    select 0 as poradi, '' as pod,
           case when exists (select 1 from problemy) then 'POZOR' else 'OK' end as co,
           case when exists (select 1 from problemy)
                then (select count(*) from problemy) || ' problém(y) — viz řádky „problém" níž'
                else 'ruční výplatu dne mění jen správce, server nebo SQL Editor; pracovník ne'
           end as podrobnost
    union all
    select 1, lpad(pr.k::text, 3, '0'), 'problém', pr.popis from problemy pr
    union all
    select 2, '', 'hlídač (trigger)',
           coalesce((select case when hlidac.tgenabled in ('O', 'A')
                                 then 'zapnutý — attendance_zamek_vyplaty_trg na attendance'
                                 else 'VYPNUTÝ' end from hlidac), 'CHYBÍ')
    union all
    select 4, z.poradi::text, z.kdo,
           z.vysl || case when z.vysl = z.ceka then ' — v pořádku (zkouška vrácena, nic se neuložilo)'
                          else '' end
      from zkousky z
    union all
    select 6, '', 'řádků s ručním zásahem',
           count(*) filter (where vyplata_castka is not null or bez_vyplaty or bez_provize_den)::text
           || ' z ' || count(*) || ' (nic se neměnilo)'
      from public.attendance
  ) as v
 order by v.poradi, v.pod;
