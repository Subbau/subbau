-- =====================================================================
-- ZÁLOHOVÉ FAKTURY (Anzahlungsrechnungen)
--
-- CO TO DĚLÁ: správce vystaví za pracovníka zálohovou fakturu pro německého
-- odběratele. Doklad je celý německy, s reverse charge a platebními údaji.
-- Appka si zálohu zapamatuje, a když si pak pracovník vystaví běžnou fakturu,
-- SAMA mu ji z ní odečte.
--
-- Zálohovou fakturu smí vystavit JEN SPRÁVCE. Pracovník vidí jen ty svoje,
-- aby se mu odečet mohl propočítat — měnit je nemůže.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jedna tabulka.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

create table if not exists public.zalohove_faktury (
  id               uuid primary key default gen_random_uuid(),
  cislo            text not null,
  worker_id        uuid not null references public.profiles(id) on delete cascade,

  -- Dodavatel tak, jak vypadal v den vystavení. Doklad se zpětně nemění,
  -- i kdyby si pracovník mezitím změnil adresu nebo účet.
  supplier_name    text,
  supplier_address text,
  supplier_ic      text,
  supplier_dic     text,
  is_vat_payer     boolean not null default false,
  iban             text,
  swift            text,

  -- Odběratel (německá firma)
  customer_name    text,
  customer_address text,
  customer_ic      text,
  customer_dic     text,

  -- Doklad
  issue_date       date not null,
  due_date         date not null,
  due_days         integer,
  period_from      date,
  period_to        date,
  popis            text,                         -- Leistungsbeschreibung, německy
  castka           numeric(12,2) not null check (castka > 0),

  -- Zúčtování: kolik z té zálohy už se odečetlo a na kterých fakturách.
  -- `zuctovani` drží částku ZVLÁŠŤ za každé číslo faktury, např.
  -- {"202611": 300.00, "202612": 200.00}. Bez toho by se při rozdělení jedné
  -- zálohy mezi dvě faktury druhý zápis přepsal a část zálohy by se dala
  -- odečíst dvakrát. `zuctovano` je jejich součet — pro rychlý přehled.
  zuctovano        numeric(12,2) not null default 0 check (zuctovano >= 0),
  zuctovani        jsonb not null default '{}'::jsonb,
  zuctovano_cislo  text,
  zuctovano_at     timestamptz,
  stav             text not null default 'otevrena'
                   check (stav in ('otevrena', 'zuctovana', 'stornovana')),

  pdf_url          text,
  pdf_path         text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Doplnění sloupců, když tabulka už existuje z dřívějšího spuštění. Uvnitř
-- `create table if not exists` by se nové sloupce nikdy nepřidaly a appka by
-- pak zálohy tiše přestala odečítat.
alter table public.zalohove_faktury add column if not exists zuctovani jsonb not null default '{}'::jsonb;
alter table public.zalohove_faktury add column if not exists zuctovano numeric(12,2) not null default 0;
alter table public.zalohove_faktury add column if not exists zuctovano_cislo text;
alter table public.zalohove_faktury add column if not exists zuctovano_at timestamptz;
alter table public.zalohove_faktury add column if not exists pdf_url text;
alter table public.zalohove_faktury add column if not exists pdf_path text;

-- KDE JE PRAVDA O ODEČTECH. Pracovník do zálohových faktur zapisovat NESMÍ
-- (viděl by pak cizí a mohl by si je přepsat), ale svoji fakturu si ukládá sám.
-- Odečet se proto zapisuje K FAKTUŘE: seznam [{cislo, vzato}]. Kolik z každé
-- zálohy zbývá, se pak spočítá z faktur toho člověka. Bez toho by zúčtování
-- z telefonu pracovníka tiše selhalo na právech a záloha by se odečítala
-- každý týden znovu.
alter table public.worker_invoices add column if not exists zalohy_pouzite jsonb not null default '[]'::jsonb;

comment on column public.worker_invoices.zalohy_pouzite is
  'Které zálohové faktury a v jaké výši se z téhle faktury odečetly: [{"cislo":"Z202601","vzato":500.00}].';

comment on table public.zalohove_faktury is
  'Zálohové faktury (Anzahlungsrechnung) vystavené správcem za pracovníka. Odečtou se pracovníkovi z běžné faktury.';

-- Jedno číslo u jednoho pracovníka jen jednou.
create unique index if not exists zalohove_faktury_cislo_uniq
  on public.zalohove_faktury (worker_id, cislo);

-- Vyhledání otevřených záloh pracovníka při vystavení faktury.
create index if not exists zalohove_faktury_hledani
  on public.zalohove_faktury (worker_id, stav);

alter table public.zalohove_faktury enable row level security;

-- Správce může všechno.
drop policy if exists zalohove_faktury_admin on public.zalohove_faktury;
create policy zalohove_faktury_admin on public.zalohove_faktury
  for all to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'admin'));

-- Pracovník vidí JEN svoje zálohy a jen ke čtení — bez toho by si appka
-- v jeho telefonu nemohla spočítat, kolik mu z faktury odečíst.
drop policy if exists zalohove_faktury_vlastni on public.zalohove_faktury;
create policy zalohove_faktury_vlastni on public.zalohove_faktury
  for select to authenticated
  using (worker_id = auth.uid());

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select z.cislo, p.full_name, z.castka, z.zuctovano, z.stav, z.zuctovano_cislo
--   from public.zalohove_faktury z
--   join public.profiles p on p.id = z.worker_id
--  order by z.created_at desc;
