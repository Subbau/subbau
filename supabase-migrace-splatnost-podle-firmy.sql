-- SPLATNOST FAKTUR PODLE FIRMY (31. 10. 2026)
-- Majitel: „u každé firmy je nastavená splatnost v Provizích, podle ní ať to
-- bere splatnosti faktur, buď 7/7 nebo 7/14" a „u firmy, kde je nastaveno 7/7,
-- když tam přidám lidi, tak jim to dá fakturaci 7/14".
--
-- PŘÍČINA: vlastní splatnost člověka (worker_commissions.payment_terms) měla
-- výchozí hodnotu 7/14 a nesměla být prázdná. Kdokoli dostal provizi, tomu se
-- 7/14 zapsalo samo jako vlastní výjimka — přebila firmu a uložení splatnosti
-- firmy takového člověka přeskočilo.
--
-- Dá se pustit opakovaně. Na konci vypíše lidi, kterým se změnily dny splatnosti.

-- 1) Vlastní splatnost smí být prázdná (= jede podle firmy) a sama se už nevyplní.
alter table public.worker_commissions alter column payment_terms drop not null;
alter table public.worker_commissions alter column payment_terms drop default;

-- 2) Samo zapsané 7/14 pryč. Zůstává, co někdo v Provizích výslovně vybral:
--    7/7, 7/10, 14/14 a 7/14 jen tam, kde ho historie úprav zná jako ruční změnu.
update public.worker_commissions wc
   set payment_terms = null
 where wc.payment_terms = '7/14'
   and not exists (
     select 1 from public.historie_uprav h
      where h.tabulka = 'worker_commissions'
        and h.akce = 'UPDATE'
        and h.komu = wc.worker_id
        and h.zmeny -> 'payment_terms' ->> 1 = '7/14');

-- 3) Dny splatnosti na fakturách podle firmy. Firma se pozná jako v Provizích:
--    jméno firmy, u skupiny bez firmy její název bez části za pomlčkou.
with tymy as (
  select t.id,
         nullif(t.payment_terms, '') as terms,
         coalesce(c.name,
                  nullif(btrim(regexp_replace(t.name, '\s+[—-]\s+.*$', '')), ''),
                  btrim(t.name)) as firma
    from public.teams t
    left join public.companies c on c.id = t.company_id
),
firma as (
  select t.id as team_id,
         coalesce(t.terms, (select t2.terms from tymy t2
                             where t2.firma = t.firma and t2.terms is not null
                             order by t2.id limit 1)) as terms
    from tymy t
),
cil as (
  select p.id,
         case when f.terms ~ '^\d+/\d+$' then split_part(f.terms, '/', 2)::int end as dni
    from public.profiles p
    join firma f on f.team_id = p.team_id
    left join public.worker_commissions wc on wc.worker_id = p.id
   where p.role in ('osvec', 'partak')
     and nullif(wc.payment_terms, '') is null
)
update public.profiles p
   set invoice_due_days = cil.dni
  from cil
 where p.id = cil.id
   and cil.dni is not null
   and p.invoice_due_days is distinct from cil.dni
returning p.full_name, p.invoice_due_days;
