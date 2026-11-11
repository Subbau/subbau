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
  kdo        uuid default auth.uid(),
  stav       text not null default 'odeslano' check (stav in ('rezervovano', 'odeslano'))
);
comment on table public.faktury_odeslane is
  'Která faktura kdy odešla e-mailem odběrateli. Jen správce.';
-- Jedna faktura = nejvýš jeden záznam: databáze tak nepustí dva správce odeslat tutéž
-- fakturu současně (druhý zápis selže). Vědomé znovuodeslání appka řeší smazáním starého.
-- (stav: „rezervovano" = odesílá se / nejisté, „odeslano" = potvrzeno)
alter table public.faktury_odeslane add column if not exists stav text not null default 'odeslano' check (stav in ('rezervovano', 'odeslano'));
create unique index if not exists faktury_odeslane_faktura on public.faktury_odeslane (invoice_id);

-- Který pokus o odeslání záznam drží (každé klepnutí na Odeslat má své číslo) — dokončit
-- nebo uklidit záznam smí jen ten pokus, který ho vytvořil.
alter table public.faktury_odeslane add column if not exists pokus text;
-- Pokus už začal posílat e-mail (server to označí těsně před SMTP, jednou — druhý stejný požadavek neprojde).
alter table public.faktury_odeslane add column if not exists odesilano boolean not null default false;

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

-- ČAS A VLASTNICTVÍ ROZHODUJE DATABÁZE, ne hodiny prohlížeče:
--  • faktury_rezervovat — založí záznam „rezervovano" (nebo převezme starší, viděný
--    správcem, a to jen když je odeslaný nebo rezervace starší 5 minut podle času serveru);
--  • faktury_potvrdit  — po odeslání e-mailu změní záznam na „odeslano" (jen vlastní pokus);
--  • faktury_uvolnit   — po jasné chybě záznam smaže, nebo vrátí původní (jen vlastní pokus).
create or replace function public.faktury_rezervovat(p_invoice text, p_komu text, p_pokus text, p_videno_stav text, p_videno_kdy timestamptz)
returns boolean language plpgsql as $f$
declare n int;
begin
  if p_videno_stav is null then
    insert into public.faktury_odeslane (invoice_id, komu, stav, pokus) values (p_invoice, p_komu, 'rezervovano', p_pokus)
      on conflict (invoice_id) do nothing;
    get diagnostics n = row_count;
  else
    update public.faktury_odeslane
       set stav = 'rezervovano', komu = p_komu, kdy = now(), kdo = auth.uid(), pokus = p_pokus, odesilano = false
     where invoice_id = p_invoice and stav = p_videno_stav and kdy = p_videno_kdy
       and (stav <> 'rezervovano' or kdy < now() - interval '5 minutes');
    get diagnostics n = row_count;
  end if;
  return n > 0;
end $f$;

create or replace function public.faktury_potvrdit(p_invoice text, p_pokus text)
returns timestamptz language plpgsql as $f$
declare t timestamptz;
begin
  update public.faktury_odeslane set stav = 'odeslano', kdy = now()
   where invoice_id = p_invoice and pokus = p_pokus and stav = 'rezervovano'
  returning kdy into t;
  return t;
end $f$;

create or replace function public.faktury_uvolnit(p_invoice text, p_pokus text, p_puv_stav text, p_puv_komu text, p_puv_kdy timestamptz)
returns boolean language plpgsql as $f$
declare n int;
begin
  if p_puv_stav is null then
    delete from public.faktury_odeslane where invoice_id = p_invoice and pokus = p_pokus;
  else
    update public.faktury_odeslane set stav = p_puv_stav, komu = p_puv_komu, kdy = p_puv_kdy, pokus = null, odesilano = false
     where invoice_id = p_invoice and pokus = p_pokus;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $f$;

-- Smí tenhle pokus teď poslat e-mail? ATOMICKY to spotřebuje: rezervace musí patřit pokusu, být
-- čerstvá (podle času serveru) a e-mail se z ní ještě neposílal. Volá to server těsně před SMTP.
create or replace function public.faktury_zacit_odesilani(p_invoice text, p_pokus text)
returns boolean language plpgsql as $f$
declare n int;
begin
  update public.faktury_odeslane set odesilano = true
   where invoice_id = p_invoice and pokus = p_pokus and stav = 'rezervovano'
     and odesilano = false and kdy > now() - interval '4 minutes';
  get diagnostics n = row_count;
  return n > 0;
end $f$;

revoke all on function public.faktury_rezervovat(text, text, text, text, timestamptz) from public, anon;
revoke all on function public.faktury_potvrdit(text, text) from public, anon;
revoke all on function public.faktury_uvolnit(text, text, text, text, timestamptz) from public, anon;
revoke all on function public.faktury_zacit_odesilani(text, text) from public, anon;
grant execute on function public.faktury_rezervovat(text, text, text, text, timestamptz) to authenticated;
grant execute on function public.faktury_potvrdit(text, text) to authenticated;
grant execute on function public.faktury_uvolnit(text, text, text, text, timestamptz) to authenticated;
grant execute on function public.faktury_zacit_odesilani(text, text) to authenticated;

commit;

-- Kontrola: obě tabulky existují, mají zapnutou ochranu řádků a funkce jsou na místě (4 řádky).
select c.relname as tabulka, c.relrowsecurity as ochrana_radku
  from pg_class c
 where c.oid in ('public.faktury_prijemci'::regclass, 'public.faktury_odeslane'::regclass)
 order by 1;
select proname as funkce from pg_proc
 where pronamespace = 'public'::regnamespace and proname in ('faktury_rezervovat', 'faktury_potvrdit', 'faktury_uvolnit', 'faktury_zacit_odesilani')
 order by 1;
