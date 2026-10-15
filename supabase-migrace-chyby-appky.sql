-- =====================================================================
-- TICHÝ DENÍK CHYB APPKY (chyby_appky)
--
-- PROČ: appka na slabém signálu na stavbě umí narazit na chybu, kterou teď
-- jen potichu spolkne (console.warn, nikdo to nevidí) — a pracovník to pozná
-- až tak, že se mu něco nikdy neuloží a musí to zkoušet znovu a znovu (přesně
-- tohle se stalo 15. 10. 2026 s podpisem vedoucího a s odesláním faktury
-- e-mailem). Majitel 15. 10. 2026: chce vidět tyhle chyby sám, dřív než mu je
-- někdo nahlásí — ale appka sama nic neopravuje ani nenasazuje, jen zapisuje.
--
-- CO TO DĚLÁ: nová tabulka public.chyby_appky. Kdokoli přihlášený do ní smí
-- zapsat ZÁZNAM O SOBĚ SAMÉM (svoje id jako kdo) — i obyčejný pracovník,
-- protože přesně jeho appka na stavbě na chybu narazí. Číst smí jen správce.
-- Nejde přepsat ani smazat cizí záznam (žádná UPDATE/DELETE politika vůbec).
--
-- CO TO NEDĚLÁ: nic neopravuje, nic nemaže automaticky (zatím — až uvidíme,
-- kolik záznamů appka reálně píše, dá se podle vzoru historie_uprav přidat
-- úklid starých záznamů; teď by to byl úklid naslepo).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí je_spravce() — nejdřív spusťte supabase-migrace-historie-uprav.sql. Nic se nezměnilo.';
  end if;
end $pojistka$;

create table if not exists public.chyby_appky (
  id uuid primary key default gen_random_uuid(),
  kdy timestamptz not null default now(),
  kdo uuid references auth.users(id) on delete set null,
  kdo_jmeno text,
  -- Kde se appka zasekla — jméno funkce/akce, ne volný text (ať se dá filtrovat).
  kde text not null,
  zprava text,
  -- Volitelné podrobnosti (číslo týdne, délka podpisu apod.) — NIKDY hesla,
  -- tokeny nebo jiné citlivé údaje; appka sama by sem nic takového zapisovat neměla.
  detail jsonb
);

create index if not exists chyby_appky_kdy_idx on public.chyby_appky (kdy desc);

alter table public.chyby_appky enable row level security;

drop policy if exists chyby_appky_zapis_sam_sebe on public.chyby_appky;
create policy chyby_appky_zapis_sam_sebe on public.chyby_appky
  for insert to authenticated
  with check (kdo = auth.uid());

drop policy if exists chyby_appky_cte_spravce on public.chyby_appky;
create policy chyby_appky_cte_spravce on public.chyby_appky
  for select to authenticated
  using (public.je_spravce());

-- Žádná UPDATE/DELETE politika — bez ní RLS všem takové příkazy odmítne,
-- i správci. Smazat starý záznam jde jen přímo v Supabase (service role).

commit;

-- KONTROLA: RLS zapnuté, politiky přesně dvě (insert sám sobě, select správce).
select c.relrowsecurity as rls_zapnute,
       (select count(*) from pg_policies p where p.schemaname='public' and p.tablename='chyby_appky') as pravidel
  from pg_class c
 where c.relname = 'chyby_appky' and c.relnamespace = 'public'::regnamespace;
