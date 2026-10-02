-- =====================================================================
-- HISTORIE ÚPRAV — KDO CO KDY ZMĚNIL A KOMU
--
-- CO TO DĚLÁ: majitel 2. 10. 2026 —
--   „historie úprav přidat sekci kdo co upravil změnil i časy komu to
--    udělal atd ať je přesně vědět kdo co upravoval".
--
-- Přibude tabulka historie_uprav. Do ní databáze SAMA zapíše každou změnu
-- v hlavních tabulkách (docházka, dovolené, profily, faktury, zálohy,
-- finance, provize, sazby, týmy, firmy, smlouvy, doklady, ubytování a
-- auta, kódy k ubytování, výkazy, fotky ze stavby, puntíky, oznámení,
-- odkazy pro odběratele, přístupy k exportu PDF):
--   kdy           kdy se to stalo
--   kdo           kdo to udělal + jak se v tu chvíli jmenoval
--   tabulka/akce  kde a co: INSERT = přidal, UPDATE = změnil, DELETE = smazal
--   zaznam_id     který řádek
--   komu          kterého pracovníka se to týká + jak se v tu chvíli jmenoval
--   zmeny         u změny jen to, co se opravdu změnilo: {"sloupec": [bylo, je]};
--                 u přidání a smazání celý řádek
--   sam_sobe      pracovník si sám zapsal SVOU DOCHÁZKU (příchod, odchod,
--                 pauza). Appka je standardně schová — „i příchody a odchody,
--                 které si lidé zapsali sami". Všechno ostatní, co si člověk
--                 změní sám (účet, telefon, adresa ubytování…), je vidět.
--
-- Zapisuje to databáze, ne appka. Zachytí se proto i změna z jiného
-- telefonu, ze serveru (odkaz pro odběratele, změna e-mailu) nebo přímo
-- ze Supabase — tam je „kdo" prázdné a ve jméně stojí, odkud to přišlo.
-- NEZAPISUJE se „jsem online" (každých 5 minut od každého pracovníka),
-- počítadlo přihlášení (přihlášení má vlastní login_history), návštěvy
-- odkazu odběratelem a časy poslední úpravy. Hesla, kódy od dveří,
-- podpisové odkazy a odkazy pro odběratele se zapíšou jen jako „(skryto)".
--
-- VIDÍ TO JEN SPRÁVCE. Pracovník ani odběratel do historie nevidí. Z appky
-- ji nikdo (ani správce) nepřepíše ani nesmaže — zapisuje do ní jen
-- databáze sama.
-- KDYBY SE ZÁPIS DO HISTORIE NEPOVEDL, PŮVODNÍ ZMĚNA SE PŘESTO ULOŽÍ.
-- Historie nikdy nezablokuje docházku ani nic jiného.
--
-- ŽÁDNÁ STÁVAJÍCÍ DATA SE NEMĚNÍ ANI NEMAŽOU. Historie začne prázdná a plní
-- se od spuštění. Spustit se dá klidně víckrát — zapsaná historie zůstane.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
-- Připojení hlídače si na chvíli zamkne každou sledovanou tabulku. Kdyby do
-- některé zrovna někdo zapisoval, migrace nečeká věčně: po pěti vteřinách
-- skončí a nic nezmění. Pak ji stačí pustit znovu.
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Chybí tabulka profiles — bez ní historie nezjistí jména. Nic se nezměnilo.';
  end if;
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí funkce je_spravce() — bez ní by historii neviděl nikdo. Nic se nezměnilo.';
  end if;
end $pojistka$;

-- Bez cizích klíčů na profily schválně: historie musí přežít smazání
-- člověka (a zapsat právě to smazání). Cizí klíč by ji buď smazal s ním,
-- nebo by smazání pracovníka zablokoval. Proto se jména ukládají opsaná.
create table if not exists public.historie_uprav (
  id          bigint generated always as identity primary key,
  kdy         timestamptz not null default now(),
  kdo         uuid,                       -- prázdné = server nebo SQL Editor
  kdo_jmeno   text,
  tabulka     text not null,
  akce        text not null check (akce in ('INSERT', 'UPDATE', 'DELETE')),
  zaznam_id   text,
  komu        uuid,
  komu_jmeno  text,
  zmeny       jsonb not null
);

