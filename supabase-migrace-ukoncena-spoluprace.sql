-- =====================================================================
-- UKONČENÁ SPOLUPRÁCE — odběratel si u člověka označí, že už s ním
-- nepracuje, a od kdy
--
-- PROČ: v odkazu pro odběratele si Němci u každého člověka vedou fotku,
-- známku a poznámku. Chybělo jim tam označit, že s někým spolupráci
-- ukončili — a hlavně KDY. Bez data se pak nedá zpětně dohledat, odkdy
-- ten člověk na stavbě nebyl.
--
-- CO SKRIPT DĚLÁ: přidá k tabulce client_link_workers dva sloupce.
-- Zaškrtnutí a datum jsou schválně zvlášť: odběratel může vědět, že
-- spolupráce skončila, a datum doplnit až potom.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Dokud nikdo nic nezaškrtne, je
-- všude false a null a v odkazu se nic nezobrazí.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- Spustit se dá klidně víckrát, nic to nerozbije.
-- =====================================================================

begin;

alter table public.client_link_workers
  add column if not exists spoluprace_ukoncena boolean not null default false;

alter table public.client_link_workers
  add column if not exists spoluprace_do date;

comment on column public.client_link_workers.spoluprace_ukoncena is
  'Odběratel označil, že s tímhle člověkem už nespolupracuje.';
comment on column public.client_link_workers.spoluprace_do is
  'Den, kdy spolupráce skončila. Může být prázdné, i když je zaškrtnuto.';

-- Datum bez zaškrtnutí nedává smysl a naopak taky ne — ale zakazovat to
-- natvrdo by odběrateli znemožnilo zaškrtnout dřív a datum doplnit potom.
-- Hlídáme jen to, že datum není nesmyslně daleko v budoucnu.
alter table public.client_link_workers
  drop constraint if exists client_link_workers_spoluprace_do_check;
alter table public.client_link_workers
  add constraint client_link_workers_spoluprace_do_check
  check (spoluprace_do is null or spoluprace_do <= (current_date + interval '1 year'));

-- ---------------------------------------------------------------------
-- ZVÝRAZNĚNÍ POZNÁMKY — odběratel si smí poznámku udělat tučnou a barevnou
--
-- PROČ: poznámky jsou u všech lidí stejně šedé a ta důležitá se v nich
-- ztratí. Ukládá se jen „tučně ano/ne" a název barvy — žádné HTML, takže
-- se do stránky nedá propašovat nic cizího.
-- ---------------------------------------------------------------------
alter table public.client_link_workers
  add column if not exists pozn_tucne boolean not null default false;

alter table public.client_link_workers
  add column if not exists pozn_barva text;

comment on column public.client_link_workers.pozn_tucne is
  'Odběratel si přeje mít poznámku tučně.';
comment on column public.client_link_workers.pozn_barva is
  'Barva poznámky. Jen povolené názvy, ne libovolný text — kvůli bezpečnosti.';

alter table public.client_link_workers
  drop constraint if exists client_link_workers_pozn_barva_check;
alter table public.client_link_workers
  add constraint client_link_workers_pozn_barva_check
  check (pozn_barva is null or pozn_barva in ('cervena','oranzova','zelena','modra','cerna'));

commit;

-- =====================================================================
-- KONTROLA — musí vrátit všechny čtyři sloupce
-- =====================================================================
-- select column_name, data_type, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'client_link_workers'
--    and column_name in ('spoluprace_ukoncena', 'spoluprace_do',
--                        'pozn_tucne', 'pozn_barva');
--
-- Kontrolní dotaz na sloupec, který NEEXISTUJE (musí vrátit prázdno —
-- tím víte, že ta kontrola opravdu měří):
-- select column_name from information_schema.columns
--  where table_schema='public' and table_name='client_link_workers'
--    and column_name = 'takovy_sloupec_neni';
