-- =====================================================================
-- POJISTKA PROTI DVOJITÝM PODSKUPINÁM
--
-- CO SE NAŠLO (dorovnání 1. 10. 2026): dvojité podskupiny v databázi
-- teď nejsou, ale pojistka proti nim chybí — oprava z 23. 8. 2026
-- (supabase-oprava-duplicitni-podskupiny.sql) zřejmě nikdy neproběhla.
-- Appka si stejný název hlídá sama, jenže jen do chvíle, kdy dva správci
-- (nebo dvě okna) založí tutéž podskupinu ve stejnou vteřinu.
--
-- CO TO DĚLÁ: založí jen tu pojistku — v jedné firmě nesmí být dvě
-- AKTIVNÍ podskupiny se stejným názvem (velikost písmen a mezery okolo
-- se nepočítají). Smazané (skryté) podskupiny se nepočítají, takže
-- smazaný název jde použít znovu. V různých firmách stejný název smí být.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Kdyby mezitím dvojice vznikla,
-- skript skončí hláškou a nezaloží nic (starý skript z 23. 8. by dvojice
-- mazal — ten se NEPOUŠTÍ). Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Hláška „lock timeout" znamená, že s podskupinami zrovna někdo pracoval;
-- stačí pustit znovu.
-- =====================================================================

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.subteams') is null then
    raise exception 'Tabulka public.subteams neexistuje. Nic se nezměnilo.';
  end if;
  if exists (select 1 from public.subteams
              where coalesce(is_active, true)
              group by team_id, lower(btrim(name))
             having count(*) > 1) then
    raise exception 'V jedné firmě jsou dvě aktivní podskupiny se stejným názvem — pojistka se nezaložila a nic se nezměnilo. Pošlete mi prosím tuhle hlášku.';
  end if;
end $$;

create unique index if not exists subteams_team_name_uniq
  on public.subteams (team_id, lower(btrim(name)))
  where coalesce(is_active, true);

comment on index public.subteams_team_name_uniq is
  'V jedné firmě nesmí být dvě aktivní podskupiny se stejným názvem (velikost písmen a mezery okolo se nepočítají).';

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Dva řádky, oba „OK".
select case when exists (
         select 1 from pg_index x
           join pg_class i on i.oid = x.indexrelid
          where i.relname = 'subteams_team_name_uniq'
            and x.indrelid = 'public.subteams'::regclass
            and x.indisunique and x.indisvalid)
       then 'OK' else 'POZOR' end as vysledek,
       'pojistka (unikátní index)' as kontrola,
       coalesce((select left(regexp_replace(indexdef, '^.* USING btree ', ''), 100)
                   from pg_indexes
                  where schemaname = 'public' and indexname = 'subteams_team_name_uniq'), 'CHYBÍ') as podrobnost
union all
select case when count(*) = 0 then 'OK' else 'POZOR' end,
       'dvojité aktivní podskupiny',
       case when count(*) = 0 then 'žádné' else count(*) || ' názvů víckrát v jedné firmě' end
  from (select 1 from public.subteams
         where coalesce(is_active, true)
         group by team_id, lower(btrim(name))
        having count(*) > 1) d;