comment on table public.historie_uprav is
  'Kdo co kdy změnil a komu. Zapisuje jen databáze (hlídač zapis_historie_uprav), čte jen správce.';

-- SAM_SOBE. PostgREST neumí porovnat dva sloupce mezi sebou, appka se tedy
-- ptá na hotovou hodnotu sam_sobe=eq.false. Ta musí být vždy true/false,
-- nikdy prázdná: u úprav bez pracovníka (týmy, firmy, ubytování) je komu
-- prázdné a holé „kdo = komu" by dalo NULL — filtr by takové řádky tiše
-- schoval. A jen DOCHÁZKA: každodenní příchody a odchody jsou šum, ale když
-- si člověk sám změní účet, telefon nebo adresu, majitel to vidět chce.
-- Výraz je jen tady. Starší návrh téhle migrace počítal sam_sobe i pro
-- ostatní tabulky — kdyby ho už někdo spustil, sloupec se tu přepočítá.
-- Je to jen odvozená hodnota, nic se tím neztratí.
do $sam_sobe$
declare
  v_vyraz text;
begin
  select pg_get_expr(d.adbin, d.adrelid) into v_vyraz
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.historie_uprav'::regclass
     and a.attname = 'sam_sobe'
     and not a.attisdropped;
  if v_vyraz is null or v_vyraz not like '%''attendance''%' then
    alter table public.historie_uprav drop column if exists sam_sobe;
    alter table public.historie_uprav add column sam_sobe boolean
      generated always as (kdo is not null and komu is not null and kdo = komu and tabulka = 'attendance') stored;
  end if;
end $sam_sobe$;

-- Výpis odzadu (nejnovější nahoře), po pracovníkovi, po tom, kdo měnil,
-- a výchozí pohled appky „bez docházky, kterou si lidé zapsali sami".
create index if not exists historie_uprav_kdy          on public.historie_uprav (kdy desc);
create index if not exists historie_uprav_komu_kdy     on public.historie_uprav (komu, kdy desc);
create index if not exists historie_uprav_kdo_kdy      on public.historie_uprav (kdo, kdy desc);
create index if not exists historie_uprav_sam_sobe_kdy on public.historie_uprav (sam_sobe, kdy desc);

-- PRÁVA. Nová tabulka dostane od Supabase plná práva všem rolím, proto se
-- nejdřív VŠECHNO odebere a pak se pustí jen čtení — a to jen správci.
-- Pravidla pro zápis schválně žádná nejsou: zapisuje jen hlídač, který
-- běží s právy vlastníka tabulky.
alter table public.historie_uprav enable row level security;
revoke all on public.historie_uprav from anon, authenticated, public;
grant select on public.historie_uprav to authenticated;

do $prava$
declare
  v_sekvence text := pg_get_serial_sequence('public.historie_uprav', 'id');
begin
  if v_sekvence is not null then
    execute format('revoke all on sequence %s from anon, authenticated, public', v_sekvence);
  end if;
  -- Serverový klíč obchází pravidla. Číst historii smí (budoucí výpisy),
  -- přepsat ani smazat ne — ať ani ukradený klíč stopy nezamete.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke insert, update, delete, truncate on public.historie_uprav from service_role;
  end if;
end $prava$;

drop policy if exists historie_uprav_cte_spravce on public.historie_uprav;
create policy historie_uprav_cte_spravce on public.historie_uprav
  for select to authenticated
  using ((select public.je_spravce()));

