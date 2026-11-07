-- OTAZNÍK u řádku dne v Docházce (majitel 7. 11. 2026): správce označí, že je u pracovníka něco k vyřešení
-- (zavolat, doptat se). Řádek se podbarví světle oranžově a před hodinami je „?“. Dalším klepnutím zmizí.
-- Bezpečné spustit opakovaně. Bez této migrace appka běží dál, jen otazník vypíše „chybí sloupec“.
alter table public.attendance add column if not exists otazka boolean not null default false;
