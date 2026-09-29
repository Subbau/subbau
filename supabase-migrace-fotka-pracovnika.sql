-- =====================================================================
-- FOTKU PRACOVNÍKA SMÍ NASTAVIT SPRÁVCE
--
-- CO TO DĚLÁ: správce může nahrát fotku i za pracovníka, který si ji
-- sám nenahrál. Do teď to šlo jen z mobilu toho člověka.
--
-- PROČ TO POTŘEBUJE MIGRACI: fotky leží v úložišti ve složce pojmenované
-- po tom člověku (avatars/<id pracovníka>/avatar.jpg). Úložiště dosud
-- pouštělo každého jen do JEHO vlastní složky, takže zápis správce do
-- cizí složky odmítalo.
--
-- ŽÁDNÁ DATA SE NEMĚNÍ ANI NEMAŽOU. Přidávají se dvě pravidla úložiště.
-- Nic se neodebírá — dosavadní nahrávání z mobilu zůstává, jak bylo.
-- Spustit se dá klidně víckrát.
--
-- Jak spustit: Supabase → SQL Editor → vložit → Run.
-- =====================================================================

begin;

-- ── 1. Kdo je správce ────────────────────────────────────────────────
-- Vlastní funkce schválně: to samé se jinak opisuje do každého pravidla
-- zvlášť a při změně se na jedno místo zapomene.
--
-- SECURITY INVOKER (výchozí) a čtení JEN VLASTNÍHO řádku — funkce se
-- nikoho neptá na cizí profily, takže z ní nejde vyčíst, kdo všechno
-- je správce.
create or replace function public.je_spravce()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'admin'
  )
$$;

comment on function public.je_spravce() is
  'True, když přihlášený člověk má v profiles roli admin.';

-- ── 2. Pravidla úložiště ─────────────────────────────────────────────
-- Zakládá se „smaž, pokud je, a vytvoř" — aby šlo spustit vícekrát.
-- Pravidla se jmenují jinak než ta dosavadní, takže nahrávání z mobilu
-- se jich netýká.
drop policy if exists "avatars: fotku pracovnika nahraje spravce" on storage.objects;
create policy "avatars: fotku pracovnika nahraje spravce"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (select public.je_spravce()));

drop policy if exists "avatars: fotku pracovnika prepise spravce" on storage.objects;
create policy "avatars: fotku pracovnika prepise spravce"
  on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (select public.je_spravce()))
  with check (bucket_id = 'avatars' and (select public.je_spravce()));

-- ── 3. Zápis adresy fotky do profilu ─────────────────────────────────
-- Nahrát soubor nestačí — appka pak zapisuje profiles.avatar_url. Pokud
-- profily pustí měnit cizí řádek jen správci, je hotovo; pokud ne, řekne
-- to appka hláškou „profil se nezměnil" místo falešného „uloženo".
--
-- Tahle migrace na profiles ZÁMĚRNĚ NESAHÁ. Práva k profilům jsou jádro
-- celé docházky a měnit je kvůli fotce by bylo riziko úplně jinde, než
-- kde je užitek.

commit;

-- ── Co se má vypsat ──────────────────────────────────────────────────
-- Pošlete mi ten výpis. Musí být DVA řádky a ve sloupci „podminka" musí
-- být vidět „je_spravce". Nula řádků znamená, že se pravidla nezaložila.
select policyname as pravidlo,
       cmd        as tyka_se,
       coalesce(qual, with_check) as podminka
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and policyname like 'avatars: fotku pracovnika%'
 order by policyname;
