-- =====================================================================
-- SKUPINU A PODSKUPINU PRACOVNÍKA MĚNÍ JEN SPRÁVCE
--
-- CO SE NAŠLO: podle skupiny a podskupiny (v Týmech) appka pozná, jestli
-- pracovník zapisuje docházku „jen s polohou". Každý pracovník ale smí
-- upravovat svůj vlastní řádek v profilech — ukládá si tak telefon, fotku
-- nebo fakturační údaje. Pravidla v databázi platí na celý řádek, ne na
-- jednotlivé údaje, a zámky, které už na profilu jsou (role, zaměstnavatel,
-- režim přestávky), skupinu nehlídají. Kdo umí z prohlížeče poslat jeden
-- příkaz, přeřadí se sám do skupiny bez polohy nebo ze skupiny úplně ven.
-- Appka ho pak pustí zapsat příchod i odchod bez polohy. Stejně tak by se
-- sám přesunul pod jinou firmu (provize, odběratel na faktuře, odkaz pro
-- odběratele, zprávy „celé firmě").
--
-- CO TO DĚLÁ: skupinu a podskupinu v profilu smí změnit jen
--   • správce (role admin) — v appce v Týmech,
--   • server se servisním klíčem — CRM a serverové funkce,
--   • zápis přímo v Supabase (SQL Editor, tabulky) — tam se pracovník
--     nedostane, potřeboval by heslo k databázi.
-- Komukoli jinému se hodnota potichu vrátí: nový profil začne bez
-- skupiny, stávající má dál tu, kterou měl. Stejně jako u zámku role.
-- Jediná výjimka: když skupina nebo podskupina zmizí (smaže se), odkaz
-- na ni se z profilu vymaže vždy — jinak by profil ukazoval do prázdna.
--
-- V APPCE SE NIC NEMĚNÍ: skupiny i dosud přiděluje jen správce v Týmech.
-- Pracovník si skupinu nevolí nikde — ani při registraci (ta skupinu
-- neposílá, přidělí ji správce). Ostatní údaje (jméno, telefon, fotka,
-- ubytování, fakturační údaje…) si pracovník mění dál.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jedna funkce a jeden hlídač.
-- Na konci skript zámek vyzkouší na jednom pracovníkovi a zkoušku hned
-- vrátí zpátky — nic z ní se neuloží. Spustit se dá klidně víckrát.
-- Když cokoli selže, neuloží se nic.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Hláška „lock timeout" znamená, že s profily zrovna někdo pracoval;
-- stačí pustit znovu.
-- =====================================================================

begin;

-- Kdyby s profily zrovna někdo pracoval, radši to po 5 vteřinách vzdát,
-- než nechat appku čekat.
set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.teams') is null
     or to_regclass('public.subteams') is null then
    raise exception 'Chybí tabulka profiles, teams nebo subteams. Nic se nezměnilo.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name in ('team_id', 'subteam_id')) <> 2 then
    raise exception 'V profilech chybí sloupec team_id nebo subteam_id. Nic se nezměnilo.';
  end if;
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'V profilech není nikdo s rolí admin — skupiny by pak nesměl měnit nikdo. Nic se nezměnilo.';
  end if;
end $$;

-- ── 1. Hlídač ────────────────────────────────────────────────────────
-- Funkce běží s právy vlastníka (security definer), aby si mohla přečíst,
-- jestli je přihlášený správce. Proto pevná search_path.
create or replace function public.profiles_zamek_party()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
begin
  -- Skupina se nemění (jméno, telefon, fotka, „jsem online"…) → není co hlídat.
  if tg_op = 'UPDATE'
     and new.team_id    is not distinct from old.team_id
     and new.subteam_id is not distinct from old.subteam_id then
    return new;
  end if;
  -- Nový profil bez skupiny (tak se registruje každý pracovník) → v pořádku.
  if tg_op = 'INSERT' and new.team_id is null and new.subteam_id is null then
    return new;
  end if;

  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  -- Server se servisním klíčem (CRM, serverové funkce).
  if v_claims <> '' and (v_claims::jsonb ->> 'role') = 'service_role' then
    return new;
  end if;

  -- Zápis přímo v Supabase (SQL Editor, tabulky): žádné přihlášení z appky.
  -- Bez téhle výjimky by smazání podskupiny v Supabase nechalo lidem
  -- v profilu odkaz na podskupinu, která už neexistuje.
  if v_claims = ''
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
     and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Správce (role admin) — přiděluje skupiny v Týmech.
  if exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.role = 'admin') then
    return new;
  end if;

  -- Kdokoli jiný: nový profil začne bez skupiny…
  if tg_op = 'INSERT' then
    new.team_id    := null;
    new.subteam_id := null;
    return new;
  end if;
  -- …stávající ji má dál stejnou. Jediná výjimka: skupina nebo podskupina,
  -- na kterou profil ukazuje, už neexistuje (byla smazaná). Pak se odkaz
  -- smí vymazat vždy — jinak by v profilu zůstal odkaz do prázdna.
  if new.team_id is distinct from old.team_id
     and not (new.team_id is null
              and not exists (select 1 from public.teams t where t.id = old.team_id)) then
    new.team_id := old.team_id;
  end if;
  if new.subteam_id is distinct from old.subteam_id
     and not (new.subteam_id is null
              and not exists (select 1 from public.subteams s where s.id = old.subteam_id)) then
    new.subteam_id := old.subteam_id;
  end if;
  return new;
end $$;

comment on function public.profiles_zamek_party() is
  'Skupinu a podskupinu v profilu mění jen správce, server nebo zápis přímo v Supabase — ne pracovník sám sobě.';

-- Funkci nejde zavolat zvenku (z appky ani přes API); spouští ji jen hlídač.
revoke all on function public.profiles_zamek_party() from public, anon, authenticated;

drop trigger if exists profiles_zamek_party_trg on public.profiles;
create trigger profiles_zamek_party_trg
  before insert or update of team_id, subteam_id on public.profiles
  for each row execute function public.profiles_zamek_party();

-- ── 2. Zkouška naostro, která se hned vrátí ─────────────────────────
-- Na jednom pracovníkovi se zkusí změnit skupina tak, jak by to udělal on
-- sám, správce, server a SQL Editor. Každý pokus se hned vrátí zpátky,
-- nic se neuloží; zapamatuje se jen výsledek pro výpis na konci.
do $$
declare
  v_prac    uuid;
  v_tym     uuid;
  v_pod     uuid;
  v_jiny    uuid;
  v_spravce uuid;
  v_po_tym  uuid;
  v_po_pod  uuid;
  v_kdo     text;
  v_claims  text;
  v_vysl    text;
begin
  -- Na kom: pracovník (ne správce), přednostně ten, kdo ve skupině je.
  select p.id, p.team_id, p.subteam_id into v_prac, v_tym, v_pod
    from public.profiles p
   where p.role is distinct from 'admin'
   order by (p.team_id is null), (p.subteam_id is null), p.id
   limit 1;
  select t.id into v_jiny
    from public.teams t
   where t.id is distinct from v_tym
   order by t.id
   limit 1;
  select p.id into v_spravce
    from public.profiles p
   where p.role = 'admin'
   order by p.id
   limit 1;

  foreach v_kdo in array array['pracovnik', 'spravce', 'server', 'editor'] loop
    if v_prac is null or (v_tym is null and v_jiny is null) then
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
        update public.profiles
           set team_id    = case when team_id is null then v_jiny else null end,
               subteam_id = null
         where id = v_prac;
        select p.team_id, p.subteam_id into v_po_tym, v_po_pod
          from public.profiles p where p.id = v_prac;
        v_vysl := case when v_po_tym is not distinct from v_tym
                        and v_po_pod is not distinct from v_pod
                       then 'nezměnil' else 'změnil' end;
        -- Tímhle se celý pokus vrátí zpátky (i s přihlášením „jako on").
        raise exception using errcode = 'ZK001', message = 'zkouška se vrací';
      exception
        when sqlstate 'ZK001' then null;
        when others then v_vysl := 'chyba: ' || sqlerrm;
      end;
    end if;
    perform set_config('subbau.zamek_party_' || v_kdo, v_vysl, false);
  end loop;

  -- Pojistka: po zkoušce musí mít pracovník přesně tu skupinu, co předtím.
  -- Kdyby ne, zkouška po sobě neuklidila — pak radši neuložit nic.
  if v_prac is not null then
    select p.team_id, p.subteam_id into v_po_tym, v_po_pod
      from public.profiles p where p.id = v_prac;
    if v_po_tym is distinct from v_tym or v_po_pod is distinct from v_pod then
      raise exception 'Zkouška po sobě neuklidila (skupina pracovníka se změnila). Nic se neuložilo, pošlete mi prosím tuhle hlášku.';
    end if;
  end if;

  -- Kdyby zámek nepustil ani správce, v Týmech by nikoho nepřeřadil.
  -- Pak radši neuložit nic.
  if current_setting('subbau.zamek_party_spravce') = 'nezměnil' then
    raise exception 'Zámek by zablokoval i správce — v Týmech by nikoho nepřeřadil. Nic se nezměnilo, pošlete mi prosím tuhle hlášku.';
  end if;
end $$;

commit;


-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. První řádek má být „OK". Zkouška: pracovník
-- „nezměnil", správce, server a SQL Editor „změnil". Když je první řádek
-- „POZOR", pod ním jsou řádky „problém" s tím, co nesedí.
with
hlidac as (
  select t.tgenabled, t.tgtype, p.proname, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as pevna_cesta,
         has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute') as zvenku,
         (cardinality(t.tgattr::int2[]) = 0
          or (select count(*) from pg_attribute a
               where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])
                 and a.attname in ('team_id', 'subteam_id')) = 2) as oba_sloupce
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.profiles'::regclass
     and t.tgname = 'profiles_zamek_party_trg'
     and not t.tgisinternal
),
zkousky as (
  select x.poradi, x.kdo, x.ceka,
         coalesce(nullif(current_setting('subbau.zamek_party_' || x.klic, true), ''),
                  'neví se — zkouška neběžela') as vysl
    from (values (3, 'pracovnik', 'zkouška: pracovník mění svou skupinu', 'nezměnil'),
                 (4, 'spravce',   'zkouška: správce mění skupinu',        'změnil'),
                 (5, 'server',    'zkouška: server (servisní klíč)',      'změnil'),
                 (6, 'editor',    'zkouška: SQL Editor',                  'změnil'))
         as x(poradi, klic, kdo, ceka)
),
spravci as (
  select count(*) filter (where p.role = 'admin') as admin,
         count(*) filter (where lower(btrim(p.role::text)) = 'admin'
                            and p.role::text <> 'admin') as jinak
    from public.profiles p
),
problemy as (
  select 1 as k, 'hlídač profiles_zamek_party_trg CHYBÍ' as popis
   where not exists (select 1 from hlidac)
  union all
  select 2, 'hlídač je VYPNUTÝ' from hlidac where hlidac.tgenabled not in ('O', 'A')
  union all
  select 3, 'hlídač spouští jinou funkci (' || hlidac.proname || ')'
    from hlidac where hlidac.proname <> 'profiles_zamek_party'
  union all
  -- 23 = pro každý řádek (1) + předem (2) + nový profil (4) + úprava (16)
  select 4, 'hlídač nehlídá nový profil i úpravu předem' from hlidac where hlidac.tgtype & 23 <> 23
  union all
  select 5, 'hlídač nehlídá oba sloupce (team_id, subteam_id)' from hlidac where not hlidac.oba_sloupce
  union all
  select 6, 'funkce neběží s právy vlastníka (security definer)' from hlidac where not hlidac.prosecdef
  union all
  select 7, 'funkce nemá pevnou search_path' from hlidac where not hlidac.pevna_cesta
  union all
  select 8, 'funkci jde spustit zvenku (anon/authenticated)' from hlidac where hlidac.zvenku
  union all
  select 9, z.kdo || ': ' || z.vysl
    from zkousky z where z.vysl <> z.ceka and z.vysl <> 'nebylo na kom vyzkoušet'
  union all
  select 10, 'v profilech není nikdo s rolí admin' from spravci where spravci.admin = 0
  union all
  select 11, spravci.jinak || ' lidí má roli admin zapsanou jinak (velká písmena, mezera)'
    from spravci where spravci.jinak > 0
)
select left(v.co, 100) as co, left(v.podrobnost, 100) as podrobnost
  from (
    select 0 as poradi, '' as pod,
           case when exists (select 1 from problemy) then 'POZOR' else 'OK' end as co,
           case when exists (select 1 from problemy)
                then (select count(*) from problemy) || ' problém(y) — viz řádky „problém" níž'
                else 'skupinu a podskupinu mění jen správce, server nebo SQL Editor; pracovník ne'
           end as podrobnost
    union all
    select 1, lpad(pr.k::text, 3, '0'), 'problém', pr.popis from problemy pr
    union all
    select 2, '', 'hlídač (trigger)',
           coalesce((select case when hlidac.tgenabled in ('O', 'A')
                                 then 'zapnutý — profiles_zamek_party_trg na profilech'
                                 else 'VYPNUTÝ' end from hlidac), 'CHYBÍ')
    union all
    select 3, '', 'funkce',
           coalesce((select hlidac.proname
                            || case when hlidac.prosecdef then ' · security definer' else ' · INVOKER' end
                            || case when hlidac.pevna_cesta then ' · pevná cesta' else ' · BEZ CESTY' end
                            || case when hlidac.zvenku then ' · SPUSTITELNÁ ZVENKU' else ' · zvenku ne' end
                       from hlidac), 'CHYBÍ')
    union all
    select 4, z.poradi::text, z.kdo,
           z.vysl || case when z.vysl = z.ceka then ' — v pořádku (zkouška vrácena, nic se neuložilo)'
                          else '' end
      from zkousky z
    union all
    select 5, '', 'správci', spravci.admin || ' s rolí admin'
      from spravci
    union all
    select 6, '', 'lidé ve skupinách',
           count(*) filter (where p.team_id is not null) || ' má skupinu, z toho '
           || count(*) filter (where p.team_id is not null and p.subteam_id is not null)
           || ' i podskupinu (nic se neměnilo)'
      from public.profiles p
    union all
    select 7, t.tgname, 'další zámek profilu', t.tgname
      from pg_trigger t
     where t.tgrelid = 'public.profiles'::regclass
       and not t.tgisinternal
       and t.tgname <> 'profiles_zamek_party_trg'
    union all
    select 8, pol.policyname, 'kdo smí upravovat profily', pol.policyname || ' (' || pol.cmd || ')'
      from pg_policies pol
     where pol.schemaname = 'public' and pol.tablename = 'profiles'
       and pol.cmd in ('UPDATE', 'ALL')
  ) as v
 order by v.poradi, v.pod;
