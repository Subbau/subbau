// =====================================================================
// UKÁZKOVÁ VERZE — náhrada za připojení k Supabase
//
// Vyrobí objekt `sb`, který se navenek chová jako skutečný klient
// Supabase: má .from(), .auth, .storage i .channel. Uvnitř ale sahá
// jen do paměti prohlížeče (databaze-v-pameti.js).
//
// Žádný dotaz neopouští prohlížeč. V tomhle souboru ani v ukázkové
// stránce není klíč k databázi SubBau — není odkud vzít.
// =====================================================================

(function () {
  'use strict';
  const DATA = window.__demoDATA;
  const dotaz = window.__demoDotaz;
  const uuid = window.__demoUuid;

  // ------------------------------------------------------------------
  // Přihlášení. Ukázka se otevře rovnou přihlášená — návštěvník žádné
  // heslo nedostane a ani ho nepotřebuje. Přepínač rolí je v rohu.
  // ------------------------------------------------------------------
  let ucet = null;
  const posluchaci = [];

  function prihlas(profilId) {
    const p = (DATA.profiles || []).find(x => x.id === profilId);
    if (!p) return null;
    ucet = { id: p.id, email: p.email, user_metadata: { full_name: p.full_name } };
    try { localStorage.setItem('demo-ucet', p.id) } catch (e) {}
    posluchaci.forEach(f => { try { f('SIGNED_IN', { user: ucet }) } catch (e) {} });
    return ucet;
  }

  const auth = {
    getSession: async () => ({ data: { session: ucet ? { user: ucet, access_token: 'demo' } : null }, error: null }),
    getUser: async () => ({ data: { user: ucet }, error: null }),
    refreshSession: async () => ({ data: { session: ucet ? { user: ucet } : null }, error: null }),
    setSession: async () => ({ data: { session: ucet ? { user: ucet } : null }, error: null }),
    onAuthStateChange: (f) => {
      posluchaci.push(f);
      // Skutečná knihovna hned po přihlášení k odběru ohlásí, jak to teď stojí
      // (událost INITIAL_SESSION). Appka na to čeká — teprve tou událostí se
      // spustí její start. Bez tohohle řádku appka čekala marně a po padesáti
      // vteřinách ukázala přihlašovací obrazovku, ke které v ukázce nikdo nemá
      // heslo. Odkládáme o tik, ať se stihne vrátit odběr volajícímu.
      setTimeout(() => {
        try { f(ucet ? 'SIGNED_IN' : 'INITIAL_SESSION', ucet ? { user: ucet, access_token: 'demo' } : null) }
        catch (e) { console.error('[ukázka] ohlášení přihlášení selhalo:', e) }
      }, 0);
      return { data: { subscription: { unsubscribe() { const i = posluchaci.indexOf(f); if (i >= 0) posluchaci.splice(i, 1) } } } };
    },
    signInWithPassword: async ({ email }) => {
      const p = (DATA.profiles || []).find(x => String(x.email || '').toLowerCase() === String(email || '').toLowerCase());
      if (!p) return { data: null, error: { message: 'V ukázce se přihlašovat nemusíte — použijte přepínač vpravo nahoře.' } };
      return { data: { user: prihlas(p.id) }, error: null };
    },
    signUp: async ({ email, options }) => {
      const id = uuid();
      (DATA.profiles = DATA.profiles || []).push({
        id, email, full_name: (options && options.data && options.data.full_name) || 'Nový pracovník',
        role: 'osvec', is_active: false, registration_status: 'pending',
        created_at: new Date().toISOString(), ...(options && options.data || {}),
      });
      return { data: { user: { id, email } }, error: null };
    },
    signOut: async () => {
      ucet = null;
      try { localStorage.removeItem('demo-ucet') } catch (e) {}
      posluchaci.forEach(f => { try { f('SIGNED_OUT', null) } catch (e) {} });
      return { error: null };
    },
    updateUser: async () => ({ data: { user: ucet }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
  };

  // ------------------------------------------------------------------
  // Úložiště souborů. Nahraný soubor se nikam neposílá — zůstane
  // v paměti okna jako blob: adresa. Zavřením okna zmizí.
  // ------------------------------------------------------------------
  const soubory = {};
  function kos(nazev) {
    return {
      async upload(cesta, soubor) {
        try {
          soubory[nazev + '/' + cesta] = (soubor instanceof Blob) ? URL.createObjectURL(soubor) : String(soubor);
        } catch (e) { soubory[nazev + '/' + cesta] = ''; }
        return { data: { path: cesta }, error: null };
      },
      getPublicUrl(cesta) {
        const u = soubory[nazev + '/' + cesta];
        // Bez nahraného souboru vrátíme prázdný obrázek, ať se nikde
        // neukáže rozbitá ikona a nešel na síť požadavek na cizí doménu.
        return { data: { publicUrl: u || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' } };
      },
      async remove(cesty) {
        (Array.isArray(cesty) ? cesty : [cesty]).forEach(c => { delete soubory[nazev + '/' + c] });
        return { data: [], error: null };
      },
      async list(prefix) {
        const p = nazev + '/' + (prefix || '');
        return { data: Object.keys(soubory).filter(k => k.startsWith(p)).map(k => ({ name: k.slice(p.length) })), error: null };
      },
      async download() { return { data: null, error: { message: 'V ukázce se soubory nestahují' } } },
      async createSignedUrl(cesta) { return { data: { signedUrl: kos(nazev).getPublicUrl(cesta).data.publicUrl }, error: null } },
    };
  }

  // ------------------------------------------------------------------
  // Živé aktualizace. V ukázce je nikdo jiný nevyvolá — jediný, kdo
  // data mění, je návštěvník sám. Kanál proto jen tiše přikývne.
  // ------------------------------------------------------------------
  function kanal() {
    const k = { on() { return k }, subscribe(f) { try { f && f('SUBSCRIBED') } catch (e) {} return k }, unsubscribe() { return k } };
    return k;
  }

  window.sb = {
    from: (t) => dotaz(t),
    rpc: async () => ({ data: null, error: null }),
    auth,
    storage: { from: kos },
    channel: kanal,
    removeChannel: () => {},
    removeAllChannels: () => {},
    getChannels: () => [],
  };
  window.__demoPrihlas = prihlas;
})();
