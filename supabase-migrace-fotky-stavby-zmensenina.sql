-- =====================================================================
-- ZMENŠENINA U FOTEK ZE STAVBY (site_photos.thumb_url)
--
-- PROČ: galerie fotek ze stavby u správce natahovala přímo originály
-- z telefonu (klidně několik MB každá) — appka 15. 10. 2026: "fotky stavby
-- se načítají týden". Appka teď ke každé nové fotce nahraje i malou
-- zmenšeninu (stejný princip jako fotka pracovníka má avatar-mini.jpg) a v
-- mřížce galerie se ukazuje ONA, ne originál. Stažení, tisk a otevření na
-- celou obrazovku pořád berou originál beze změny kvality.
--
-- CO TO DĚLÁ: přidá nepovinný sloupec thumb_url. Appka ho sama doplní při
-- dalším focení; starší fotky bez zmenšeniny se v galerii dál ukážou (jen
-- se zase natáhne originál, jako doteď — nic se jim nebere ani nemaže).
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.site_photos') is null then
    raise exception 'Chybí tabulka site_photos — nic se nezměnilo.';
  end if;
end $pojistka$;

alter table public.site_photos add column if not exists thumb_url text;

commit;

-- KONTROLA: sloupec existuje.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'site_photos' and column_name = 'thumb_url';
