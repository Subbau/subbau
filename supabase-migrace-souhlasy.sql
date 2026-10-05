-- POTVRZENÍ PŘI PRVNÍM PŘIHLÁŠENÍ (5. 10. 2026)
-- Nový OSVČ / parťák potvrdí informace o osobních údajích (GDPR), poloze,
-- údajích pro odběratele a prohlášení OSVČ. Každé potvrzení je doklad: kdo,
-- kdy (čas serveru), jakou verzi textu, celý text a jeho otisk (SHA-256).
--
-- Práva: pracovník smí jen VLOŽIT svoje potvrzení a číst svoje. Měnit ani
-- mazat nesmí nikdo z appky — ani správce; doklad musí zůstat, jak vznikl.
-- Správce čte všechna. anon nic.
-- Smazání profilu potvrzení nesmaže (worker_id se vynuluje, jméno a e-mail
-- zůstanou uložené u potvrzení).
-- Dokud tahle migrace neproběhne, appka okno neukazuje (nikoho nezamkne).

create table if not exists public.souhlasy (
  id bigint generated always as identity primary key,
  worker_id uuid references public.profiles(id) on delete set null,
  verze text not null,
  text_otisk text not null,
  text text not null,
  body jsonb not null default '{}'::jsonb,
  jmeno text,
  email text,
  zarizeni text,
  potvrzeno timestamptz not null default now()
);
create index if not exists souhlasy_worker_verze on public.souhlasy (worker_id, verze);

-- Čas potvrzení vždy ze serveru — telefon ho nemůže podstrčit.
create or replace function public.souhlasy_cas_serveru() returns trigger
language plpgsql set search_path = public as $cas$
begin
  new.potvrzeno := now();
  return new;
end $cas$;
drop trigger if exists souhlasy_cas on public.souhlasy;
create trigger souhlasy_cas before insert on public.souhlasy
  for each row execute function public.souhlasy_cas_serveru();

alter table public.souhlasy enable row level security;
revoke all on public.souhlasy from anon, authenticated, public;
grant select, insert on public.souhlasy to authenticated;

drop policy if exists souhlasy_vlozit_svoje on public.souhlasy;
create policy souhlasy_vlozit_svoje on public.souhlasy
  for insert to authenticated with check (worker_id = auth.uid());

drop policy if exists souhlasy_cist on public.souhlasy;
create policy souhlasy_cist on public.souhlasy
  for select to authenticated using (worker_id = auth.uid() or public.je_spravce());

-- Kontrola: má vyjít  souhlasy | true | 2 | false
select 'souhlasy' as tabulka,
  (select relrowsecurity from pg_class where oid = 'public.souhlasy'::regclass) as rls_zapnute,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'souhlasy') as pravidel,
  has_table_privilege('anon', 'public.souhlasy', 'select') as anon_smi_cist;
