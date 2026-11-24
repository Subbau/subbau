-- =====================================================================
-- ODEBRÁNÍ PŘÍSTUPU NA VLASTNÍ ŽÁDOST (23. 11. 2026)
--
-- PROČ: OSVČ používá aplikaci dobrovolně. V Profilu má větu „Pokud chcete
-- přístup do aplikace odebrat, klikněte zde". Kliknutím jen POŽÁDÁ; přístup
-- odebírá kancelář ručně na Přehledu (do 48 hodin). Do té doby jde žádost
-- vzít zpět. Po odebrání člověk v aplikaci nic nezapíše, jen si stáhne své
-- výkazy a faktury.
--
-- CO TO DĚLÁ: přidá k profilu dva sloupce
--   odebrani_pristupu_zadost_at   kdy o to pracovník požádal (prázdné = nepožádal)
--   pristup_odebran_na_zadost_at  kdy kancelář přístup na tu žádost odebrala
-- a pojistku (spouštěč), která hlídá:
--   • čas žádosti je vždy čas serveru (nejde si ho posunout a lhůtu 48 hodin
--     nejde opakovaným kliknutím natáhnout ani zkrátit),
--   • „odebráno na žádost" zapíše jen správce — pracovník si to sám nenastaví
--     ani nezruší, a jakmile je přístup odebraný, žádost už vzít zpět nejde
--     a přístup si sám nevrátí,
--   • komu kancelář odebere přístup v době, kdy má podanou žádost (i tlačítkem
--     v Přístupech), tomu se „odebráno na žádost" doplní samo,
--   • když kancelář přístup obnoví, obě značky se samy vymažou.
--
-- CO TO NEDĚLÁ: nic nemaže a nikomu přístup neodebírá. Docházka, faktury,
-- provize ani práva se nemění. Dokud skript neproběhne, věta v Profilu ani
-- pruh na Přehledu se v aplikaci neukážou.
-- Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Tabulka profiles neexistuje. Nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.profiles add column if not exists odebrani_pristupu_zadost_at timestamptz;
alter table public.profiles add column if not exists pristup_odebran_na_zadost_at timestamptz;

comment on column public.profiles.odebrani_pristupu_zadost_at is
  'Kdy pracovník sám v Profilu požádal o odebrání přístupu do aplikace. Prázdné = nepožádal. Appka sama přístup neodebírá — odebírá kancelář z Přehledu.';
comment on column public.profiles.pristup_odebran_na_zadost_at is
  'Kdy kancelář odebrala přístup na žádost pracovníka. Zapisuje jen správce. Podle toho pracovník místo „Přístup pozastaven" dostane obrazovku se staženími.';

create or replace function public.profiles_zamek_odebrani_pristupu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_je_admin boolean := false;
  v_duveryhodny boolean := false;
begin
  -- Server (service_role) a zápis přímo v Supabase (SQL Editor) se neomezují —
  -- stejná výjimka jako v profiles_zamek_rezim_prestavky().
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_jwt_role = 'service_role' then
    v_duveryhodny := true;
  elsif coalesce(current_setting('request.jwt.claims', true), '') = ''
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
     and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated') then
    v_duveryhodny := true;
  else
    select exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'admin'
    ) into v_je_admin;
    v_duveryhodny := v_je_admin;
  end if;

  if tg_op = 'INSERT' then
    if not v_duveryhodny then
      new.odebrani_pristupu_zadost_at := null;
      new.pristup_odebran_na_zadost_at := null;
    end if;
    return new;
  end if;

  -- Komu byl přístup odebrán na jeho žádost, ten si ho sám nevrátí —
  -- obnovit ho může jen kancelář.
  if not v_duveryhodny and old.is_active is not true and new.is_active is true
     and old.pristup_odebran_na_zadost_at is not null then
    new.is_active := old.is_active;
  end if;

  -- Kancelář přístup obnovila: žádost i značka „odebráno na žádost" končí.
  if old.is_active is not true and new.is_active is true then
    new.odebrani_pristupu_zadost_at := null;
    new.pristup_odebran_na_zadost_at := null;
    return new;
  end if;

  if not v_duveryhodny then
    -- „Odebráno na žádost" pracovník nezapíše ani nesmaže.
    new.pristup_odebran_na_zadost_at := old.pristup_odebran_na_zadost_at;
    if old.is_active is not true then
      -- Bez přístupu už se žádost nemění.
      new.odebrani_pristupu_zadost_at := old.odebrani_pristupu_zadost_at;
    elsif new.odebrani_pristupu_zadost_at is not null then
      -- Čas žádosti je čas serveru; běžící žádost se opakováním neposouvá.
      new.odebrani_pristupu_zadost_at := coalesce(old.odebrani_pristupu_zadost_at, now());
    end if;
  end if;

  -- Přístup ztrácí člověk, který o to sám požádal — ať už tlačítkem na Přehledu,
  -- nebo v Přístupech: značka se doplní sama, aby dostal obrazovku se staženími.
  if old.is_active is true and new.is_active is not true
     and new.odebrani_pristupu_zadost_at is not null
     and new.pristup_odebran_na_zadost_at is null then
    new.pristup_odebran_na_zadost_at := now();
  end if;

  return new;
end $$;

comment on function public.profiles_zamek_odebrani_pristupu() is
  'Žádost o odebrání přístupu: čas žádosti určuje server, „odebráno na žádost" zapisuje jen správce, obnovením přístupu se obojí vymaže.';

drop trigger if exists profiles_zamek_odebrani_pristupu_trg on public.profiles;

create trigger profiles_zamek_odebrani_pristupu_trg
  before insert or update of odebrani_pristupu_zadost_at, pristup_odebran_na_zadost_at, is_active
  on public.profiles
  for each row execute function public.profiles_zamek_odebrani_pristupu();

commit;

notify pgrst, 'reload schema';

-- KONTROLA: mají vyjít dva řádky (oba sloupce, typ timestamp with time zone)
-- a u obou „pojistka" = 1.
select c.column_name as "sloupec", c.data_type as "typ",
       (select count(*) from pg_trigger
         where tgname = 'profiles_zamek_odebrani_pristupu_trg' and not tgisinternal) as "pojistka"
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'profiles'
   and c.column_name in ('odebrani_pristupu_zadost_at', 'pristup_odebran_na_zadost_at')
 order by c.column_name;
