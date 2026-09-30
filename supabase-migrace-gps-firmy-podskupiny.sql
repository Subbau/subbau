-- =====================================================================
-- „JEN S POLOHOU" I PRO CELOU FIRMU A PRO PODSKUPINU
--
-- Docházku „jen s polohou (GPS)" šlo dosud zapnout jen u skupiny (karta
-- v Týmech). Majitel 30. 9. 2026: „po celých firmách nebo skupinách nebo
-- podskupinách". Nově tedy tři úrovně:
--
--   FIRMA       odběratel, ke kterému je skupina v Týmech přiřazená
--               („🏢 Firma") — platí pro všechny její skupiny i podskupiny
--   SKUPINA     karta v Týmech — jako dosud
--   PODSKUPINA  parta uvnitř skupiny — jen pro lidi v ní
--
-- Platí, kde je zapnuto aspoň jedno. Vypnutí u podskupiny tedy nezruší
-- pravidlo zapnuté u celé skupiny nebo firmy.
--
-- Pracovník se ptá funkcí muj_zapis_jen_gps(); ta teď počítá všechny tři
-- úrovně. Vrací jen ano/ne — nic dalšího o firmách mu neprozradí.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se sloupce (u skupiny ho už
-- přidala migrace supabase-migrace-tymy-oznameni-puntiky.sql, tady se jen
-- pojistí) a přepíše se jedna funkce. Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.teams     add column if not exists zapis_jen_gps boolean not null default false;
alter table public.companies add column if not exists zapis_jen_gps boolean not null default false;
alter table public.subteams  add column if not exists zapis_jen_gps boolean not null default false;

comment on column public.companies.zapis_jen_gps is
  'True = ve všech skupinách a podskupinách téhle firmy příchod a odchod jen s povolenou polohou.';
comment on column public.subteams.zapis_jen_gps is
  'True = lidé v téhle podskupině zapisují příchod a odchod jen s povolenou polohou.';

-- security definer: pracovník nepotřebuje právo číst firmy ani skupiny,
-- dozví se jen ano/ne o sobě. Proto pevná search_path.
create or replace function public.muj_zapis_jen_gps()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(t.zapis_jen_gps, false)
        or coalesce(c.zapis_jen_gps, false)
        -- Podskupina platí, jen když patří do skupiny, kde člověk je, a není
        -- smazaná. „is_active" se čte přes to_jsonb, protože ve starších
        -- databázích ten sloupec u podskupin není.
        or coalesce(s.zapis_jen_gps
                    and s.team_id::text = p.team_id::text
                    and coalesce((to_jsonb(s) ->> 'is_active')::boolean, true), false)
      from public.profiles p
      left join public.teams t     on t.id = p.team_id
      left join public.companies c on c.id::text = t.company_id::text
      left join public.subteams s  on s.id::text = p.subteam_id::text
     where p.id = auth.uid()
  ), false)
$$;
revoke all on function public.muj_zapis_jen_gps() from public, anon;
grant execute on function public.muj_zapis_jen_gps() to authenticated;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi výpis celý. Řádky „sloupec:" musí být TŘI, u funkce „ANO".
-- Řádky „kdo smí měnit" ukážou, kdo smí firmy, skupiny a podskupiny
-- upravovat — to potřebuju vidět, ať si pracovník polohu nevypne sám.
select 'sloupec: ' || table_name || '.zapis_jen_gps' as co, data_type as podrobnost
  from information_schema.columns
 where table_schema = 'public' and column_name = 'zapis_jen_gps'
   and table_name in ('companies', 'teams', 'subteams')
union all
select 'funkce muj_zapis_jen_gps počítá firmu i podskupinu',
       case when pg_get_functiondef(p.oid) ilike '%companies%'
             and pg_get_functiondef(p.oid) ilike '%subteams%' then 'ANO' else 'NE' end
  from pg_proc p
 where p.proname = 'muj_zapis_jen_gps' and p.pronamespace = 'public'::regnamespace
union all
select 'kdo smí měnit ' || tablename || ': ' || policyname || ' (' || cmd || ')',
       coalesce(qual, '(bez podmínky)')
  from pg_policies
 where schemaname = 'public' and tablename in ('companies', 'teams', 'subteams')
   and cmd in ('UPDATE', 'ALL')
 order by 1;
