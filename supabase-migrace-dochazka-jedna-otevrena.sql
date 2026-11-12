-- Jedna otevřená směna na člověka a den (12. 11. 2026, audit zátěže).
-- Proč: na slabém signálu telefon pošle příchod, odpověď se ztratí a příchod se zopakuje (nebo ho zapíšou dva telefony
-- naráz) — vznikla by druhá otevřená směna téhož dne, která se sčítá do týdne, výkazu a faktury.
-- Pojistka v databázi: (pracovník, den) smí mít jen JEDNU směnu bez odchodu. Uzavřené směny se neomezují
-- (v jednom dni jich může být kolik chceš), noční směna přes půlnoc má jiné datum.
-- Appka na odmítnutí (kód 23505) reaguje „Příchod už je zapsaný“ a načte stávající směnu.
--
-- POSTUP: nejdřív spustit KONTROLU (krok 1). Vypíše dny, kde už dnes je víc otevřených směn. Když nevypíše nic, spustit krok 2.
-- Když něco vypíše, nejdřív ty duplicity vyřešit (nechat jednu, ostatní uzavřít nebo smazat) — jinak by index nešel založit.

-- KROK 1: kontrola (nic nemění)
select worker_id, work_date, count(*) as otevrenych, array_agg(id order by check_in) as id_smeny
  from public.attendance
 where check_out is null and check_in is not null
 group by worker_id, work_date
having count(*) > 1
 order by work_date desc;

-- KROK 2: pojistka (spustit až když krok 1 nevrátil žádný řádek; spouští se zvlášť)
-- create unique index if not exists attendance_jedna_otevrena
--   on public.attendance (worker_id, work_date)
--   where check_out is null and check_in is not null;
