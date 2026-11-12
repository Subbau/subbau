-- Atomický zápis návštěvy veřejného odkazu pro odběratele (api/klient-dochazka.js).
-- Počet se zvyšuje přímo v databázi a čas poslední návštěvy se nikdy nevrátí zpět.
-- Bez této funkce klient funguje dál (podmíněný PATCH), jen s nižší přesností při souběhu.
-- Bezpečné spouštět opakovaně.
create or replace function public.klient_navsteva(p_id uuid, p_cas timestamptz, p_prvni boolean)
returns void
language sql
security invoker
as $$
  update public.client_links
     set posledni_navsteva = greatest(coalesce(posledni_navsteva, p_cas), p_cas),
         pocet_navstev = case when p_prvni then coalesce(pocet_navstev, 0) + 1 else pocet_navstev end
   where id = p_id;
$$;

revoke all on function public.klient_navsteva(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.klient_navsteva(uuid, timestamptz, boolean) to service_role;
