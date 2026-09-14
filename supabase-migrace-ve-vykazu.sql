-- =====================================================================
-- KDO PATŘÍ DO VÝKAZU
--
-- CO TO DĚLÁ: přidá k člověku jedno políčko „počítat do výkazu".
-- Automaticky je zapnuté u všech — nic se tedy nezmění, dokud někoho
-- v Týmech ručně neodškrtnete. Odškrtnutý člověk zmizí z výkazů hodin
-- (PDF za tým, týdenní přehled, flexibilní export, odkaz pro odběratele),
-- ale jeho docházka se dál normálně zapisuje a zůstává uložená.
--
-- POZOR, ať se to neplete s tím, co už v appce je:
--   • „docházka zablokovaná" (can_track_hours) = nesmí zapisovat hodiny
--   • „bez provize" (worker_commissions.bez_provize) = nepočítat mu provizi
--   • tohle nové = hodiny si zapisuje dál, jen se neukazují ve výkazu
-- Na peníze (faktury, provize, výplaty) tohle políčko NESAHÁ.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát, nic to nerozbije.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists ve_vykazu boolean not null default true;

comment on column public.profiles.ve_vykazu is
  'Počítat člověka do výkazů hodin? Zapnuto = ano (výchozí stav u všech). '
  'Vypnuto = jeho hodiny se ve výkazech neukazují, ale dál se zapisují. '
  'Na provize, faktury ani výplaty to nemá vliv.';

-- Výkazy se ptají „kdo z týmu patří do výkazu" — ať to netahá celou tabulku.
create index if not exists profiles_ve_vykazu_idx
  on public.profiles (team_id, ve_vykazu);

-- =====================================================================
-- ZÁMEK: odškrtnout smí jen správce
--
-- V databázi platí pravidlo profiles_update_own — každý si smí upravovat
-- vlastní profil. Bez zámku by se tedy pracovník mohl z výkazů vyndat sám
-- a jeho hodiny by odběrateli zmizely. Tenhle trigger tomu brání: komu
-- ve_vykazu mění někdo jiný než správce (nebo server), tomu zůstane, jak bylo.
--
-- Je to samostatný trigger, ať se nemusí přepisovat ten stávající
-- (profiles_zamek_roli_trg) — oba se v klidu spustí vedle sebe.
-- =====================================================================

create or replace function public.profiles_zamek_ve_vykazu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_je_admin boolean;
begin
  -- Volání ze serveru (servisní klíč) necháme projít.
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_jwt_role = 'service_role' then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  ) into v_je_admin;

  if v_je_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.ve_vykazu := true;          -- nově registrovaný je ve výkazech, jako všichni
    return new;
  end if;

  new.ve_vykazu := old.ve_vykazu;   -- sám si to nikdo nepřepne
  return new;
end $$;

comment on function public.profiles_zamek_ve_vykazu() is
  'Hlídá, aby se z výkazů nemohl vyndat nikdo sám — mění to jen správce nebo server.';

drop trigger if exists profiles_zamek_ve_vykazu_trg on public.profiles;

create trigger profiles_zamek_ve_vykazu_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_zamek_ve_vykazu();

-- RLS: nová politika není potřeba. profiles už politiky mají a appka do nich
-- běžně zapisuje (stejně jako u is_active nebo can_track_hours).

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema='public' and table_name='profiles' and column_name='ve_vykazu';
--
-- Kdo je z výkazu vyndaný:
-- select full_name, ve_vykazu from public.profiles where ve_vykazu = false;
--
-- Že zámek existuje:
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass
--   and not tgisinternal;
