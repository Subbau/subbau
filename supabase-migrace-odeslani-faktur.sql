-- =====================================================================
-- ODESÍLÁNÍ FAKTUR ODBĚRATELI JEDNÍM KLIKEM (11. 11. 2026)
--
-- CO TO DĚLÁ: přidá dvě malé tabulky, nic existujícího nemění a žádná
-- data nemaže.
--   • faktury_prijemci — e-mail odběratele u každé firmy (skupiny), aby se
--     nemusel psát znovu. Sdílený pro všechny správce.
--   • faktury_odeslane — záznam „tahle faktura odešla na tenhle e-mail
--     tehdy", aby se nepoužila dvakrát a bylo vidět, co už odešlo.
-- Obě tabulky vidí a mění jen správce (public.je_spravce()).
--
-- Spustit se dá klidně víckrát (nic nepřepisuje).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí funkce public.je_spravce() — nejdřív spusťte supabase-migrace-fotka-pracovnika.sql. Nic se nezměnilo.';
  end if;
end $$;

create table if not exists public.faktury_prijemci (
  firma    text primary key,
  email    text not null,
  upraveno timestamptz not null default now(),
  upravil  uuid default auth.uid()
);
comment on table public.faktury_prijemci is
  'E-mail odběratele, kam se posílají faktury firmy (skupiny). Jen správce.';

create table if not exists public.faktury_odeslane (
  id         bigint generated always as identity primary key,
  invoice_id text not null,
  komu       text not null,
  kdy        timestamptz not null default now(),
  kdo        uuid default auth.uid()
);
comment on table public.faktury_odeslane is
  'Která faktura kdy odešla e-mailem odběrateli. Jen správce.';
-- Jedna faktura = nejvýš jeden záznam: databáze tak nepustí dva správce odeslat tutéž
-- fakturu současně (druhý zápis selže). Vědomé znovuodeslání appka řeší smazáním starého.
create unique index if not exists faktury_odeslane_faktura on public.faktury_odeslane (invoice_id);

alter table public.faktury_prijemci enable row level security;
alter table public.faktury_odeslane enable row level security;

drop policy if exists faktury_prijemci_spravce on public.faktury_prijemci;
create policy faktury_prijemci_spravce on public.faktury_prijemci
  for all to authenticated using (public.je_spravce()) with check (public.je_spravce());

drop policy if exists faktury_odeslane_spravce on public.faktury_odeslane;
create policy faktury_odeslane_spravce on public.faktury_odeslane
  for all to authenticated using (public.je_spravce()) with check (public.je_spravce());

revoke all on public.faktury_prijemci from anon;
revoke all on public.faktury_odeslane from anon;
grant select, insert, update, delete on public.faktury_prijemci to authenticated;
grant select, insert, update, delete on public.faktury_odeslane to authenticated;

commit;

-- Kontrola: obě tabulky existují a mají zapnutou ochranu řádků.
select c.relname as tabulka, c.relrowsecurity as ochrana_radku
  from pg_class c
 where c.oid in ('public.faktury_prijemci'::regclass, 'public.faktury_odeslane'::regclass)
 order by 1;
