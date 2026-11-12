-- Hlídání čerpání záloh v databázi (audit 11. 11. 2026: dvě faktury si mohly odečíst tutéž zálohu,
-- storno/smazání zálohy mohlo proběhnout těsně po jejím zúčtování).
-- Appka funguje i BEZ této migrace (kontroluje čerstvě před zápisem); tahle migrace zavírá poslední
-- souběh na straně databáze. Idempotentní — jde pustit opakovaně. Nemění žádná existující data.
-- Hlídá se jen NOVÝ zápis: starší, už přečerpané faktury zůstanou, jak jsou, a jejich oprava
-- (která nemění zalohy_pouzite) projde.

-- 1) Faktura smí z jedné zálohy vzít jen tolik, kolik záloha obsahuje (po odečtení ostatních faktur).
create or replace function public.zalohy_hlidej_cerpani() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record; v_jinde numeric; v_castka numeric; v_stav text; v_drive numeric;
begin
  if new.worker_id is null or new.zalohy_pouzite is null or jsonb_typeof(new.zalohy_pouzite) <> 'array' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.zalohy_pouzite is not distinct from old.zalohy_pouzite then
    return new;
  end if;
  -- Jeden zámek na pracovníka: souběžný zápis druhé faktury i storno/smazání zálohy počká, až tahle skončí.
  perform pg_advisory_xact_lock(hashtext('zalohy:' || new.worker_id::text));
  -- Záporný odečet by uměle zvýšil zbývající částku zálohy (−100 + 200 = 100) — žádná položka nesmí být záporná.
  if exists (select 1 from jsonb_array_elements(new.zalohy_pouzite) q where coalesce(nullif(q->>'vzato', '')::numeric, 0) < 0) then
    raise exception 'Odečet zálohy nemůže být záporný.' using errcode = '23514';
  end if;
  -- Položky téhož čísla v jedné faktuře se sčítají (dvě položky po 60 € proti záloze 100 € = 120 €).
  for r in
    select e->>'cislo' as cislo, sum(coalesce((e->>'vzato')::numeric, 0)) as vzato
      from jsonb_array_elements(new.zalohy_pouzite) e
      where e->>'cislo' is not null
      group by e->>'cislo'
  loop
    continue when r.vzato <= 0;
    -- Kolik z té zálohy tahle faktura brala už dřív (u UPDATE) — starý přečerpaný odečet neblokuje opravu.
    v_drive := 0;
    if tg_op = 'UPDATE' and old.zalohy_pouzite is not null and jsonb_typeof(old.zalohy_pouzite) = 'array' then
      select coalesce(sum((e->>'vzato')::numeric), 0) into v_drive
        from jsonb_array_elements(old.zalohy_pouzite) e where e->>'cislo' = r.cislo;
    end if;
    continue when r.vzato <= v_drive + 0.005;   -- nic nového se nebere
    select z.castka, z.stav into v_castka, v_stav from public.zalohove_faktury z
      where z.worker_id = new.worker_id and z.cislo = r.cislo;
    if not found then
      raise exception 'Záloha % neexistuje (byla smazána) — nejde z ní nic odečíst.', r.cislo using errcode = '23514';
    end if;
    if v_stav = 'stornovana' then
      raise exception 'Záloha % je stornovaná — nejde z ní nic odečíst.', r.cislo using errcode = '23514';
    end if;
    select coalesce(sum((e->>'vzato')::numeric), 0) into v_jinde
      from public.worker_invoices w,
           jsonb_array_elements(case when jsonb_typeof(w.zalohy_pouzite) = 'array' then w.zalohy_pouzite else '[]'::jsonb end) e
      where w.worker_id = new.worker_id and w.id is distinct from new.id and e->>'cislo' = r.cislo;
    if v_jinde + r.vzato > v_castka + 0.01 then
      raise exception 'Záloha % je už čerpaná jinou fakturou (zbývá % z %).', r.cislo, greatest(v_castka - v_jinde, 0), v_castka
        using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists zalohy_hlidej_cerpani_trg on public.worker_invoices;
create trigger zalohy_hlidej_cerpani_trg
  before insert or update of zalohy_pouzite on public.worker_invoices
  for each row execute function public.zalohy_hlidej_cerpani();

-- 2) Zálohu, kterou už některá faktura odečetla, nejde smazat ani stornovat.
create or replace function public.zalohy_hlidej_storno() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cislo text; v_worker uuid; v_pouzito numeric;
begin
  if tg_op = 'UPDATE' then
    if new.stav is not distinct from old.stav or new.stav <> 'stornovana' then return new; end if;
    v_cislo := old.cislo; v_worker := old.worker_id;
  else
    v_cislo := old.cislo; v_worker := old.worker_id;
  end if;
  perform pg_advisory_xact_lock(hashtext('zalohy:' || v_worker::text));
  select coalesce(sum((e->>'vzato')::numeric), 0) into v_pouzito
    from public.worker_invoices w,
         jsonb_array_elements(case when jsonb_typeof(w.zalohy_pouzite) = 'array' then w.zalohy_pouzite else '[]'::jsonb end) e
    where w.worker_id = v_worker and e->>'cislo' = v_cislo;
  if v_pouzito > 0.005 then
    raise exception 'Záloha % už byla odečtená z faktury — nejde stornovat ani smazat.', v_cislo using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists zalohy_hlidej_storno_trg on public.zalohove_faktury;
create trigger zalohy_hlidej_storno_trg
  before update of stav or delete on public.zalohove_faktury
  for each row execute function public.zalohy_hlidej_storno();
