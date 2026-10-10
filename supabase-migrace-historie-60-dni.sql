-- =====================================================================
-- HISTORIE ÚPRAV SE DRŽÍ 60 DNÍ, PAK SE SAMA SMAŽE
--
-- PROČ: majitel 10. 10. 2026 —
--   „u historie úprav chci aby se záznamy ukládaly 2 měsíce, pak aby se
--    smazaly; dokud záznam nebude starší víc než 60 dní, tak tam zůstane".
--
-- Navazuje na supabase-migrace-historie-uprav.sql a
-- supabase-migrace-historie-jen-kancelar.sql (obě proběhly 2. 10.).
--
-- CO TO DĚLÁ:
--   1. Přidá funkci public.historie_uprav_promaz(). Smaže z historie
--      záznamy STARŠÍ než 60 dní (sloupec kdy). Záznam starý přesně 60 dní
--      ještě zůstane, smaže se až o chvilku později.
--   2. Připojí ji na historii jako spouštěč „po zápisu" (historie_uprav_
--      promaz_trg). Kdykoli se do historie něco zapíše (správce cokoli
--      změní — to je mnohokrát denně), uklidí se zároveň, co mezitím
--      zestárlo. Je to pár řádků denně a díky rejstříku podle kdy
--      (historie_uprav_kdy) to databáze najde hned, bez procházení celé
--      historie. Jedním zápisem se smaže nejvýš 5000 starých záznamů,
--      ať zápis nikdy nezdrží — co zbude, vezme další zápis.
--   3. Hned při spuštění jednou smaže všechno, co už je starší než 60 dní
--      (10. 10. 2026 nic — historie začala 2. 10. — ale ať to platí vždy).
--
-- PROČ NE PLÁNOVAČ (pg_cron): v projektu se nepoužívá a zapínat kvůli tomu
-- rozšíření na ostré databázi nechceme. Úklid „při dalším zápisu" stačí:
-- historie se plní každý pracovní den.
--
-- ÚKLID NIKDY NESHODÍ ZÁPIS. Když se mazání z jakéhokoli důvodu nepovede,
-- zapíše se jen varování do logu Supabase. Původní změna (docházka,
-- faktura…) i její záznam v historii se uloží normálně; staré záznamy
-- uklidí příští zápis.
-- ÚKLID NIKOHO NEČEKÁ A NIKOHO NEBLOKUJE. Záznam, který zrovna maže jiný
-- souběžný zápis, se přeskočí (skip locked) — nikdo nestojí ve frontě.
-- Úklid sám nic do historie nezapisuje a mazání ho znovu nespustí
-- (spouští se jen zápisem, ne mazáním) — žádné zacyklení.
--
-- CO TO NEDĚLÁ:
--   • nemění práva k historii (čte jen správce, serverový klíč dál nesmí
--     mazat ani přepisovat — maže jen tahle funkce s právy vlastníka),
--   • nemění pravidla, sloupce, rejstříky ani hlídač zapis_historie_uprav,
--   • nemaže nic mladšího než 60 dní a nedotkne se docházky ani ničeho
--     jiného mimo historii,
--   • nezapíná žádné rozšíření (pg_cron ani jiné).
--
-- DVĚ VĚCI, KTERÉ VĚDĚT:
--   • Kdyby do historie nikdo nic nezapsal (dlouhá dovolená celé kanceláře),
--     záznam starý 61 dní tam vydrží do první další změny. Pak zmizí sám.
--   • U smazaného pracovníka bere hlídač jméno z historie. Když byl smazán
--     a za 60 dní o něm v historii nic nezbylo, zůstane u nové změny jméno
--     prázdné (týká se jen řádků, které po smazání člověka ještě přijdou).
--
-- DATA SE MĚNÍ: z historie se smažou záznamy starší než 60 dní — teď
-- i průběžně. Nic jiného.
-- Spustit se dá klidně víckrát: podruhé už nic nesmaže (výpis ukáže 0).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- Supabase se kvůli slovům „drop" a „delete" může zeptat, jestli to opravdu
-- spustit — „drop" ruší jen spouštěč tohoto souboru (aby šel spustit
-- znovu), „delete" maže jen záznamy historie starší než 60 dní.
-- =====================================================================

begin;
-- Připojení spouštěče si na chvíli zamkne historii. Kdyby do ní zrovna
-- někdo zapisoval, migrace nečeká věčně: po pěti vteřinách skončí a nic
-- nezmění. Pak ji stačí pustit znovu.
set local lock_timeout = '5s';

-- ── 0. Kontroly předem ───────────────────────────────────────────────
do $pojistka$
declare
  v_typ text;
begin
  if to_regclass('public.historie_uprav') is null then
    raise exception 'Chybí historie úprav — nejdřív spusťte supabase-migrace-historie-uprav.sql. Nic se nezměnilo.';
  end if;
  select format_type(a.atttypid, a.atttypmod) into v_typ
    from pg_attribute a
   where a.attrelid = 'public.historie_uprav'::regclass
     and a.attname = 'kdy' and not a.attisdropped;
  if v_typ is distinct from 'timestamp with time zone' then
    raise exception 'Historie úprav nemá sloupec kdy s časem (je tam: %). Nic se nezměnilo.', coalesce(v_typ, 'nic');
  end if;
  -- Bez rejstříku podle kdy by úklid při každém zápisu procházel celou
  -- historii. Fungoval by, jen pomaleji — proto jen upozornění.
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.historie_uprav'::regclass
       and i.indkey[0] = (select a.attnum from pg_attribute a
                           where a.attrelid = 'public.historie_uprav'::regclass
                             and a.attname = 'kdy')) then
    raise notice 'POZOR: historie nemá rejstřík podle kdy (historie_uprav_kdy). Úklid poběží, ale pomaleji — rejstřík zakládá supabase-migrace-historie-uprav.sql.';
  end if;
