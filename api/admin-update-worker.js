// Umožní adminovi appky přímo změnit přihlašovací e-mail nebo heslo pracovníka
// (v appce sekce "Přístupy" → "✏️ Změnit e-mail / heslo").
//
// Tohle NEJDE udělat jen z prohlížeče — Supabase to z bezpečnostních důvodů
// dovolí pouze s tzv. service_role klíčem, který se nikdy nesmí objevit
// v klientském kódu (kdokoliv by si ho mohl vzít z appky a ovládnout tak
// libovolný účet). Proto tahle funkce běží na serveru (Vercel) a klíč čte
// z proměnné prostředí SUPABASE_SERVICE_ROLE_KEY, kterou je potřeba nastavit
// ve Vercel → Project Settings → Environment Variables (hodnotu najdete
// v Supabase → Project Settings → API → service_role key). Bez nastavené
// proměnné funkce vrátí jasnou chybu a appka na to admina upozorní.
//
// Než cokoliv provede, ověří přes Authorization hlavičku (Bearer token
// přihlášeného uživatele), že volající je opravdu admin — jinak požadavek
// odmítne. Token samotné heslo/e-mail neprozrazuje, jen identitu volajícího.

const SUPABASE_URL = 'https://ceefzlkjnrclfpmhgdmr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlZWZ6bGtqbnJjbGZwbWhnZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTkxODYsImV4cCI6MjA5MjI5NTE4Nn0.fIewYds5zd3AICHWSpbcfOKk_SfGHuP1I-YR1yKW4NI';

// Brzda proti hrubému útoku / omylem opakovanému bušení do endpointu.
// Paměť žije jen po dobu běhu instance funkce, ale i tak dá rozumnou ochranu.
const HITS = new Map();
function rateLimited(key, max, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const fresh = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    HITS.set(key, fresh);
    return true;
  }
  fresh.push(now);
  HITS.set(key, fresh);
  if (HITS.size > 5000) HITS.clear();
  return false;
}

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());

const applyCors = (req, res) => {
  // Požadavek by měl vždy přijít ze stejné domény, na které appka běží.
  const origin = String(req.headers.origin ?? '');
  const host = String(req.headers.host ?? '');
  try {
    if (origin && new URL(origin).host === host) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  } catch {
    // neplatná Origin hlavička — prostě nic nepovolíme
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// CommonJS (module.exports), ne "export default" — repozitář nemá package.json
// s "type":"module", takže by ESM syntaxe Vercelu na Node runtime spadla.
module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ ok: false, error: 'server_not_configured' });
    return;
  }

  if (rateLimited(`admin-update-worker:${clientIp(req)}`, 20)) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  // 1) Kdo volá? — ověř přístupový token proti Supabase Auth
  const authHeader = String(req.headers.authorization ?? '');
  const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!callerToken) {
    res.status(401).json({ ok: false, error: 'missing_token' });
    return;
  }

  let callerId;
  try {
    const callerResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${callerToken}` },
    });
    if (!callerResp.ok) {
      res.status(401).json({ ok: false, error: 'invalid_session' });
      return;
    }
    const caller = await callerResp.json();
    callerId = caller?.id;
  } catch {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return;
  }
  if (!callerId) {
    res.status(401).json({ ok: false, error: 'invalid_session' });
    return;
  }

  // 2) Je volající admin? — dotaz přes service_role (obchází RLS, ale jen pro čtení role)
  try {
    const roleResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=role`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const roleRows = roleResp.ok ? await roleResp.json() : [];
    if (!roleRows.length || roleRows[0].role !== 'admin') {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
  } catch {
    res.status(502).json({ ok: false, error: 'role_check_failed' });
    return;
  }

  // 3) Validace vstupu
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const userId = String(body.userId ?? '').trim();
  const newEmail = String(body.newEmail ?? '').trim();
  const newPassword = String(body.newPassword ?? '').trim();

  if (!userId) {
    res.status(400).json({ ok: false, error: 'missing_user_id' });
    return;
  }
  if (!newEmail && !newPassword) {
    res.status(400).json({ ok: false, error: 'nothing_to_change' });
    return;
  }
  if (newEmail && !isEmail(newEmail)) {
    res.status(400).json({ ok: false, error: 'invalid_email' });
    return;
  }
  if (newPassword && newPassword.length < 6) {
    res.status(400).json({ ok: false, error: 'password_too_short' });
    return;
  }

  // 4) Vlastní změna přes Supabase Admin API (jediné místo, kde je service_role potřeba)
  const payload = {};
  if (newEmail) {
    payload.email = newEmail;
    payload.email_confirm = true; // admin akce = rovnou potvrzeno, žádný ověřovací e-mail
  }
  if (newPassword) payload.password = newPassword;

  try {
    const updateResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    if (!updateResp.ok) {
      const detail = await updateResp.text().catch(() => '');
      res.status(502).json({ ok: false, error: 'auth_update_failed', detail: detail.slice(0, 300) });
      return;
    }
  } catch {
    res.status(502).json({ ok: false, error: 'auth_update_failed' });
    return;
  }

  // 5) Ať e-mail v profiles (viditelný v appce) odpovídá tomu přihlašovacímu
  if (newEmail) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ email: newEmail }),
      });
    } catch {
      // Přihlášení novým e-mailem už funguje (bod 4 proběhl) — jen se nesynchronizovala
      // zobrazovaná hodnota v tabulce profiles. Není to blokující chyba.
    }
  }

  res.status(200).json({ ok: true });
};
