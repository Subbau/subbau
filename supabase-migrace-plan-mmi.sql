-- =====================================================================
-- PLÁN MMI — ODKAZ ZE STAVBYPLÁNU
--
-- PROČ: majitel 23. 10. 2026: MMI ve Stavbyplánu plánuje a přesouvá naše
-- lidi po stavbách 14 dní dopředu a vyrobí „Odkaz pro SubBau". Docházka ho
-- má jednou uložený pro všechny správce a v sekci „Plán MMI" z něj ukazuje,
-- kdo kdy kde je a koho MMI přesunulo (přesuny navíc vyskočí na nástěnce).
--
-- CO TO DĚLÁ: založí tabulku public.plan_mmi s JEDINÝM řádkem (id = 1),
-- ve kterém leží odkaz. Odkaz nese tajný klíč, proto ho čtou a mění jen
-- správci (public.je_spravce()). Pracovníci k němu nemají přístup.
--
-- CO TO NEDĚLÁ: nic nemaže, na jiné tabulky nesahá. „Viděl jsem" u přesunů
-- se ukládá do už existující doc_alert_dismissals (klíč začíná „mmi|").
--
-- Spustit se dá klidně víckrát (idempotentní).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;

set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí funkce public.je_spravce(). Nic se nezměnilo.';
  end if;
end $$;

create table if not exists public.plan_mmi (
  id        smallint primary key default 1 check (id = 1),
  odkaz     text check (odkaz is null or odkaz ~ '^https://[a-z0-9-]+\.supabase\.co/functions/v1/subbau-plan\?t=[0-9a-fA-F]{64}$'),
  upraveno  timestamptz not null default now(),
  upravil   uuid
);

alter table public.plan_mmi enable row level security;

drop policy if exists plan_mmi_cte_spravce on public.plan_mmi;
create policy plan_mmi_cte_spravce on public.plan_mmi
  for select to authenticated
  using (public.je_spravce());

drop policy if exists plan_mmi_zaklada_spravce on public.plan_mmi;
create policy plan_mmi_zaklada_spravce on public.plan_mmi
  for insert to authenticated
  with check (public.je_spravce());

drop policy if exists plan_mmi_meni_spravce on public.plan_mmi;
create policy plan_mmi_meni_spravce on public.plan_mmi
  for update to authenticated
  using (public.je_spravce())
  with check (public.je_spravce());

-- Žádná DELETE politika: odkaz se nemaže, jen přepíše novým.

revoke all on public.plan_mmi from anon;
grant select, insert, update on public.plan_mmi to authenticated;

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- tabulka_existuje = 1, rls_zapnute = true, pravidel = 3
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'plan_mmi') as tabulka_existuje,
  (select c.relrowsecurity from pg_class c
    where c.relname = 'plan_mmi' and c.relnamespace = 'public'::regnamespace) as rls_zapnute,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'plan_mmi') as pravidel;