end $pojistka$;

-- ── 1. Funkce úklidu ─────────────────────────────────────────────────
-- Spouštěč „jednou za zápis" (for each statement), ne za každý řádek:
-- hlídač zapisuje po jednom řádku, takže je to totéž, a hromadný zápis
-- (kdyby někdy byl) neuklízí stokrát.
-- Běží s právy vlastníka (security definer): mazat v historii nesmí nikdo
-- jiný, ani serverový klíč. Proto pevná search_path a tabulka se schématem.
-- Výběr přes „for update skip locked": dva souběžné zápisy se o stejné
-- staré řádky nepřetahují — druhý je přeskočí a jde dál, nikdo nečeká.
-- Řazení od nejstarších a strop 5000 drží každý úklid krátký; po delší
-- pauze zbytek dorazí další zápisy.
create or replace function public.historie_uprav_promaz()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  delete from public.historie_uprav h
   where h.id in (
     select s.id
       from public.historie_uprav s
      where s.kdy < now() - interval '60 days'   -- [60-DNI]
      order by s.kdy
      limit 5000
        for update skip locked);
  return null;
exception when others then
  -- Úklid nesmí nikdy zablokovat docházku ani nic jiného: když se mazání
  -- nepovede, zápis projde a v logu Supabase zůstane varování.
  raise warning 'Historie úprav: úklid záznamů starších 60 dní se nepovedl — % [%]. Zápis platí, uklidí se při dalším zápisu.',
    sqlerrm, sqlstate;
  return null;
end
$fn$;

comment on function public.historie_uprav_promaz() is
  'Úklid historie úprav: po každém zápisu smaže záznamy starší než 60 dní (nejvýš 5000 naráz). Chyba úklidu zápis neshodí.';

-- Spouští ji jen spouštěč; zvenku (přes API) ji volat nejde a nemá proč.
-- Supabase dává nové funkci právo spuštění všem rolím — tady se odebere.
revoke all on function public.historie_uprav_promaz() from public, anon, authenticated;
do $prava$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.historie_uprav_promaz() from service_role;
  end if;
end $prava$;

-- ── 2. Spouštěč na historii ──────────────────────────────────────────
-- Jen po ZÁPISU (insert). Mazání ho nespouští, takže se úklid nezacyklí.
drop trigger if exists historie_uprav_promaz_trg on public.historie_uprav;
create trigger historie_uprav_promaz_trg
  after insert on public.historie_uprav
  for each statement
  execute function public.historie_uprav_promaz();

-- ── 3. Jednorázový úklid hned teď ────────────────────────────────────
-- Bez stropu 5000 — teď se smaže všechno, co je starší než 60 dní.
do $uklid$
declare
  v_pocet bigint;
begin
  delete from public.historie_uprav h
   where h.kdy < now() - interval '60 days';
  get diagnostics v_pocet = row_count;
  -- Počet si zapamatuje jen tohle spojení — pro výpis na konci.
  perform set_config('subbau.historie_promazano', v_pocet::text, false);
end $uklid$;

commit;

-- Kontrola — má vyjít JEDEN řádek:
--   smazano_ted               = kolik záznamů starších 60 dní se teď smazalo
--                               (10. 10. 2026 nejspíš 0; při dalším spuštění 0)
--   starsich_nez_60_dni       = 0
--   nejstarsi_zaznam          = datum nejstaršího záznamu (nejvýš 60 dní zpět;
--                               prázdné = historie je prázdná)
--   funkce_maze_po_60_dnech   = true
--   spoustec_po_zapisu        = 1   (jen po zápisu, jednou za zápis)
--   anon_smi_spustit          = false
--   prihlaseny_smi_spustit    = false
--   server_smi_spustit        = false
--   server_smi_mazat_historii = false  (beze změny — maže jen úklid)
select nullif(current_setting('subbau.historie_promazano', true), '')::bigint as smazano_ted,
       (select count(*) from public.historie_uprav h
         where h.kdy < now() - interval '60 days') as starsich_nez_60_dni,
       (select min(h.kdy) from public.historie_uprav h) as nejstarsi_zaznam,
       coalesce((select p.prosrc like '%where s.kdy < now() - interval ''60 days''   -- [60-DNI]%'
                   from pg_proc p
                  where p.oid = to_regprocedure('public.historie_uprav_promaz()')), false) as funkce_maze_po_60_dnech,
       (select count(*)
          from pg_trigger t
         where t.tgrelid = to_regclass('public.historie_uprav')
           and t.tgname = 'historie_uprav_promaz_trg'
           and not t.tgisinternal
           and t.tgenabled in ('O', 'A')
           and t.tgtype = 4   -- 4 = po (after), jednou za příkaz, jen insert
           and t.tgfoid = to_regprocedure('public.historie_uprav_promaz()')) as spoustec_po_zapisu,
       has_function_privilege('anon', 'public.historie_uprav_promaz()', 'execute') as anon_smi_spustit,
       has_function_privilege('authenticated', 'public.historie_uprav_promaz()', 'execute') as prihlaseny_smi_spustit,
       case when exists (select 1 from pg_roles where rolname = 'service_role')
            then has_function_privilege('service_role', 'public.historie_uprav_promaz()', 'execute') end as server_smi_spustit,
       case when exists (select 1 from pg_roles where rolname = 'service_role')
            then has_table_privilege('service_role', 'public.historie_uprav', 'delete') end as server_smi_mazat_historii;
