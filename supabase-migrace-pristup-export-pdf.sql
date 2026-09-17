-- =====================================================================
-- VLASTNÍ HESLO NA GENEROVÁNÍ PDF VÝKAZŮ
--
-- CO TO DĚLÁ: vygenerování PDF docházky v Týmech se zamkne vlastním
-- heslem. Do aplikace může mít přístup víc lidí — třeba asistentka, která
-- řeší jen doklady — a ta nemá vidět, kdo kolik odpracoval.
--
-- Hesla se zadávají v Přístupech, ve složce „Export / generování PDF".
-- Funguje to stejně jako u Provizí: e-mail + heslo, heslo se ukládá jen
-- jako otisk (SHA-256), ne v čitelné podobě.
--
-- Zbytek Týmů zůstává bez hesla — zamyká se jen to generování PDF.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jedna tabulka.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

create table if not exists public.export_access (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

comment on table public.export_access is
  'Kdo smí generovat PDF výkazy docházky. E-mail + otisk hesla (SHA-256).';

alter table public.export_access enable row level security;

-- Spravovat to smí jen správce — stejně jako přístupy k Provizím.
drop policy if exists export_access_admin on public.export_access;
create policy export_access_admin on public.export_access
  for all to authenticated
  using (exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p
                       where p.id = auth.uid() and p.role = 'admin'));

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- select email, created_at from public.export_access order by created_at;
