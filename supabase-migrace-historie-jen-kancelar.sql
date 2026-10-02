-- =====================================================================
-- HISTORIE ÚPRAV JEN PRO KANCELÁŘ — kroky pracovníků se nezapisují
--
-- CO TO DĚLÁ: majitel 2. 10. 2026 —
--   „historie úprav je jen pro adminy, jen aby šli vidět kroky adminů nebo
--    třeba sekretářky nebo někoho, kdo bude dělat faktury".
--
-- Navazuje na supabase-migrace-historie-uprav.sql (proběhla 2. 10. ráno).
-- Mění jen hlídač zapis_historie_uprav: když změnu udělá PRACOVNÍK (role
-- osvec nebo partak), do historie se NEZAPÍŠE vůbec — příchody, odchody,
-- pauzy, vlastní fotky, vlastní profil, vlastní dovolené, nic.
-- Zapisuje se dál všechno ostatní:
--   • správce (admin) a jakákoli jiná role, která není pracovník — i budoucí
--     sekretářka nebo účetní (kancelar, ucetni…) bez další úpravy;
--   • server (servisní klíč) a SQL Editor;
--   • přihlášený, který nemá profil (neobvyklé — proto ať je to vidět).
--
-- DATA SE MĚNÍ: z historie se SMAŽOU záznamy, které od rána nadělali
-- pracovníci sami (od první migrace — starší tam být nemůžou). Majitel je
-- tam nechce. Záznamy správce, serveru a SQL Editoru zůstávají. Docházky,
-- profilů ani ničeho jiného se skript nedotkne.
-- Tabulka historie, pravidla, hlídače i sloupec sam_sobe zůstávají, jak
-- jsou. sam_sobe bude od teď vždycky false — pracovníci se už nezapisují.
--
-- Spustit se dá klidně víckrát: podruhé už nic nesmaže (výpis ukáže 0).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
-- Kdyby do historie zrovna někdo zapisoval, migrace nečeká věčně: po pěti
-- vteřinách skončí a nic nezmění. Pak ji stačí pustit znovu.
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.historie_uprav') is null
     or to_regprocedure('public.zapis_historie_uprav()') is null then
    raise exception 'Chybí historie úprav — nejdřív spusťte supabase-migrace-historie-uprav.sql. Nic se nezměnilo.';
  end if;
end $pojistka$;

-- ── Hlídač ───────────────────────────────────────────────────────────
-- Stejný jako v první migraci, jen „KDO" se zjišťuje hned na začátku: změnu
-- pracovníka je potřeba poznat dřív, než se na ni udělá jakákoli práce.
-- „Jsem online" každých 5 minut od každého pracovníka tak skončí jedním
-- dotazem do profilu. Hlídače na tabulkách se nepřestavují — volají
-- funkci pořád stejnou, jen s novým obsahem.
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
  v_kdo_role    text;
  v_role        text;
  v_zaznam      text;
begin
  -- KDO: přihlášený z appky. Bez přihlášení se aspoň řekne, odkud změna
  -- přišla — serverový klíč používají serverové funkce (odkaz pro
  -- odběratele, změna e-mailu pracovníka), jinak je to SQL Editor.
  v_kdo := auth.uid();
  if v_kdo is not null then
    select p.full_name, p.role into v_kdo_jmeno, v_kdo_role
      from public.profiles p where p.id = v_kdo;
    -- Historie je jen pro kancelář: krok pracovníka se nezapíše vůbec.
    -- Malá písmena a bez mezer, ať to neobejde „Partak " zapsané ručně.
    -- Jiná role (admin, později sekretářka nebo účetní) i přihlášený bez
    -- profilu se zapisují dál. Značka [JEN-KANCELAR] je kvůli kontrole na konci.
    if lower(btrim(v_kdo_role)) in ('osvec', 'partak') then  -- [JEN-KANCELAR]
      return null;
    end if;
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
  'Hlídač historie úprav — jen kancelář: kroky pracovníků (osvec, partak) se nezapisují. Argument = sloupec s pracovníkem (worker_id, u profilů id; prázdný = bez pracovníka).';

-- Spouští ji jen hlídač; zvenku (přes API) ji volat nejde a nemá proč.
revoke all on function public.zapis_historie_uprav() from public, anon, authenticated;

-- ── Úklid ranních záznamů pracovníků ────────────────────────────────
-- Majitel kroky pracovníků v historii nechce. Jsou tam jen dnešní — od první
-- migrace ráno do teď (příchody, odchody, pauzy, vlastní fotky, profil,
-- dovolené). Maže se podle role toho, KDO změnu udělal; záznamy správce,
-- serveru a SQL Editoru zůstávají. role::text, ať to projde, i kdyby role
-- v profilech byla výčtový typ.
do $uklid$
declare
  v_pocet bigint;
begin
  delete from public.historie_uprav h
   using public.profiles p
   where p.id = h.kdo
     and lower(btrim(p.role::text)) in ('osvec', 'partak');
  get diagnostics v_pocet = row_count;
  -- Počet si zapamatuje jen tohle spojení — pro výpis na konci.
  perform set_config('subbau.historie_smazano_pracovniku', v_pocet::text, false);
end $uklid$;

notify pgrst, 'reload schema';

commit;

-- Kontrola — má vyjít JEDEN řádek:
--   smazano_zaznamu_pracovniku   = kolik ranních záznamů pracovníků se smazalo
--                                  (poprvé víc než 0, při dalším spuštění 0)
--   zbyva_zaznamu_pracovniku     = 0   (kdyby ne, někdo zrovna během spuštění
--                                       zapsal docházku — stačí pustit znovu)
--   tabulek_ze_seznamu           = 29
--   hlidacu                      = 29  (stejně jako tabulek_ze_seznamu)
--   funkce_preskakuje_pracovniky = true
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
select nullif(current_setting('subbau.historie_smazano_pracovniku', true), '')::bigint as smazano_zaznamu_pracovniku,
       (select count(*)
          from public.historie_uprav h
          join public.profiles p on p.id = h.kdo
         where lower(btrim(p.role::text)) in ('osvec', 'partak')) as zbyva_zaznamu_pracovniku,
       (select count(*) from existujici) as tabulek_ze_seznamu,
       (select count(*)
          from pg_trigger t
          join existujici e on e.oid = t.tgrelid
         where t.tgname = 'historie_uprav_trg'
           and not t.tgisinternal
           and t.tgenabled in ('O', 'A')
           and t.tgfoid = to_regprocedure('public.zapis_historie_uprav()')) as hlidacu,
       coalesce((select p.prosrc like '%lower(btrim(v_kdo_role)) in (''osvec'', ''partak'') then  -- [JEN-KANCELAR]%'
                   from pg_proc p
                  where p.oid = to_regprocedure('public.zapis_historie_uprav()')), false) as funkce_preskakuje_pracovniky;
