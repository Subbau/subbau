-- =====================================================================
-- PŘESTÁVKA JEDNÍM TLAČÍTKEM
--
-- CO TO DĚLÁ: nastaví, jak lidé v mobilu zapisují přestávku.
--   • „fix30"  = jedno tlačítko, klik = přestávka 30 minut   ← VÝCHOZÍ U VŠECH
--   • „fix60"  = jedno tlačítko, klik = přestávka 1 hodina
--   • „fix30x" = jedno tlačítko na 30 minut, může ho zmáčknout víckrát za den
--   • „od-do"  = jak to bylo dřív — zvlášť začátek a zvlášť konec pauzy
--
-- Nastavuje se u KAŽDÉHO ČLOVĚKA zvlášť (v Týmech), a jde to jedním
-- kliknutím nastavit celé skupině najednou.
--
-- PROČ TAKY SLOUPEC V DOCHÁZCE: u dne se uloží režim, který platil ten
-- den. Kdyby se to nedělalo, pozdější změna nastavení by zpětně měnila
-- výklad staré docházky a rozešly by se hodiny na už vystavených
-- fakturách.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se dva sloupce.
-- Spustit se dá klidně víckrát, nic to nerozbije.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists rezim_prestavky text not null default 'fix30';

alter table public.profiles drop constraint if exists profiles_rezim_prestavky_check;
alter table public.profiles add constraint profiles_rezim_prestavky_check
  check (rezim_prestavky in ('od-do', 'fix30', 'fix60', 'fix30x'));

comment on column public.profiles.rezim_prestavky is
  'Jak člověk zapisuje přestávku: fix30 = jedno tlačítko na 30 min (výchozí), '
  'fix60 = jedno tlačítko na hodinu, fix30x = 30 min i víckrát za den, '
  'od-do = zvlášť začátek a konec pauzy (původní způsob).';

-- Snapshot u dne — co platilo, když se ten den zapisoval.
alter table public.attendance
  add column if not exists rezim_prestavky text;

comment on column public.attendance.rezim_prestavky is
  'Jaký režim přestávky platil v den zápisu. Prázdno = starší den, počítá se jako od-do. '
  'Drží se u dne schválně, ať pozdější změna nastavení nepřepíše minulost.';

-- =====================================================================
-- ZÁMEK: režim si nesmí přepnout pracovník sám
--
-- Platí pravidlo profiles_update_own — každý si smí upravovat vlastní
-- profil. Bez zámku by si kdokoli přepnul režim na hodinovou pauzu a sám
-- si tím ukrojil (nebo naopak přidal) půl hodiny denně.
-- =====================================================================

create or replace function public.profiles_zamek_rezim_prestavky()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_je_admin boolean;
begin
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
    new.rezim_prestavky := 'fix30';   -- nový člověk začíná na výchozím režimu
    return new;
  end if;

  new.rezim_prestavky := old.rezim_prestavky;
  return new;
end $$;

comment on function public.profiles_zamek_rezim_prestavky() is
  'Režim přestávky mění jen správce nebo server — ne pracovník sám sobě.';

drop trigger if exists profiles_zamek_rezim_prestavky_trg on public.profiles;

create trigger profiles_zamek_rezim_prestavky_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_zamek_rezim_prestavky();

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select full_name, rezim_prestavky from public.profiles
--  where role in ('osvec','partak') order by full_name;
--
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass
--   and not tgisinternal;