-- ── Hlídač ───────────────────────────────────────────────────────────
-- Jedna funkce pro všechny tabulky; sloupec s pracovníkem („komu") dostane
-- každý hlídač jako argument, protože u profilů je to id, jinde worker_id.
-- Běží s právy vlastníka (security definer): pracovník do historie nesmí,
-- jeho změna se do ní ale zapsat musí. Proto pevná search_path a všechny
-- tabulky se jménem schématu.
create or replace function public.zapis_historie_uprav()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Mění se samy, bez rozhodnutí člověka. Kdyby se zapisovaly, historii by
  -- zaplavily. Změní-li se JEN tyhle, nezapíše se nic:
  --   last_seen_at       „jsem online" každých 5 minut od každého;
  --   last_login_at, login_count   každé přihlášení (to má login_history
  --                      a appka je i v živých změnách bere jako přítomnost);
  --   updated_at, aktualizovano, zmeneno_v, upraveno, upraveno_v, upravil
  --                      kdy a kdo naposledy uložil — appka i server je
  --                      přibalí ke KAŽDÉMU uložení, i beze změny (kódy
  --                      k ubytování, poznámky a týdny odběratele); kdo to
  --                      byl, říká historie sama;
  --   posledni_navsteva, pocet_navstev   odběratel otevřel odkaz — stránka
  --                      se mu sama obnovuje každou minutu a každé obnovení
  --                      to zapíše.
  c_ignorovat constant text[] := array['last_seen_at', 'last_login_at', 'login_count',
                                       'updated_at', 'aktualizovano', 'zmeneno_v',
                                       'upraveno', 'upraveno_v', 'upravil',
                                       'posledni_navsteva', 'pocet_navstev'];
  -- Tajné hodnoty. Historie se nemaže, takže by v ní zůstaly navždy: otisky
  -- hesel k Provizím a k exportu PDF (password_hash), podpisový odkaz pro
  -- firmu (sign_token), odkaz pro odběratele (token — kdo ho zná, vidí
  -- docházku) a kódy od dveří ubytování (kody). Zapíše se jen, ŽE se
  -- změnily. „heslo" je tu pro jistotu, kdyby takový sloupec přibyl.
  -- Jen přesná jména: obecný vzor by schoval i neškodné sloupce
  -- (např. „pin" je i ve „skupinka_id").
  c_skryt constant text[] := array['password_hash', 'sign_token', 'token', 'kody', 'heslo'];
  -- Podpisy z výkazů a fotky od odběratele jsou obrázky zapsané jako text
  -- (desítky kB). Historie má říct, že se změnily; obrázek je pořád v tabulce.
  c_max_delka constant integer := 500;
  v_stary       jsonb;
  v_novy        jsonb;
  v_radek       jsonb;
  v_zmeny       jsonb := '{}'::jsonb;
  v_klic        text;
  v_hodnota     jsonb;
  v_cesta       text[];
  v_delka       integer;
  v_sloupec     text;
  v_komu_text   text;
  v_komu        uuid;
  v_komu_jmeno  text;
  v_kdo         uuid;
  v_kdo_jmeno   text;
  v_role        text;
  v_zaznam      text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_stary := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_novy := to_jsonb(new); end if;
  v_radek := coalesce(v_novy, v_stary);

  if tg_op = 'UPDATE' then
    for v_klic, v_hodnota in select e.key, e.value from jsonb_each(v_novy) as e loop
      continue when v_klic = any (c_ignorovat);
      if (v_stary -> v_klic) is distinct from v_hodnota then
        v_zmeny := v_zmeny || jsonb_build_object(v_klic, jsonb_build_array(v_stary -> v_klic, v_hodnota));
      end if;
    end loop;
    -- Uložení beze změny (appka posílá celý formulář) nebo jen „jsem online".
    if v_zmeny = '{}'::jsonb then
      return null;
    end if;
  else
    v_zmeny := v_radek;
  end if;

  -- Skrýt až PO porovnání — jinak by výměna hesla vypadala jako „beze změny".
  -- Prázdná hodnota zůstane prázdná, ať je vidět „nastavil" a „zrušil".
  foreach v_klic in array c_skryt loop
    continue when not (v_zmeny ? v_klic);
    if tg_op = 'UPDATE' then
      v_zmeny := jsonb_set(v_zmeny, array[v_klic], jsonb_build_array(
        case when v_zmeny -> v_klic -> 0 = 'null'::jsonb then 'null'::jsonb else to_jsonb('(skryto)'::text) end,
        case when v_zmeny -> v_klic -> 1 = 'null'::jsonb then 'null'::jsonb else to_jsonb('(skryto)'::text) end));
    elsif v_zmeny -> v_klic <> 'null'::jsonb then
      v_zmeny := jsonb_set(v_zmeny, array[v_klic], to_jsonb('(skryto)'::text));
    end if;
  end loop;

  -- Dlouhé texty zkrátit i uvnitř seznamů a objektů (pauzy, vyplněná pole
  -- smlouvy). Kratší celek než limit dlouhý text obsahovat nemůže, takže se
  -- běžné změny vůbec neprocházejí.
  if length(v_zmeny::text) > c_max_delka then
    for v_cesta, v_delka in
      with recursive uzel(cesta, hodnota) as (
        select array[e.key], e.value from jsonb_each(v_zmeny) as e
        union all
        select u.cesta || d.klic, d.hodnota
          from uzel u
          cross join lateral (
            select o.key as klic, o.value as hodnota
              from jsonb_each(case when jsonb_typeof(u.hodnota) = 'object' then u.hodnota end) as o
            union all
            select (a.poradi - 1)::text, a.hodnota
              from jsonb_array_elements(case when jsonb_typeof(u.hodnota) = 'array' then u.hodnota end)
                   with ordinality as a(hodnota, poradi)
          ) as d
         where jsonb_typeof(u.hodnota) in ('object', 'array')
           and length(u.hodnota::text) > c_max_delka
      )
      select uzel.cesta, length(uzel.hodnota #>> '{}')
        from uzel
       where jsonb_typeof(uzel.hodnota) = 'string'
         and length(uzel.hodnota #>> '{}') > c_max_delka
    loop
      v_zmeny := jsonb_set(v_zmeny, v_cesta, to_jsonb('… (' || v_delka || ' znaků)'));
    end loop;
  end if;

  -- KOMU: pracovník z řádku. Nečekaná hodnota (ne uuid) nesmí shodit zápis
  -- historie — pak prostě „komu" zůstane prázdné.
  v_sloupec := nullif(btrim(coalesce(tg_argv[0], '')), '');
  if v_sloupec is not null then
    v_komu_text := v_radek ->> v_sloupec;
    if v_komu_text ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
      v_komu := v_komu_text::uuid;
    end if;
  end if;
  if v_komu is not null then
    -- U profilu je jméno přímo v řádku — u smazaného profilu jinde už není.
    if tg_table_name = 'profiles' then
      v_komu_jmeno := v_radek ->> 'full_name';
    end if;
    if v_komu_jmeno is null then
      select p.full_name into v_komu_jmeno from public.profiles p where p.id = v_komu;
    end if;
    -- Smazáním pracovníka zmizí s ním i jeho docházka, dovolené… V tu chvíli
    -- už v profilech není, tak se vezme jméno, pod kterým ho historie znala.
    if v_komu_jmeno is null then
      select h.komu_jmeno into v_komu_jmeno
        from public.historie_uprav h
       where h.komu = v_komu and h.komu_jmeno is not null
       order by h.kdy desc, h.id desc
       limit 1;
    end if;
  end if;

  -- KDO: přihlášený z appky. Bez přihlášení se aspoň řekne, odkud změna
  -- přišla — serverový klíč používají serverové funkce (odkaz pro
  -- odběratele, změna e-mailu pracovníka), jinak je to SQL Editor.
  v_kdo := auth.uid();
  if v_kdo is not null then
    select p.full_name into v_kdo_jmeno from public.profiles p where p.id = v_kdo;
  else
    v_role := coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      substring(coalesce(current_setting('request.jwt.claims', true), '') from '"role"\s*:\s*"([^"]*)"'),
      nullif(current_setting('role', true), 'none'));
    v_kdo_jmeno := case v_role
                     when 'service_role' then 'server (servisní klíč)'
                     when 'anon' then 'nepřihlášený (veřejný klíč)'
                     else 'SQL Editor / systém'
                   end;
  end if;

  -- Který řádek: skoro všude sloupec id. Kde není (skupinky_lide, odkazy
  -- pro odběratele…), složí se z primárního klíče.
  v_zaznam := v_radek ->> 'id';
  if v_zaznam is null then
    select string_agg(coalesce(v_radek ->> a.attname::text, ''), '/' order by k.poradi)
      into v_zaznam
      from pg_catalog.pg_index i
      cross join lateral unnest(i.indkey::int2[]) with ordinality as k(cislo, poradi)
      join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.cislo
     where i.indrelid = tg_relid and i.indisprimary;
  end if;

  insert into public.historie_uprav (kdo, kdo_jmeno, tabulka, akce, zaznam_id, komu, komu_jmeno, zmeny)
  values (v_kdo, v_kdo_jmeno, tg_table_name, tg_op, v_zaznam, v_komu, v_komu_jmeno, v_zmeny);

  -- Hlídač běží PO zápisu; co vrátí, Postgres nepoužije. Prázdné schválně,
  -- ať je jasné, že na původní změně nic nemění.
  return null;
exception when others then
  -- Historie nesmí nikdy zablokovat docházku ani nic jiného: když se zápis
  -- do ní nepovede, změna projde a v logu Supabase zůstane varování.
  raise warning 'Historie úprav: změna v % (%) se do historie nezapsala — % [%]. Původní změna platí.',
    tg_table_name, tg_op, sqlerrm, sqlstate;
  return null;
end
$fn$;

comment on function public.zapis_historie_uprav() is
  'Hlídač historie úprav. Argument = sloupec s pracovníkem (worker_id, u profilů id; prázdný = bez pracovníka).';

-- Spouští ji jen hlídač; zvenku (přes API) ji volat nejde a nemá proč.
revoke all on function public.zapis_historie_uprav() from public, anon, authenticated;

-- ── Připojení hlídačů ────────────────────────────────────────────────
-- Sloupec „komu" podle toho, jak tabulku používá appka a server. Kde se
-- změna netýká jednoho pracovníka (týmy, firmy, ubytování jako celek,
-- oznámení, přístupy k Provizím a k exportu, odkazy pro odběratele a jejich
-- skupiny a týdny), je prázdný.
-- Schválně CHYBÍ: notifications, chat_messages, oznameni_precteno,
-- login_history, doc_alert_dismissals (zprávy, přečtení a přihlášení — samy
-- jsou záznamem toho, kdo co kdy, a zaplavily by historii) a historie sama.
do $pripojit$
declare
  v_tabulka text;
  v_komu    text;
begin
  for v_tabulka, v_komu in
    select s.tabulka, s.komu from (values
      ('attendance',           'worker_id'),
      ('vacations',            'worker_id'),
      ('profiles',             'id'),
      ('worker_invoices',      'worker_id'),
      ('zalohove_faktury',     'worker_id'),
      ('financials',           'worker_id'),
      ('provize_payments',     'worker_id'),
      ('provize_platby_firem', ''),
      ('provize_access',       ''),
      ('worker_rate_history',  'worker_id'),
      ('worker_commissions',   'worker_id'),
      ('teams',                ''),
      ('subteams',             ''),
      ('team_assignments',     'worker_id'),
      ('companies',            ''),
      ('contracts',            'worker_id'),
      ('documents',            'worker_id'),
      ('skupinky',             ''),
      ('skupinky_lide',        'worker_id'),
      ('weekly_hour_sheets',   'worker_id'),
      ('site_photos',          'worker_id'),
      ('puntiky',              'worker_id'),
      ('announcements',        ''),
      ('ubytovani_kody',       'worker_id'),
      ('export_access',        ''),
      ('client_links',         ''),
      ('client_link_teams',    ''),
      ('client_link_weeks',    ''),
      ('client_link_workers',  'worker_id')
    ) as s(tabulka, komu)
  loop
    -- Tabulka, která u vás není (nebo je jen pohledem), se přeskočí —
    -- migrace kvůli ní nespadne. Po pozdějším spuštění se připojí sama.
    continue when not exists (
      select 1 from pg_class c
       where c.oid = to_regclass('public.' || quote_ident(v_tabulka))
         and c.relkind in ('r', 'p'));
    execute format('drop trigger if exists historie_uprav_trg on public.%I', v_tabulka);
    execute format('create trigger historie_uprav_trg after insert or update or delete on public.%I '
                   'for each row execute function public.zapis_historie_uprav(%L)', v_tabulka, v_komu);
  end loop;
end $pripojit$;

-- Ať appka novou tabulku uvidí hned, ne až PostgREST sám obnoví mezipaměť.
notify pgrst, 'reload schema';

commit;

-- Kontrola — má vyjít JEDEN řádek:
--   tabulka_historie      = true
--   tabulek_ze_seznamu    = 29    kolik ze 29 sledovaných tabulek u vás je;
--                                 méně = některá v databázi není, to nevadí
--   hlidacu               = totéž číslo jako tabulek_ze_seznamu (29)
--   rls_zapnute           = true
--   pravidel              = 1
--   anon_cte              = false
--   prihlaseny_zapise     = false
--   sam_sobe_jen_dochazka = true
with seznam(tabulka) as (values
  ('attendance'), ('vacations'), ('profiles'), ('worker_invoices'), ('zalohove_faktury'),
  ('financials'), ('provize_payments'), ('provize_platby_firem'), ('provize_access'),
  ('worker_rate_history'), ('worker_commissions'), ('teams'), ('subteams'),
  ('team_assignments'), ('companies'), ('contracts'), ('documents'), ('skupinky'),
  ('skupinky_lide'), ('weekly_hour_sheets'), ('site_photos'), ('puntiky'), ('announcements'),
  ('ubytovani_kody'), ('export_access'), ('client_links'), ('client_link_teams'),
  ('client_link_weeks'), ('client_link_workers')
),
existujici as (
  select c.oid
    from seznam s
    join pg_class c on c.oid = to_regclass('public.' || quote_ident(s.tabulka))
   where c.relkind in ('r', 'p')
)
select to_regclass('public.historie_uprav') is not null as tabulka_historie,
       (select count(*) from existujici) as tabulek_ze_seznamu,
       (select count(*)
          from pg_trigger t
          join existujici e on e.oid = t.tgrelid
         where t.tgname = 'historie_uprav_trg'
           and not t.tgisinternal
           and t.tgenabled in ('O', 'A')
           and t.tgfoid = to_regprocedure('public.zapis_historie_uprav()')) as hlidacu,
       (select c.relrowsecurity from pg_class c
         where c.oid = to_regclass('public.historie_uprav')) as rls_zapnute,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = 'historie_uprav') as pravidel,
       has_table_privilege('anon', to_regclass('public.historie_uprav'), 'select') as anon_cte,
       has_table_privilege('authenticated', to_regclass('public.historie_uprav'),
                           'insert, update, delete') as prihlaseny_zapise,
       (select pg_get_expr(d.adbin, d.adrelid) like '%''attendance''%'
          from pg_attribute a
          join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid = to_regclass('public.historie_uprav')
           and a.attname = 'sam_sobe' and not a.attisdropped) as sam_sobe_jen_dochazka;
