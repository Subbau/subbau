-- =====================================================================
-- DENÍK CHYB: STROP ZÁPISŮ, ÚKLID PO 90 DNECH, REJSTŘÍK PODLE ČLOVĚKA
--
-- PROČ: majitel 2. 11. 2026 — „v tom deníku to musí hlídat úplně všechno …
-- jakoukoliv chybu napříč aplikací to musí zaznamenat, abychom to dokázali
-- spravovat". Appka teď do chyby_appky zapisuje sama každou chybu (spadlý
-- dotaz, chybu v kódu, hlášku na obrazovce, nezapsaný příchod), servery
-- (api/*.js) a stránky bez přihlášení přes /api/chyba taky. Appka sama hlídá,
-- aby toho nebylo moc (stejná chyba do 5 minut jen jako počet). Tahle
-- migrace je pojistka na straně databáze pro případ, že se něco v telefonu
-- zacyklí nebo někdo deník zahlcuje schválně (registrace je otevřená), a úklid,
-- ať tabulka neroste donekonečna.
--
-- Navazuje na supabase-migrace-chyby-appky.sql (tabulka chyby_appky).
--
-- CO TO DĚLÁ:
--   1. Rejstřík (kdo, kdy) — deník i strop hledají záznamy podle člověka.
--   2. Hlídač před zápisem (chyby_appky_strop):
--      • čas zápisu určí server (kdy = teď); kdy chyba v telefonu opravdu
--        vznikla, nese appka v detail.vznikla,
--      • jméno vezme z profilu (kdo_jmeno poslané z telefonu nerozhoduje),
--      • zkrátí příliš dlouhé texty (místo 100 znaků, zpráva 2000,
--        podrobnosti 16 kB),
--      • STROP ZA HODINU (klouzavá hodina):
--          – jeden účet: 60 ručních zápisů (appka je zapisuje sama v místě
--            chyby) a 150 automatických (detail.zdroj = 'auto' — háčky na síti,
--            konzoli, hláškách); souhrny rychlosti (pomalost) zvlášť 40,
--          – všechny účty dohromady 3000; souhrny rychlosti všech účtů
--            dohromady zvlášť 200 (do 3000 se nepočítají),
--          – bez přihlášení (/api/chyba, kdo prázdné) dohromady 300,
--          – serverové funkce (server|…) zvlášť 300 — spam přes /api/chyba
--            je tak nevytlačí.
--        Přes strop se první přebytek v hodině změní na JEDEN řádek
--        „strop-zapisu" a každý další se do něj jen připočte (zahozeno)
--        a zahodí.
--      • NIKDY nic neodmítne chybou: zahozený záznam vrátí appce úspěch,
--        jinak by ho telefon posílal pořád dokola.
--   3. Úklid po zápisu (chyby_appky_promaz): když je v deníku něco staršího
--      než 90 dní, smaže to (nejvýš 5000 naráz, nikoho nečeká — skip locked);
--      chyba úklidu zápis neshodí. Plánovač (pg_cron) se nepoužívá.
--   4. Jednorázový úklid hned teď.
--   5. Zkouška naostro: na prvním skutečném účtu zkusí každý strop (ruční,
--      automatický, rychlost na účet i všech účtů, celkový, bez přihlášení,
--      server), jméno a čas ze serveru a zápis bez místa — a všechno vrátí.
--      Nic z ní nezůstane.
--
-- CO TO NEDĚLÁ: nemění sloupce ani pravidla (kdo smí zapisovat a číst),
-- nepřidává nic do appky a nic nemaže mladší 90 dní. Appka funguje stejně
-- i bez téhle migrace — jen bez stropu, úklidu a jména z profilu.
--
-- DATA SE MĚNÍ: smažou se záznamy deníku starší než 90 dní (teď i průběžně).
-- Spustit se dá klidně víckrát (podruhé už nic nesmaže).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- Supabase se kvůli slovům „drop" a „delete" může zeptat, jestli to opravdu
-- spustit — „drop" ruší jen spouštěče z tohoto souboru (aby šel spustit
-- znovu), „delete" maže jen záznamy deníku starší než 90 dní.
-- Hláška „lock timeout" znamená, že do deníku zrovna někdo zapisoval;
-- stačí pustit znovu.
-- Na konci se ukáže tabulka. První řádek začíná „OK" nebo „POZOR"; při
-- „POZOR" jsou pod ním řádky „problém" s tím, co nesedí.
-- =====================================================================

begin;
-- Připojení spouštěčů si na chvíli zamkne deník. Kdyby do něj zrovna někdo
-- zapisoval, migrace nečeká věčně: po pěti vteřinách skončí a nic nezmění.
set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $pojistka$
declare
  v_kdy text;
  v_kdo text;
begin
  if to_regclass('public.chyby_appky') is null then
    raise exception 'Chybí deník chyb — nejdřív spusťte supabase-migrace-chyby-appky.sql. Nic se nezměnilo.';
  end if;
  if to_regclass('public.profiles') is null then
    raise exception 'Chybí tabulka profiles. Nic se nezměnilo.';
  end if;
  select format_type(a.atttypid, a.atttypmod) into v_kdy
    from pg_attribute a
   where a.attrelid = 'public.chyby_appky'::regclass and a.attname = 'kdy' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into v_kdo
    from pg_attribute a
   where a.attrelid = 'public.chyby_appky'::regclass and a.attname = 'kdo' and not a.attisdropped;
  if v_kdy is distinct from 'timestamp with time zone' or v_kdo is distinct from 'uuid' then
    raise exception 'Deník chyb nemá očekávané sloupce (kdy: %, kdo: %). Nic se nezměnilo.',
      coalesce(v_kdy, 'nic'), coalesce(v_kdo, 'nic');
  end if;
end $pojistka$;

-- ── 1. Rejstřík podle člověka ────────────────────────────────────────
-- Strop počítá „kolik tenhle účet zapsal za poslední hodinu" při každém
-- zápisu; prohlížeč deníku filtruje podle člověka. Bez rejstříku by obojí
-- procházelo celou tabulku. (Rejstřík podle kdy už založila první migrace.)
create index if not exists chyby_appky_kdo_kdy_idx on public.chyby_appky (kdo, kdy desc);

-- ── 2. Hlídač před zápisem ───────────────────────────────────────────
-- Běží s právy vlastníka (security definer): musí spočítat i řádky, které
-- pracovník sám číst nesmí, přečíst jméno z profilu a připočíst přebytek do
-- značky strop-zapisu (úpravu deníku nikdo jiný nesmí). Pevná search_path.
-- Strop je přibližný: dva souběžné zápisy vidí stejný počet — proto se
-- značka hledá podle existence, ne podle rovnosti počtu.
-- Značka u přihlášeného zůstává pod jeho účtem: pravidlo „zapisuje jen sám
-- za sebe" se kontroluje až PO hlídači, řádek s prázdným kdo by mu spadl.
create or replace function public.chyby_appky_strop()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c_rucne  constant int := 60;    -- [STROP-RUCNE]  ručních zápisů za hodinu na účet
  c_auto   constant int := 150;   -- [STROP-AUTO]   automatických (detail.zdroj = 'auto') za hodinu na účet
  c_mereni constant int := 40;    -- [STROP-MERENI] souhrnů rychlosti (pomalost) za hodinu na účet
  c_bez    constant int := 300;   -- [STROP-BEZ]    bez přihlášení (/api/chyba) za hodinu dohromady
  c_server constant int := 300;   -- [STROP-SERVER] serverových funkcí (server|…) za hodinu dohromady
  v_vse    int := 3000;           -- [STROP-VSE]    všech účtů dohromady za hodinu
  v_mereni_vse int := 200;        -- [STROP-MERENI-VSE] souhrnů rychlosti všech účtů dohromady za hodinu
  v_txt    text;
  v_n      int;
  v_jmeno  text;
  v_auto   boolean;
  v_rozsah text;
  v_strop  int;
  v_id     uuid;
  v_druh   text;
begin
  -- CIZÍ ÚČET (kontrola Codexem 2. 11. 2026): hlídač běží s právy vlastníka
  -- (security definer) a účet bere z new.kdo, které posílá telefon. Přihlášený,
  -- který pošle cizí kdo (nebo žádné), by jinak ještě PŘED kontrolou práv
  -- (kdo = auth.uid()) přičetl zahozený zápis cizí značce strop-zapisu nebo
  -- značce „bez přihlášení" a vrátil null — kontrola práv by se o zápisu vůbec
  -- nedozvěděla. Takový řádek proto hlídač pustí beze změny dál a práva ho
  -- odmítnou. Server (servisní klíč) a SQL Editor auth.uid() nemají, ty se
  -- hlídají jako dřív.
  if auth.uid() is not null and new.kdo is distinct from auth.uid() then
    return new;
  end if;
  new.kdy := now();
  new.kde := left(coalesce(nullif(btrim(new.kde), ''), 'neuvedeno'), 100);
  -- „strop-zapisu" píše jen tenhle hlídač. Podvržený řádek s tímhle místem
  -- by jinak strop obešel (značky se do stropu nepočítají).
  if new.kde = 'strop-zapisu' then
    new.kde := 'strop-zapisu-zvenku';
  end if;
  new.zprava := left(new.zprava, 2000);
  if new.detail is not null and octet_length(new.detail::text) > 16000 then
    new.detail := jsonb_strip_nulls(jsonb_build_object(
      'zkraceno', left(new.detail::text, 4000),
      'bajtu', octet_length(new.detail::text),
      'zdroj', case when jsonb_typeof(new.detail) = 'object' then left(new.detail ->> 'zdroj', 100) end,
      't', case when jsonb_typeof(new.detail) = 'object' then left(new.detail ->> 't', 100) end,
      '_id', case when jsonb_typeof(new.detail) = 'object' then left(new.detail ->> '_id', 100) end));
  end if;
  v_auto := coalesce(jsonb_typeof(new.detail) = 'object' and new.detail ->> 'zdroj' = 'auto', false);

  if new.kdo is null then
    -- Bez přihlášení (zapisuje jen server: /api/chyba a api/_denik.js).
    new.kdo_jmeno := null;
    if new.kde like 'server|%' then
      v_rozsah := 'server';
      v_strop := c_server;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo is null and c.kde like 'server|%' and c.kdy > now() - interval '1 hour';
    else
      v_rozsah := 'bez-prihlaseni';
      v_strop := c_bez;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo is null and c.kde not like 'server|%' and c.kde <> 'strop-zapisu'
         and c.kdy > now() - interval '1 hour';
    end if;
  else
    select p.full_name into v_jmeno from public.profiles p where p.id = new.kdo;
    new.kdo_jmeno := left(coalesce(v_jmeno, new.kdo_jmeno), 200);

    -- Souhrny rychlosti mají vlastní rozpočet, ať nevytlačí skutečné chyby.
    if new.kde = 'pomalost' then
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo = new.kdo and c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
      if v_n >= c_mereni then
        return null;
      end if;
      -- Všechny účty dohromady (2. 11. 2026, oponentura): do celkového stropu
      -- 3000 se souhrny rychlosti nepočítají, takže bez vlastního celkového
      -- stropu by si kdokoli s víc účty (registrace je otevřená) zapsal 40
      -- řádků po 16 kB za hodinu na KAŽDÝ účet — i když skutečné chyby už
      -- celkový strop zahazuje. Píšou je jen správci (souhrn nejvýš jednou
      -- za 3 minuty v kartě), 200 za hodinu je pro ně víc než dost. Přebytek
      -- se zahodí potichu jako u stropu na účet (jsou to jen měření).
      -- Zkouška naostro (níž) ho smí na chvíli jen SNÍŽIT, nikdy zvýšit.
      v_txt := current_setting('subbau.chyby_zk_strop_mereni_vse', true);
      if v_txt ~ '^[0-9]{1,9}$' then
        v_mereni_vse := least(v_mereni_vse, v_txt::int);
      end if;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
      if v_n >= v_mereni_vse then
        return null;
      end if;
      return new;
    end if;

    v_rozsah := 'ucet';
    if v_auto then
      v_strop := c_auto;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo = new.kdo and c.kdy > now() - interval '1 hour'
         and c.kde not in ('pomalost', 'strop-zapisu')
         and coalesce(c.detail ->> 'zdroj', '') = 'auto';
    else
      v_strop := c_rucne;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo = new.kdo and c.kdy > now() - interval '1 hour'
         and c.kde not in ('pomalost', 'strop-zapisu')
         and coalesce(c.detail ->> 'zdroj', '') <> 'auto';
    end if;

    if v_n < v_strop then
      -- Celkový strop přes všechny účty: registrace je otevřená, kdokoli si
      -- založí víc účtů a každým by zapsal až 210 řádků za hodinu.
      -- Zkouška naostro (níž) ho smí na chvíli jen SNÍŽIT, nikdy zvýšit.
      v_txt := current_setting('subbau.chyby_zk_strop_vse', true);
      if v_txt ~ '^[0-9]{1,9}$' then
        v_vse := least(v_vse, v_txt::int);
      end if;
      select count(*) into v_n
        from public.chyby_appky c
       where c.kdo is not null and c.kdy > now() - interval '1 hour'
         and c.kde not in ('pomalost', 'strop-zapisu');
      if v_n < v_vse then
        return new;
      end if;
      v_rozsah := 'vse';
      v_strop := v_vse;
    end if;
  end if;

  if v_n < v_strop then
    return new;
  end if;

  -- ── Přes strop ──
  -- Značka téhle hodiny už je → přebytek se do ní jen připočte a zahodí.
  if v_rozsah = 'ucet' then
    select c.id into v_id
      from public.chyby_appky c
     where c.kdo = new.kdo and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
       and coalesce(c.detail ->> 'rozsah', 'ucet') = 'ucet'
     order by c.kdy desc
     limit 1;
  elsif v_rozsah = 'vse' then
    select c.id into v_id
      from public.chyby_appky c
     where c.kdy > now() - interval '1 hour' and c.kde = 'strop-zapisu'
       and c.detail ->> 'rozsah' = 'vse'
     order by c.kdy desc
     limit 1;
  else
    select c.id into v_id
      from public.chyby_appky c
     where c.kdo is null and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
       and c.detail ->> 'rozsah' = v_rozsah
     order by c.kdy desc
     limit 1;
  end if;
  -- U přihlášených se přebytek počítá zvlášť ruční / automatický.
  v_druh := case when v_rozsah not in ('ucet', 'vse') then 'zahozeno'
                 when v_auto then 'zahozeno_auto' else 'zahozeno_rucne' end;
  if v_id is not null then
    update public.chyby_appky c
       set detail = coalesce(c.detail, '{}'::jsonb) || jsonb_build_object(
             'zahozeno', (case when c.detail ->> 'zahozeno' ~ '^[0-9]{1,9}$'
                               then (c.detail ->> 'zahozeno')::int else 0 end) + 1,
             v_druh, (case when c.detail ->> v_druh ~ '^[0-9]{1,9}$'
                           then (c.detail ->> v_druh)::int else 0 end) + 1,
             'naposled', now())
     where c.id = v_id;
    return null;
  end if;

  -- První přebytek v hodině → z řádku se stane značka strop-zapisu.
  new.detail := jsonb_build_object(
      't', 'varovani', 'rozsah', v_rozsah, 'strop', v_strop,
      'zahozeno', 1, v_druh, 1, 'prvni_kde', new.kde, 'poprve', now(), 'naposled', now())
    || case when v_rozsah = 'ucet'
            then jsonb_build_object('strop_rucne', c_rucne, 'strop_auto', c_auto)
            else '{}'::jsonb end;
  new.kde := 'strop-zapisu';
  new.zprava := case v_rozsah
    when 'ucet' then 'Účet zapsal za hodinu víc, než deník pustí (' || c_rucne || ' ručních a '
                     || c_auto || ' automatických) — další se do konce hodiny jen počítají a zahazují.'
    when 'vse' then 'Všechny účty dohromady zapsaly za hodinu ' || v_strop
                    || ' záznamů — další se do konce hodiny jen počítají a zahazují.'
    when 'server' then 'Serverové funkce zapsaly za hodinu ' || c_server
                       || ' záznamů — další se do konce hodiny jen počítají a zahazují.'
    else 'Záznamů bez přihlášení přišlo za hodinu ' || c_bez
         || ' — další se do konce hodiny jen počítají a zahazují.' end;
  return new;
exception when others then
  -- Zápis chyby má přednost před stropem: když hlídač selže, záznam projde
  -- (jinak by se ztratil, nebo by ho telefon posílal dokola).
  raise warning 'Deník chyb: hlídač stropu selhal — % [%]. Záznam se zapíše bez stropu.', sqlerrm, sqlstate;
  return new;
end
$fn$;

comment on function public.chyby_appky_strop() is
  'Deník chyb: před zápisem určí čas serverem, vezme jméno z profilu, zkrátí texty a hlídá strop za hodinu (účet 60 ručních + 150 automatických, pomalost 40 na účet a 200 všech účtů, všechny účty 3000, bez přihlášení 300, server 300; přebytek do jedné značky strop-zapisu, u pomalosti potichu). Nikdy nevyhodí chybu.';

-- Spouští ho jen spouštěč; zvenku (přes API) volat nejde a nemá proč.
-- Supabase dává nové funkci právo spuštění všem rolím — tady se odebere.
revoke all on function public.chyby_appky_strop() from public, anon, authenticated;
do $prava$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.chyby_appky_strop() from service_role;
  end if;
end $prava$;

drop trigger if exists chyby_appky_strop_trg on public.chyby_appky;
create trigger chyby_appky_strop_trg
  before insert on public.chyby_appky
  for each row execute function public.chyby_appky_strop();

-- ── 3. Úklid po zápisu (90 dní) ──────────────────────────────────────
-- Vzor supabase-migrace-historie-60-dni.sql: jednou za zápis (for each
-- statement) a jen když je co mazat (rejstřík podle kdy to zjistí hned),
-- nejvýš 5000 řádků, souběžné zápisy se o staré řádky nepřetahují (skip
-- locked), chyba úklidu zápis neshodí. Mazání ho znovu nespustí (jen zápis),
-- takže se nezacyklí.
create or replace function public.chyby_appky_promaz()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not exists (select 1 from public.chyby_appky c
                  where c.kdy < now() - interval '90 days') then   -- [90-DNI]
    return null;
  end if;
  delete from public.chyby_appky c
   where c.id in (
     select s.id
       from public.chyby_appky s
      where s.kdy < now() - interval '90 days'   -- [90-DNI]
      order by s.kdy
      limit 5000
        for update skip locked);
  return null;
exception when others then
  raise warning 'Deník chyb: úklid záznamů starších 90 dní se nepovedl — % [%]. Zápis platí, uklidí se při dalším zápisu.',
    sqlerrm, sqlstate;
  return null;
end
$fn$;

comment on function public.chyby_appky_promaz() is
  'Úklid deníku chyb: po zápisu smaže záznamy starší než 90 dní (nejvýš 5000 naráz). Chyba úklidu zápis neshodí.';

revoke all on function public.chyby_appky_promaz() from public, anon, authenticated;
do $prava2$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.chyby_appky_promaz() from service_role;
  end if;
end $prava2$;

drop trigger if exists chyby_appky_promaz_trg on public.chyby_appky;
create trigger chyby_appky_promaz_trg
  after insert on public.chyby_appky
  for each statement execute function public.chyby_appky_promaz();

-- ── 4. Jednorázový úklid hned teď ────────────────────────────────────
-- Bez stropu 5000 — teď se smaže všechno, co je starší než 90 dní.
do $uklid$
declare
  v_pocet bigint;
begin
  delete from public.chyby_appky c where c.kdy < now() - interval '90 days';
  get diagnostics v_pocet = row_count;
  -- Počet si zapamatuje jen tohle spojení — pro výpis na konci.
  perform set_config('subbau.chyby_promazano', v_pocet::text, false);
end $uklid$;

-- ── 5. Zkouška naostro, která se hned vrátí ──────────────────────────
-- Na prvním skutečném účtu zkusí každý strop. Počítá s tím, co už v deníku
-- za poslední hodinu je (zkouška čeká přesně tolik, kolik do stropu chybí).
-- Každá část se vrátí (vlastní kód chyby ZK003) — v deníku nic nezůstane.
-- Výsledek každé části si spojení zapamatuje pro výpis na konci.
do $zkouska$
declare
  v_kdo     uuid;
  v_jmeno   text;
  v_pred    int;
  v_vse     int;
  v_znacek0 int;
  v_po      int;
  v_znacek  int;
  v_zahoz   int;
  v_cekam   int;
  v_kdy     timestamptz;
  v_jm      text;
  v_kde1    text;
  v_kde2    text;
  v_det     jsonb;
  v_vysl    text;
  v_cast    text;
begin
  select p.id, p.full_name into v_kdo, v_jmeno
    from public.profiles p
    join auth.users u on u.id = p.id
   order by p.id
   limit 1;

  foreach v_cast in array array['ucet-auto', 'ucet-rucne', 'pomalost', 'pomalost-vse', 'vse', 'bez-prihlaseni', 'server', 'jmeno-cas', 'bez-mista'] loop
    v_vysl := null;
    if v_kdo is null and v_cast in ('ucet-auto', 'ucet-rucne', 'pomalost', 'pomalost-vse', 'vse', 'jmeno-cas', 'bez-mista') then
      v_vysl := 'nebylo na kom vyzkoušet';
    else
      begin
        if v_cast = 'ucet-auto' then
          select count(*) into v_pred from public.chyby_appky c
           where c.kdo = v_kdo and c.kdy > now() - interval '1 hour'
             and c.kde not in ('pomalost', 'strop-zapisu') and coalesce(c.detail ->> 'zdroj', '') = 'auto';
          select count(*) into v_znacek0 from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
             and coalesce(c.detail ->> 'rozsah', 'ucet') = 'ucet';
          insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
          select v_kdo, 'zkouška', 'zk-strop', 'zkouška stropu ' || g, jsonb_build_object('zdroj', 'auto', 'i', g)
            from generate_series(1, 160) g;
          v_cekam := least(160, greatest(0, 150 - v_pred));
          select count(*) into v_po from public.chyby_appky c where c.kdo = v_kdo and c.kde = 'zk-strop';
          select count(*), max(case when c.detail ->> 'zahozeno' ~ '^[0-9]+$' then (c.detail ->> 'zahozeno')::int end)
            into v_znacek, v_zahoz
            from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
             and coalesce(c.detail ->> 'rozsah', 'ucet') = 'ucet';
          v_vysl := case when v_po = v_cekam and v_znacek = 1 and (v_znacek0 > 0 or v_zahoz = 160 - v_cekam)
                         then 'drží'
                         else 'nedrží (zapsáno ' || v_po || ' z 160, čekalo se ' || v_cekam || ', značek ' || v_znacek
                              || ', zahozeno ' || coalesce(v_zahoz::text, '-') || ')' end;

        elsif v_cast = 'ucet-rucne' then
          select count(*) into v_pred from public.chyby_appky c
           where c.kdo = v_kdo and c.kdy > now() - interval '1 hour'
             and c.kde not in ('pomalost', 'strop-zapisu') and coalesce(c.detail ->> 'zdroj', '') <> 'auto';
          select count(*) into v_znacek0 from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
             and coalesce(c.detail ->> 'rozsah', 'ucet') = 'ucet';
          insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
          select v_kdo, 'zkouška', 'zk-strop', 'zkouška ručního stropu ' || g, jsonb_build_object('zdroj', 'rucne', 'i', g)
            from generate_series(1, 70) g;
          v_cekam := least(70, greatest(0, 60 - v_pred));
          select count(*) into v_po from public.chyby_appky c where c.kdo = v_kdo and c.kde = 'zk-strop';
          select count(*), max(case when c.detail ->> 'zahozeno_rucne' ~ '^[0-9]+$' then (c.detail ->> 'zahozeno_rucne')::int end)
            into v_znacek, v_zahoz
            from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'strop-zapisu' and c.kdy > now() - interval '1 hour'
             and coalesce(c.detail ->> 'rozsah', 'ucet') = 'ucet';
          v_vysl := case when v_po = v_cekam and v_znacek = 1 and (v_znacek0 > 0 or v_zahoz = 70 - v_cekam)
                         then 'drží'
                         else 'nedrží (zapsáno ' || v_po || ' z 70, čekalo se ' || v_cekam || ', značek ' || v_znacek || ')' end;

        elsif v_cast = 'pomalost' then
          select count(*) into v_pred from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
          select count(*) into v_vse from public.chyby_appky c
           where c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
          insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
          select v_kdo, 'zkouška', 'pomalost', 'zkouška rychlosti ' || g, jsonb_build_object('zk', 'strop', 'i', g)
            from generate_series(1, 50) g;
          -- Projde, dokud je místo na účtu (40) i u všech účtů dohromady (200).
          v_cekam := least(50, greatest(0, 40 - v_pred), greatest(0, 200 - v_vse));
          select count(*) into v_po from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'pomalost' and c.detail ->> 'zk' = 'strop';
          v_vysl := case when v_po = v_cekam then 'drží'
                         else 'nedrží (zapsáno ' || v_po || ' z 50, čekalo se ' || v_cekam || ')' end;

        elsif v_cast = 'pomalost-vse' then
          -- Celkový strop souhrnů rychlosti se na chvíli sníží na „co už je
          -- + 5" (jen v téhle zkoušce, vrátí se s ní) — 200 řádků by zkouška
          -- psala zbytečně. Účet musí mít na svých 40 ještě aspoň 10 místa.
          select count(*) into v_vse from public.chyby_appky c
           where c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
          select count(*) into v_pred from public.chyby_appky c
           where c.kdo = v_kdo and c.kde = 'pomalost' and c.kdy > now() - interval '1 hour';
          if v_pred > 30 or v_vse + 5 >= 200 then
            v_vysl := 'nebylo na kom vyzkoušet';
          else
            perform set_config('subbau.chyby_zk_strop_mereni_vse', (v_vse + 5)::text, true);
            insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
            select v_kdo, 'zkouška', 'pomalost', 'zkouška rychlosti všech účtů ' || g, jsonb_build_object('zk', 'strop-vse', 'i', g)
              from generate_series(1, 10) g;
            select count(*) into v_po from public.chyby_appky c
             where c.kdo = v_kdo and c.kde = 'pomalost' and c.detail ->> 'zk' = 'strop-vse';
            v_vysl := case when v_po = 5 then 'drží'
                           else 'nedrží (zapsáno ' || v_po || ' z 10, čekalo se 5)' end;
          end if;

        elsif v_cast = 'vse' then
          -- Celkový strop se na chvíli sníží na „co už je + 5" (jen v téhle
          -- zkoušce, vrátí se s ní) — 3000 řádků by zkouška psala zbytečně.
          select count(*) into v_vse from public.chyby_appky c
           where c.kdo is not null and c.kdy > now() - interval '1 hour'
             and c.kde not in ('pomalost', 'strop-zapisu');
          select count(*) into v_pred from public.chyby_appky c
           where c.kdo = v_kdo and c.kdy > now() - interval '1 hour'
             and c.kde not in ('pomalost', 'strop-zapisu') and coalesce(c.detail ->> 'zdroj', '') = 'auto';
          if v_pred > 140 or v_vse + 5 >= 3000 then
            v_vysl := 'nebylo na kom vyzkoušet';
          else
            perform set_config('subbau.chyby_zk_strop_vse', (v_vse + 5)::text, true);
            insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
            select v_kdo, 'zkouška', 'zk-strop', 'zkouška celkového stropu ' || g, jsonb_build_object('zdroj', 'auto', 'i', g)
              from generate_series(1, 10) g;
            select count(*) into v_po from public.chyby_appky c where c.kdo = v_kdo and c.kde = 'zk-strop';
            select count(*) into v_znacek from public.chyby_appky c
             where c.kde = 'strop-zapisu' and c.detail ->> 'rozsah' = 'vse' and c.kdy > now() - interval '1 hour';
            v_vysl := case when v_po = 5 and v_znacek = 1 then 'drží'
                           else 'nedrží (zapsáno ' || v_po || ' z 10, čekalo se 5, značek ' || v_znacek || ')' end;
          end if;

        elsif v_cast in ('bez-prihlaseni', 'server') then
          v_kde1 := case when v_cast = 'server' then 'server|zk-strop' else 'zk-strop' end;
          if v_cast = 'server' then
            select count(*) into v_pred from public.chyby_appky c
             where c.kdo is null and c.kde like 'server|%' and c.kdy > now() - interval '1 hour';
          else
            select count(*) into v_pred from public.chyby_appky c
             where c.kdo is null and c.kde not like 'server|%' and c.kde <> 'strop-zapisu'
               and c.kdy > now() - interval '1 hour';
          end if;
          select count(*) into v_znacek0 from public.chyby_appky c
           where c.kdo is null and c.kde = 'strop-zapisu' and c.detail ->> 'rozsah' = v_cast
             and c.kdy > now() - interval '1 hour';
          insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, detail)
          select null, 'Podvrh', v_kde1, 'zkouška stropu ' || g, jsonb_build_object('i', g)
            from generate_series(1, 310) g;
          v_cekam := least(310, greatest(0, 300 - v_pred));
          select count(*), count(*) filter (where c.kdo_jmeno is not null) into v_po, v_zahoz
            from public.chyby_appky c where c.kdo is null and c.kde = v_kde1;
          select count(*) into v_znacek from public.chyby_appky c
           where c.kdo is null and c.kde = 'strop-zapisu' and c.detail ->> 'rozsah' = v_cast
             and c.kdy > now() - interval '1 hour';
          v_vysl := case when v_po = v_cekam and v_znacek = 1 and v_zahoz = 0 then 'drží'
                         else 'nedrží (zapsáno ' || v_po || ' z 310, čekalo se ' || v_cekam || ', značek ' || v_znacek
                              || ', se jménem ' || v_zahoz || ')' end;

        elsif v_cast = 'jmeno-cas' then
          insert into public.chyby_appky (kdo, kdo_jmeno, kde, zprava, kdy)
          values (v_kdo, 'Podvrh', 'zk-jmeno', 'zkouška jména', '2020-01-01');
          select c.kdo_jmeno, c.kdy into v_jm, v_kdy
            from public.chyby_appky c where c.kdo = v_kdo and c.kde = 'zk-jmeno';
          v_vysl := case when v_jm is not distinct from left(coalesce(v_jmeno, 'Podvrh'), 200) and v_kdy = now()
                         then 'v pořádku'
                         else 'nesedí (jméno ' || coalesce(v_jm, 'prázdné') || ', čas ' || coalesce(v_kdy::text, '-') || ')' end;

        elsif v_cast = 'bez-mista' then
          insert into public.chyby_appky (kdo, kde, zprava, detail)
          values (v_kdo, '', 'zk-bez-mista-1', jsonb_build_object('velke', repeat('y', 20000), 'zdroj', 'auto')),
                 (v_kdo, null, 'zk-bez-mista-2', null);
          select c.kde, c.detail into v_kde1, v_det
            from public.chyby_appky c where c.kdo = v_kdo and c.zprava = 'zk-bez-mista-1';
          select c.kde into v_kde2
            from public.chyby_appky c where c.kdo = v_kdo and c.zprava = 'zk-bez-mista-2';
          v_vysl := case when v_kde1 = 'neuvedeno' and v_kde2 = 'neuvedeno' and v_det ? 'zkraceno'
                              and (v_det ->> 'bajtu')::int > 16000 and v_det ->> 'zdroj' = 'auto'
                         then 'v pořádku'
                         else 'nesedí (' || coalesce(v_kde1, 'nic') || ', ' || coalesce(v_kde2, 'nic') || ')' end;
        end if;
        raise exception using errcode = 'ZK003', message = 'zkouška se vrací';
      exception
        when sqlstate 'ZK003' then null;
        when others then v_vysl := 'chyba: ' || sqlerrm;
      end;
    end if;
    perform set_config('subbau.chyby_zk_' || replace(v_cast, '-', '_'), coalesce(v_vysl, 'neběžela'), false);
  end loop;
  -- Snížené celkové stropy platily jen uvnitř zkoušky (vrátily se s ní);
  -- pro jistotu je tu ještě vynulovat.
  perform set_config('subbau.chyby_zk_strop_vse', '', true);
  perform set_config('subbau.chyby_zk_strop_mereni_vse', '', true);

  if exists (select 1 from public.chyby_appky c
              where c.kde in ('zk-strop', 'server|zk-strop', 'zk-jmeno')
                 or c.zprava in ('zk-bez-mista-1', 'zk-bez-mista-2')
                 or (c.kde = 'pomalost' and c.detail ->> 'zk' in ('strop', 'strop-vse'))) then
    raise exception 'Zkouška po sobě neuklidila (zůstaly její řádky). Nic se neuložilo, pošlete mi prosím tuhle hlášku.';
  end if;
end $zkouska$;

commit;


-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. První řádek má být „OK". Zkoušky mají „drží"
-- nebo „v pořádku" (na prázdné databázi „nebylo na kom vyzkoušet").
-- Když je první řádek „POZOR", pod ním jsou řádky „problém" s tím, co nesedí.
with
spoustece as (
  select t.tgname, t.tgenabled, t.tgtype, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%' as pevna_cesta,
         has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute') as zvenku
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.chyby_appky'::regclass
     and t.tgname in ('chyby_appky_strop_trg', 'chyby_appky_promaz_trg')
     and not t.tgisinternal
),
zkousky as (
  select x.poradi, x.kdo, x.ceka,
         coalesce(nullif(current_setting('subbau.chyby_zk_' || x.klic, true), ''),
                  'neví se — zkouška neběžela') as vysl
    from (values (1, 'ucet_auto',      'zkouška: účet, automatické zápisy (150 za hodinu)', 'drží'),
                 (2, 'ucet_rucne',     'zkouška: účet, ruční zápisy (60 za hodinu)',        'drží'),
                 (3, 'pomalost',       'zkouška: souhrny rychlosti (40 za hodinu)',         'drží'),
                 (4, 'pomalost_vse',   'zkouška: souhrny rychlosti všech účtů (200 za hodinu)', 'drží'),
                 (5, 'vse',            'zkouška: všechny účty dohromady (3000 za hodinu)',  'drží'),
                 (6, 'bez_prihlaseni', 'zkouška: bez přihlášení (300 za hodinu)',           'drží'),
                 (7, 'server',         'zkouška: serverové funkce (300 za hodinu)',         'drží'),
                 (8, 'jmeno_cas',      'zkouška: jméno z profilu a čas ze serveru',         'v pořádku'),
                 (9, 'bez_mista',      'zkouška: zápis bez místa a velké podrobnosti',      'v pořádku'))
         as x(poradi, klic, kdo, ceka)
),
problemy as (
  select 1 as k, 'hlídač chyby_appky_strop_trg CHYBÍ, je VYPNUTÝ nebo neběží před každým zápisem' as popis
   where not exists (select 1 from spoustece s
                      where s.tgname = 'chyby_appky_strop_trg' and s.tgenabled in ('O', 'A')
                        and s.tgtype = 7)   -- 7 = před (before) + za řádek + insert
  union all
  select 2, 'úklid chyby_appky_promaz_trg CHYBÍ, je VYPNUTÝ nebo neběží po zápisu'
   where not exists (select 1 from spoustece s
                      where s.tgname = 'chyby_appky_promaz_trg' and s.tgenabled in ('O', 'A')
                        and s.tgtype = 4)   -- 4 = po (after) + jednou za příkaz + insert
  union all
  select 3, 'chybí rejstřík chyby_appky_kdo_kdy_idx'
   where to_regclass('public.chyby_appky_kdo_kdy_idx') is null
  union all
  select 4, 'funkce ' || s.tgname || ' neběží s právy vlastníka nebo nemá pevnou search_path'
    from spoustece s where not s.prosecdef or not s.pevna_cesta
  union all
  select 5, 'funkci ' || s.tgname || ' jde spustit zvenku (anon/authenticated)'
    from spoustece s where s.zvenku
  union all
  select 6, z.kdo || ': ' || z.vysl
    from zkousky z where z.vysl <> z.ceka and z.vysl <> 'nebylo na kom vyzkoušet'
  union all
  select 7, 'v deníku zůstaly záznamy starší 90 dní: ' || count(*)
    from public.chyby_appky c where c.kdy < now() - interval '90 days' having count(*) > 0
  union all
  select 8, 'pravidla deníku se změnila (čekají se 2 a zapnutá ochrana řádků)'
   where (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'chyby_appky') <> 2
      or not (select c.relrowsecurity from pg_class c where c.oid = 'public.chyby_appky'::regclass)
)
select left(v.co, 100) as co, left(v.podrobnost, 160) as podrobnost
  from (
    select 0 as poradi, '' as pod,
           case when exists (select 1 from problemy) then 'POZOR' else 'OK' end as co,
           case when exists (select 1 from problemy)
                then (select count(*) from problemy) || ' problém(y) — viz řádky „problém" níž'
                else 'strop drží, úklid po 90 dnech běží, zkouška vrácena — v deníku po ní nic nezůstalo'
           end as podrobnost
    union all
    select 1, lpad(pr.k::text, 3, '0'), 'problém', pr.popis from problemy pr
    union all
    select 2, '', 'hlídač před zápisem',
           coalesce((select case when s.tgenabled in ('O', 'A') then 'zapnutý — chyby_appky_strop_trg' else 'VYPNUTÝ' end
                       from spoustece s where s.tgname = 'chyby_appky_strop_trg'), 'CHYBÍ')
    union all
    select 3, '', 'úklid po zápisu (90 dní)',
           coalesce((select case when s.tgenabled in ('O', 'A') then 'zapnutý — chyby_appky_promaz_trg' else 'VYPNUTÝ' end
                       from spoustece s where s.tgname = 'chyby_appky_promaz_trg'), 'CHYBÍ')
    union all
    select 4, z.poradi::text, z.kdo,
           z.vysl || case when z.vysl = z.ceka then ' — zkouška vrácena, nic se neuložilo' else '' end
      from zkousky z
    union all
    select 5, '', 'smazáno teď (starší 90 dní)',
           coalesce(nullif(current_setting('subbau.chyby_promazano', true), ''), '?') || ' (při dalším spuštění 0)'
    union all
    select 6, '', 'záznamů v deníku',
           count(*)::text || ', za poslední hodinu ' || count(*) filter (where c.kdy > now() - interval '1 hour')
      from public.chyby_appky c
  ) as v
 order by v.poradi, v.pod;
