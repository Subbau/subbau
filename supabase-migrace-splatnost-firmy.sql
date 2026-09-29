-- =====================================================================
-- SPLATNOST SE NASTAVUJE U FIRMY
--
-- CO TO DĚLÁ: u každé firmy se dá nastavit kód splatnosti (7/7, 7/10,
-- 7/14 nebo 14/14). Komu tu firmu přiřadíte, tomu se splatnost
-- předvyplní — nemusí se zadávat u každého člověka zvlášť.
--
-- U jednotlivce se dá pořád nastavit vlastní, která firemní přebije.
-- Prázdná hodnota u člověka znamená „podle firmy".
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.teams
  add column if not exists payment_terms text;

comment on column public.teams.payment_terms is
  'Výchozí splatnost firmy ve tvaru "dny_do_faktury/dny_do_splatnosti", '
  'např. 7/14. Komu firma patří a nemá vlastní, platí tahle.';

-- Hlídá tvar. Povolené jsou jen ty čtyři kódy, které appka nabízí —
-- překlep typu „7-14" nebo „7/114" by se jinak tiše uložil a splatnost
-- by se pak nedopočítala vůbec.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teams_payment_terms_tvar'
  ) then
    alter table public.teams
      add constraint teams_payment_terms_tvar
      check (payment_terms is null or payment_terms in ('7/7','7/10','7/14','14/14'));
  end if;
end $$;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi ten výpis. Musí být JEDEN řádek: sloupec payment_terms
-- typu text a vedle něj „ANO" u kontroly tvaru.
select c.column_name  as sloupec,
       c.data_type    as typ,
       case when exists (
         select 1 from pg_constraint where conname = 'teams_payment_terms_tvar'
       ) then 'ANO' else 'NE' end as hlida_tvar
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'teams'
   and c.column_name  = 'payment_terms';
