-- =====================================================================
-- FIRMY SMÍ MĚNIT JEN SPRÁVCE
--
-- CO SE NAŠLO: na tabulce firem (companies) je pravidlo
-- „logged_in_full_access_companies" s podmínkou „true" pro všechno (ALL).
-- Založil ho 27. 7. 2026 zamykací skript z CRM. Pravidla se v Postgresu
-- SČÍTAJÍ — stačí, aby pustilo jedno. Každý přihlášený — pracovník, ale
-- i kdokoli, kdo si založí účet přes otevřenou registraci — tak smí
-- firmy měnit a mazat, a hlavně si u své firmy vypnout „zápis jen
-- s polohou". Stejnou díru jsme 3. 9. zavřeli u profilů a docházky.
--
-- CO TO DĚLÁ:
--   1. Zruší každé pravidlo, které pouští zápis do firem bez podmínky,
--      ať se jmenuje jakkoli. Název jsme četli z rozmazaného snímku,
--      proto se nehledá podle jména, ale podle toho, co pravidlo dovolí.
--      Pravidla s rozumnou podmínkou nechá být.
--   2. Číst firmy smí dál každý přihlášený. Appka to potřebuje: faktura
--      pracovníka si z firem dotahuje IČO a DIČ odběratele.
--   3. Zakládat, měnit a mazat firmy smí jen správce.
--   4. Přihlášenému i nepřihlášenému se berou tři práva, která appka
--      nepotřebuje a která pravidla nehlídají: vysypat celou tabulku
--      naráz (TRUNCATE), odkazovat se na ni z jiné tabulky (REFERENCES)
--      a věšet na ni spouště (TRIGGER).
--   5. Nepřihlášený nesmí nic. Odkaz pro odběratele jde přes server
--      a firmy nepotřebuje.
--
-- V appce se nic nemění: firmy i dosud upravoval jen správce, pracovník
-- je jen čte. „Jen s polohou" se pracovníkovi vyhodnotí dál stejně.
-- Pracovník si zatím může sám přepsat svou partu (team_id) a „jen
-- s polohou" tím obejít — to řeší samostatná migrace „zámek party".
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Mění se jen práva. Spustit se dá
-- klidně víckrát. Když cokoli selže, neuloží se nic.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Supabase se kvůli slovu „drop" může zeptat, jestli to opravdu spustit —
-- ruší se jen pravidla, ne data. Hláška „lock timeout" znamená, že
-- s firmami zrovna někdo pracoval; stačí pustit znovu.
-- =====================================================================

begin;

-- Kdyby na firmách zrovna někdo pracoval, radši to po 5 vteřinách vzdát,
-- než nechat appku čekat.
set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $$
begin
  if to_regclass('public.companies') is null then
    raise exception 'Tabulka public.companies neexistuje. Nic se nezměnilo.';
  end if;
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí funkce public.je_spravce() — nejdřív spusťte supabase-migrace-fotka-pracovnika.sql. Nic se nezměnilo.';
  end if;
  if not exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'V profilech není nikdo s rolí admin — po migraci by firmy nesměl měnit nikdo. Nic se nezměnilo.';
  end if;

  -- Jak byla ochrana řádků PŘED migrací (pro výpis na konci). Pamatuje se
  -- v nastavení spojení, ne v dočasné tabulce.
  perform set_config('subbau.rls_pred',
    (select case when c.relrowsecurity then 'zapnutá' else 'VYPNUTÁ' end
       from pg_class c where c.oid = 'public.companies'::regclass),
    false);
end $$;

