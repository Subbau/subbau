-- =====================================================================
-- BEZPEČNOSTNÍ UDÁLOSTI V HISTORII ÚPRAV (přihlášení, odemčení Provizí)
--
-- PROČ: majitel 14. 10. 2026 — „když se někdo přihlásí do provizí nebo do
-- odkazu nebo do přístupu na export, nebo přihlásí se vůbec do appky, je
-- potřeba to zaznamenat do historie úprav".
--
-- CO TO DĚLÁ: přidá funkci public.zapis_bezpecnostni_udalost(p_typ), kterou
-- appka zavolá:
--   • po přihlášení do appky (jen jednou za skutečné přihlášení heslem —
--     ne při každém znovunačtení stránky se zapamatovaným přihlášením),
--   • po odemčení Provizí,
--   • po odemčení Odkazů pro odběratele,
--   • po odemčení generování PDF.
-- Funkce zapíše řádek do historie úprav (oblast „Bezpečnost"), stejně jako
-- ostatní úpravy. ZAPISUJE JEN SPRÁVCŮM (admin) — kroky pracovníků se do
-- historie nepíšou vůbec, stejně jako u všeho ostatního (jinak by denní
-- přihlášení 30 lidí historii zaplavilo). Odemykání provizí/odkazů/exportu
-- stejně může dělat jen admin, takže se to netýká.
--
-- CO TO NEDĚLÁ: nic jiného nemění, nemaže, nepřidává žádná práva navíc.
-- Appku si z appky nejde zavolat přímo (insert do historie zvenku pořád
-- nejde) — jde jen přes tuhle jednu funkci a jen tenhle jeden zápis.
-- Spustit se dá klidně víckrát.
-- Jak spustit: Supabase → SQL Editor → vložit celé → Run.
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $pojistka$
begin
  if to_regclass('public.historie_uprav') is null
     or to_regprocedure('public.je_spravce()') is null then
    raise exception 'Chybí historie úprav nebo je_spravce() — nejdřív spusťte supabase-migrace-historie-uprav.sql a fotka-pracovnika.sql. Nic se nezměnilo.';
  end if;
end $pojistka$;

create or replace function public.zapis_bezpecnostni_udalost(p_typ text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_jmeno text;
begin
  -- Jen správce — kroky pracovníků (jejich přihlášení) se do historie
  -- nepíšou, stejně jako nikde jinde v téhle tabulce.
  if not (select public.je_spravce()) then
    return;
  end if;
  select p.full_name into v_jmeno from public.profiles p where p.id = auth.uid();
  insert into public.historie_uprav (kdo, kdo_jmeno, tabulka, akce, zaznam_id, zmeny)
  values (auth.uid(), v_jmeno, 'bezpecnost', 'UPDATE', auth.uid()::text,
          jsonb_build_object('bezpecnostni_udalost', jsonb_build_array(null, p_typ)));
end
$fn$;

comment on function public.zapis_bezpecnostni_udalost(text) is
  'Zapíše bezpečnostní událost (přihlášení, odemčení Provizí/Odkazů/exportu) do historie úprav. Jen pro přihlášeného správce, jinak nic neudělá.';

-- Zavolat ji smí kterýkoli přihlášený (funkce sama pozná, že to není admin,
-- a tiše nic neudělá) — appka ji volá i z pracovníkovy appky kvůli přihlášení.
revoke all on function public.zapis_bezpecnostni_udalost(text) from public, anon;
grant execute on function public.zapis_bezpecnostni_udalost(text) to authenticated;

commit;

-- KONTROLA: funkce existuje a práva sedí (má vyjít accepts_authenticated=true,
-- accepts_anon=false).
select p.proname as funkce,
       has_function_privilege('authenticated', 'public.zapis_bezpecnostni_udalost(text)', 'execute') as accepts_authenticated,
       has_function_privilege('anon', 'public.zapis_bezpecnostni_udalost(text)', 'execute') as accepts_anon
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'zapis_bezpecnostni_udalost';
