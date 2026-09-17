-- =====================================================================
-- FIRMY (s.r.o.) SE ZAMĚSTNANCI
--
-- CO TO DĚLÁ: někdy zprostředkujeme práci firmě, která má pod sebou vlastní
-- zaměstnance. Ti si v aplikaci normálně zapisují docházku, ale:
--   • nemají žádnou sazbu ani částku — fakturuje za ně celá firma
--   • provizi máme napsanou u FIRMY, za všechny její lidi dohromady
--   • nevidí fakturaci ani nic kolem živnosti, to je věc firmy
--
-- Tenhle sloupec říká, pod kterou firmu zaměstnanec patří. Ukazuje na
-- člověka, který má supplier_type = 'sro' (to už appka zná z fakturace).
--
-- Prázdná hodnota = běžný OSVČ, tedy přesně to, co platí dnes u všech.
-- Dokud se u někoho ručně nenastaví, nezmění se nic.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidává se jeden sloupec.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

alter table public.profiles
  add column if not exists zamestnavatel_id uuid references public.profiles(id) on delete set null;

comment on column public.profiles.zamestnavatel_id is
  'U zaměstnance firmy (s.r.o.) ukazuje na profil té firmy. '
  'Prázdno = běžný OSVČ. Firma se pozná podle supplier_type = ''sro''.';

-- „Kdo patří pod tuhle firmu" je dotaz, který se bude dělat často.
create index if not exists profiles_zamestnavatel_idx
  on public.profiles (zamestnavatel_id);

-- Zaměstnavatele mění jen správce — pracovník by se sám přeřadil pod firmu
-- (nebo z ní ven) a rozhodil tím provize i to, komu se co fakturuje.
create or replace function public.profiles_zamek_zamestnavatel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text;
  v_je_admin boolean;
begin
  v_jwt_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_jwt_role = 'service_role' then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  ) into v_je_admin;

  if v_je_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.zamestnavatel_id := null;
    return new;
  end if;

  new.zamestnavatel_id := old.zamestnavatel_id;
  return new;
end $$;

comment on function public.profiles_zamek_zamestnavatel() is
  'Zařazení pod firmu mění jen správce nebo server — ne pracovník sám sobě.';

drop trigger if exists profiles_zamek_zamestnavatel_trg on public.profiles;

create trigger profiles_zamek_zamestnavatel_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_zamek_zamestnavatel();

commit;

-- =====================================================================
-- KONTROLA
-- =====================================================================
-- Firmy: select full_name, company_name from public.profiles where supplier_type = 'sro';
-- Jejich lidé:
-- select z.full_name as zamestnanec, f.full_name as firma
--   from public.profiles z join public.profiles f on f.id = z.zamestnavatel_id
--  order by f.full_name, z.full_name;