-- ── 1. Zrušit pravidla, která pouští zápis bez podmínky ─────────────
-- Ruší se pravidlo, které zároveň:
--   • je „permissive" (pouští dovnitř; „restrictive" jen zužuje),
--   • platí pro zápis: ALL, INSERT, UPDATE nebo DELETE,
--   • platí pro appku: role public, anon nebo authenticated,
--   • jeho podmínka (using či with check) je celá jen „true", „1 = 1"
--     či „kdokoli přihlášený" (auth.uid() is not null, auth.role() =
--     'authenticated' a totéž přes auth.jwt()) — nebo nemá podmínku
--     vůbec (takové Postgres sám nepustí, ruší se, ať ve výpisu nemate).
-- Podmínka se před porovnáním zjednoduší (malá písmena, bez mezer,
-- závorek, „::text", „public." a obalu „(select auth.uid())") a musí se
-- shodovat CELÁ — podmínka, která true jen obsahuje, se neruší.
do $$
declare
  jmena   text[];
  zruseno jsonb;
  i       int;
begin
  select coalesce(array_agg(pol.policyname order by pol.policyname), '{}'),
         coalesce(jsonb_agg(jsonb_build_object(
                    'jmeno', pol.policyname,
                    'pro',   pol.cmd || ' pro ' || array_to_string(pol.roles, ', '),
                    'using', pol.qual,
                    'check', pol.with_check)
                  order by pol.policyname), '[]')
    into jmena, zruseno
    from pg_policies pol
   where pol.schemaname = 'public'
     and pol.tablename  = 'companies'
     and pol.permissive = 'PERMISSIVE'
     and pol.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
     and pol.roles && array['public', 'anon', 'authenticated']::name[]
     and (   (pol.qual is null and pol.with_check is null)
          or exists (
               select 1
                 from unnest(array[pol.qual, pol.with_check]) as v(vyraz)
                where regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                        lower(v.vyraz),
                        '\(\s*select\s+(auth\.[a-z_]+\(\))\s+as\s+[a-z_]+\s*\)', '\1', 'g'),
                        '::(text|character varying|name|uuid|jsonb|json|boolean)\M', '', 'g'),
                        'public\.', '', 'g'),
                        '[\s()]', '', 'g')
                      in ('true', '1=1', 'auth.uidisnotnull',
                          'auth.role=''authenticated''', '''authenticated''=auth.role',
                          'auth.jwt->>''role''=''authenticated''',
                          '''authenticated''=auth.jwt->>''role''')));

  for i in 1 .. coalesce(array_length(jmena, 1), 0) loop
    execute format('drop policy %I on public.companies', jmena[i]);
  end loop;

  -- Co se zrušilo, si spojení pamatuje pro výpis na konci (každé pravidlo
  -- pak dostane vlastní řádek).
  perform set_config('subbau.zruseno', zruseno::text, false);
end $$;

