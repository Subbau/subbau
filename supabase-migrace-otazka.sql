-- OTAZNÍK u řádku dne v Docházce (majitel 7. 11. 2026): správce označí, že je u pracovníka něco k vyřešení
-- (zavolat, doptat se). Řádek se podbarví světle oranžově a před hodinami je „?“. Dalším klepnutím zmizí.
-- Bezpečné spustit opakovaně. Bez této migrace appka běží dál, jen otazník vypíše „chybí sloupec“.
alter table public.attendance add column if not exists otazka boolean not null default false;

-- Příznak mění jen správce (role admin), server nebo zápis přímo v Supabase — ne pracovník sám sobě přes API
-- (stejné pravidlo jako u ručních částek výplaty, supabase-migrace-zamek-vyplaty.sql).
create or replace function public.attendance_zamek_otazky()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims text;
begin
  if tg_op = 'UPDATE' and new.otazka is not distinct from old.otazka then
    return new;
  end if;
  if tg_op = 'INSERT' and coalesce(new.otazka, false) = false then
    return new;
  end if;

  v_claims := coalesce(current_setting('request.jwt.claims', true), '');

  if v_claims <> '' and (v_claims::jsonb ->> 'role') = 'service_role' then
    return new;
  end if;
  if v_claims = ''
     and coalesce(current_setting('request.jwt.claim.sub', true), '') = ''
     and coalesce(current_setting('role', true), 'none') not in ('anon', 'authenticated') then
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    return new;
  end if;

  -- Kdokoli jiný: nový řádek bez otazníku, stávající zůstane, jak byl.
  if tg_op = 'INSERT' then
    new.otazka := false;
  else
    new.otazka := old.otazka;
  end if;
  return new;
end $$;

revoke all on function public.attendance_zamek_otazky() from public, anon, authenticated;

drop trigger if exists attendance_zamek_otazky_trg on public.attendance;
create trigger attendance_zamek_otazky_trg
  before insert or update of otazka on public.attendance
  for each row execute function public.attendance_zamek_otazky();