-- ── 2. Nová pravidla ─────────────────────────────────────────────────
-- Zakládá se „smaž, pokud je, a vytvoř" — aby šlo spustit víckrát.
-- Čtení zvlášť a zápis zvlášť (ne „ALL"), ať je ve výpisu na první
-- pohled vidět, kdo smí co.

-- Číst smí každý přihlášený: pracovník kvůli IČO a DIČ na faktuře,
-- správce kvůli celé sekci Firmy, Týmům, Provizím a kalendáři.
drop policy if exists "companies: cte kazdy prihlaseny" on public.companies;
create policy "companies: cte kazdy prihlaseny" on public.companies
  for select to authenticated
  using (true);

drop policy if exists "companies: zaklada jen spravce" on public.companies;
create policy "companies: zaklada jen spravce" on public.companies
  for insert to authenticated
  with check ((select public.je_spravce()));

drop policy if exists "companies: upravuje jen spravce" on public.companies;
create policy "companies: upravuje jen spravce" on public.companies
  for update to authenticated
  using ((select public.je_spravce()))
  with check ((select public.je_spravce()));

drop policy if exists "companies: maze jen spravce" on public.companies;
create policy "companies: maze jen spravce" on public.companies
  for delete to authenticated
  using ((select public.je_spravce()));

-- Ochrana řádků zapnutá (kdyby ji někdo vypnul, pravidla by se nečetla).
-- „Vynucení i pro vlastníka" (FORCE) se NEZAPÍNÁ: funkce muj_zapis_jen_gps
-- čte firmy právy vlastníka a pracovníkovi by pak mohla tiše vracet „ne".
alter table public.companies enable row level security;

-- Nepřihlášený: žádná práva k tabulce. Appka ani odkaz pro odběratele
-- firmy bez přihlášení nečtou.
revoke all on table public.companies from anon;

-- Přihlášený smí jen číst a zapisovat (zápis hlídají pravidla výše).
-- Vysypat celou tabulku (TRUNCATE), odkazovat se na ni (REFERENCES) ani
-- věšet na ni spouště (TRIGGER) appka nepotřebuje a pravidla řádků to
-- nehlídají. Nepřihlášenému to bere už řádek výše, tady se jen pojistí.
revoke truncate, references, trigger on table public.companies from anon, authenticated;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý (stačí snímek obrazovky). Co v něm má být:
--   1 VÝSLEDEK                začíná „OK". Při „POZOR" má každý problém
--                             vlastní řádek „1 VÝSLEDEK".
--   2 zrušené pravidlo „…"    při prvním spuštění jen
--                             „logged_in_full_access_companies" (ALL pro
--                             authenticated, podmínky true a true);
--                             při dalším „2 zrušená pravidla: žádné".
--   3 ochrana řádků           teď: zapnutá · vynucená i pro vlastníka: ne
--   4 nepřihlášený smí        nic
--   4 přihlášený smí          SELECT, INSERT, UPDATE, DELETE — nic víc
--   5 pravidlo „…"            naše čtyři: „companies: cte kazdy prihlaseny"
--                             (SELECT, čtení všech firem) a „companies:
--                             zaklada / upravuje / maze jen spravce"
--                             (INSERT / UPDATE / DELETE, zápis jen správce,
--                             v podmínce je_spravce). Každé další pravidlo
--                             pro zápis musí mít „zápis jen správce", jinak
--                             VÝSLEDEK hlásí POZOR.
--   6 správci v profilech     aspoň 1 s rolí admin. Řádek „6 správci
--                             zapsaní jinak" tam být nemá.
--   7 funkce je_spravce (…)   ptá se na role = 'admin' přihlášeného
--                             (je_admin jen tehdy, když ji používá pravidlo).
-- Dlouhá podmínka nebo tělo funkce pokračuje na dalším řádku, kde je
-- sloupec „co" prázdný (SQL Editor by širokou buňku ořízl).
with
tab as (
  select c.relrowsecurity as rls, c.relforcerowsecurity as vynucena
    from pg_class c
   where c.oid = 'public.companies'::regclass
),
pol as (
  select p.policyname, p.cmd, p.permissive, p.roles, p.qual, p.with_check,
         p.roles && array['public', 'anon', 'authenticated']::name[] as pro_appku
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'companies'
),
-- Každá podmínka zjednodušená STEJNĚ jako v kroku 1.
-- „pravda"  = celá je jen true / 1 = 1 / kdokoli přihlášený.
-- „spravce" = celá je jen dotaz na správce: je_spravce(), je_admin() nebo
--             exists(… profiles … id = auth.uid() and role = 'admin').
-- Cokoli navíc (or, další role, jiný sloupec) = zkontrolovat.
vyr as (
  select z.policyname,
         z.n in ('true', '1=1', 'auth.uidisnotnull',
                 'auth.role=''authenticated''', '''authenticated''=auth.role',
                 'auth.jwt->>''role''=''authenticated''',
                 '''authenticated''=auth.jwt->>''role''') as pravda,
         z.n in ('selectje_spravceasje_spravce', 'je_spravce',
                 'selectje_adminasje_admin', 'je_admin')
         or z.n ~ '^existsselect1fromprofiles[a-z_]*where(([a-z_]+\.)?id=auth\.uid|auth\.uid=([a-z_]+\.)?id)and([a-z_]+\.)?role=''admin''$'
         or z.n ~ '^existsselect1fromprofiles[a-z_]*where([a-z_]+\.)?role=''admin''and(([a-z_]+\.)?id=auth\.uid|auth\.uid=([a-z_]+\.)?id)$'
           as spravce
    from (select pol.policyname,
                 regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                   lower(v.vyraz),
                   '\(\s*select\s+(auth\.[a-z_]+\(\))\s+as\s+[a-z_]+\s*\)', '\1', 'g'),
                   '::(text|character varying|name|uuid|jsonb|json|boolean)\M', '', 'g'),
                   'public\.', '', 'g'),
                   '[\s()]', '', 'g') as n
            from pol
            cross join lateral unnest(array[pol.qual, pol.with_check]) as v(vyraz)
           where v.vyraz is not null) as z
),
druh as (
  select pol.*,
         coalesce((select bool_and(vyr.spravce) from vyr where vyr.policyname = pol.policyname), false) as jen_spravce,
         (pol.qual is null and pol.with_check is null)
         or coalesce((select bool_or(vyr.pravda) from vyr where vyr.policyname = pol.policyname), false) as bez_podminky,
         coalesce((select bool_and(vyr.pravda) from vyr where vyr.policyname = pol.policyname), true) as nic_neomezuje
    from pol
),
-- Funkce, na které se pravidla ptají. Kdyby ji někdo přepsal třeba na
-- „true", pravidla by jen VYPADALA bezpečně — proto se čte i její tělo.
fce as (
  select p.oid, p.proname, p.prosecdef,
         btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) as telo
    from pg_proc p
   where p.oid = to_regprocedure('public.je_spravce()')
      or (p.oid = to_regprocedure('public.je_admin()')
          and exists (select 1 from pol
                       where coalesce(pol.qual, '') || coalesce(pol.with_check, '') like '%je_admin()%'))
),
-- Práva k tabulce. První čtyři appka potřebuje, zbylá tři ne.
prava as (
  select x.poradi, x.pravo, x.appka_potrebuje,
         has_table_privilege('anon', 'public.companies', x.pravo)          as anon,
         has_table_privilege('authenticated', 'public.companies', x.pravo) as prihlaseny
    from (values (1, 'SELECT', true), (2, 'INSERT', true), (3, 'UPDATE', true), (4, 'DELETE', true),
                 (5, 'TRUNCATE', false), (6, 'REFERENCES', false), (7, 'TRIGGER', false))
         as x(poradi, pravo, appka_potrebuje)
),
problemy as (
  select 1 as k, 'ochrana řádků (RLS) je VYPNUTÁ' as popis
    from tab where not tab.rls
  union all
  select 2, 'zápis pouští i pravidlo „' || druh.policyname || '“ — podmínka není jen správce'
    from druh
   where druh.permissive = 'PERMISSIVE' and druh.cmd <> 'SELECT'
     and druh.pro_appku and not druh.jen_spravce
  union all
  select 3, 'pravidlo „' || x.jmeno || '“ chybí nebo je jiné, než má být'
    from (values ('companies: cte kazdy prihlaseny', 'SELECT'),
                 ('companies: zaklada jen spravce',  'INSERT'),
                 ('companies: upravuje jen spravce', 'UPDATE'),
                 ('companies: maze jen spravce',     'DELETE')) as x(jmeno, cmd)
   where not exists (
           select 1 from druh
            where druh.policyname = x.jmeno and druh.cmd = x.cmd
              and druh.permissive = 'PERMISSIVE'
              and 'authenticated' = any (druh.roles)
              and case when x.cmd = 'SELECT' then druh.bez_podminky else druh.jen_spravce end)
  union all
  select 4, 'zužující pravidlo „' || druh.policyname || '“ (' || druh.cmd || ') může appce něco zakázat'
    from druh
   where druh.permissive = 'RESTRICTIVE' and druh.pro_appku and not druh.nic_neomezuje
  union all
  select 5, 'nepřihlášený má právo ' || string_agg(prava.pravo, ', ' order by prava.poradi)
    from prava where prava.anon
  having count(*) > 0
  union all
  select 6, 'přihlášený nemá právo ' || string_agg(prava.pravo, ', ' order by prava.poradi)
            || ' — appka by firmy nečetla či nezapsala'
    from prava where prava.appka_potrebuje and not prava.prihlaseny
  having count(*) > 0
  union all
  select 7, 'funkce ' || fce.proname || ' se neptá jen na roli admin přihlášeného (viz řádek 7)'
    from fce
   where regexp_replace(lower(fce.telo), '\s', '', 'g')
         !~ '^selectexists\(select1from(public\.)?profiles[a-z_]*where([a-z_]+\.)?id=auth\.uid\(\)and([a-z_]+\.)?role=''admin''\);?$'
  union all
  select 8, 'přihlášený nesmí volat funkci ' || fce.proname || ' — správce by nic nezapsal'
    from fce where not has_function_privilege('authenticated', fce.oid, 'EXECUTE')
  union all
  select 9, 'ochrana je vynucená i pro vlastníka (FORCE) — „jen s polohou“ u firmy pak nemusí fungovat'
    from tab where tab.vynucena
  union all
  select 10, 'přihlášený má navíc právo ' || string_agg(prava.pravo, ', ' order by prava.poradi)
             || ' (pravidla ho nehlídají)'
    from prava where not prava.appka_potrebuje and prava.prihlaseny
  having count(*) > 0
),
-- Pravidla zrušená v kroku 1 (z paměti spojení), podmínky na jeden řádek.
zrusena as (
  select z.r ->> 'jmeno' as jmeno, z.r ->> 'pro' as pro,
         regexp_replace(coalesce(z.r ->> 'using', '—'), '\s+', ' ', 'g') as u,
         regexp_replace(coalesce(z.r ->> 'check', '—'), '\s+', ' ', 'g') as c
    from jsonb_array_elements(
           case when current_setting('subbau.zruseno', true) like '[%'
                then current_setting('subbau.zruseno', true)::jsonb
                else '[]'::jsonb end) as z(r)
),
-- Pravidla, která na firmách teď jsou, podmínky na jeden řádek.
ted as (
  select druh.*,
         regexp_replace(coalesce(druh.qual, '—'), '\s+', ' ', 'g') as u,
         regexp_replace(coalesce(druh.with_check, '—'), '\s+', ' ', 'g') as c
    from druh
)
-- Řádky výpisu. Podmínky se lámou po 70 znacích, tělo funkce po 100.
select v.co, v.podrobnost, v.podminka_using, v.podminka_check
  from (
    select 1 as skupina, lpad(problemy.k::text, 2, '0') || problemy.popis as klic, 1 as kus,
           '1 VÝSLEDEK' as co, 'POZOR — ' || problemy.popis as podrobnost,
           '' as podminka_using, '' as podminka_check
      from problemy
    union all
    select 1, '', 1, '1 VÝSLEDEK',
           'OK — firmy zakládá, mění a maže jen správce; číst je smí každý přihlášený; nepřihlášený nic',
           '', ''
     where not exists (select 1 from problemy)
    union all
    select 2, '', 1, '2 zrušená pravidla',
           case when current_setting('subbau.zruseno', true) is null
                then 'neví se — výpis běžel bez migrace'
                else 'žádné — nebylo co rušit' end,
           '', ''
     where not exists (select 1 from zrusena)
    union all
    select 2, zrusena.jmeno, kus.i,
           case when kus.i = 1 then '2 zrušené pravidlo „' || zrusena.jmeno || '“' else '' end,
           case when kus.i = 1 then zrusena.pro else '' end,
           substr(zrusena.u, (kus.i - 1) * 70 + 1, 70),
           substr(zrusena.c, (kus.i - 1) * 70 + 1, 70)
      from zrusena
     cross join lateral generate_series(1, ceil(greatest(length(zrusena.u), length(zrusena.c)) / 70.0)::int) as kus(i)
    union all
    select 3, '', 1, '3 ochrana řádků (RLS)',
           'před migrací: ' || coalesce(nullif(current_setting('subbau.rls_pred', true), ''), 'neví se')
           || ' · teď: ' || case when tab.rls then 'zapnutá' else 'VYPNUTÁ' end
           || ' · vynucená i pro vlastníka: ' || case when tab.vynucena then 'ANO' else 'ne' end,
           '', ''
      from tab
    union all
    select 4, '1', 1, '4 nepřihlášený (anon) smí',
           coalesce((select string_agg(prava.pravo, ', ' order by prava.poradi) from prava where prava.anon), 'nic'),
           '', ''
    union all
    select 4, '2', 1, '4 přihlášený (authenticated) smí',
           coalesce((select string_agg(prava.pravo, ', ' order by prava.poradi) from prava where prava.prihlaseny), 'nic'),
           '', ''
    union all
    select 5, ted.policyname, kus.i,
           case when kus.i = 1 then '5 pravidlo „' || ted.policyname || '“' else '' end,
           case when kus.i > 1 then ''
                else ted.cmd || ' · ' || lower(ted.permissive) || ' · ' || array_to_string(ted.roles, ', ') || ' → ' ||
                     case
                       when not ted.pro_appku                  then 'netýká se appky (jiná role)'
                       when ted.permissive = 'RESTRICTIVE' and ted.nic_neomezuje
                                                               then 'zužující, nic neomezuje'
                       when ted.permissive = 'RESTRICTIVE'     then 'zužující, může appce něco zakázat — ZKONTROLOVAT'
                       when ted.cmd = 'SELECT' and ted.bez_podminky then 'čtení všech firem'
                       when ted.cmd = 'SELECT'                 then 'čtení s podmínkou'
                       when ted.jen_spravce                    then 'zápis jen správce'
                       when ted.bez_podminky                   then 'zápis BEZ PODMÍNKY'
                       else 'zápis s jinou podmínkou — ZKONTROLOVAT'
                     end
           end,
           substr(ted.u, (kus.i - 1) * 70 + 1, 70),
           substr(ted.c, (kus.i - 1) * 70 + 1, 70)
      from ted
     cross join lateral generate_series(1, ceil(greatest(length(ted.u), length(ted.c)) / 70.0)::int) as kus(i)
    union all
    select 6, '1', 1, '6 správci v profilech',
           count(*) filter (where pr.role = 'admin') || ' s rolí admin',
           '', ''
      from public.profiles pr
    union all
    select 6, '2', 1, '6 správci zapsaní jinak',
           'POZOR: ' || count(*) || ' s rolí admin zapsanou jinak (velká písmena, mezera) — ti firmy měnit nebudou',
           '', ''
      from public.profiles pr
     where lower(btrim(pr.role::text)) = 'admin' and pr.role::text <> 'admin'
    having count(*) > 0
    union all
    select 7, fce.proname, kus.i,
           case when kus.i = 1
                then '7 funkce ' || fce.proname || ' ('
                     || case when fce.prosecdef then 'security definer' else 'security invoker' end || ')'
                else '' end,
           substr(fce.telo, (kus.i - 1) * 100 + 1, 100),
           '', ''
      from fce
     cross join lateral generate_series(1, greatest(1, ceil(length(fce.telo) / 100.0)::int)) as kus(i)
  ) as v
 order by v.skupina, v.klic, v.kus;
