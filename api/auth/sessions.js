// /api/auth/sessions — list + revoke admin sessions.
//
//   GET                                     → list sessions for the caller's email
//   POST { revoke: "current" }              → revoke the caller's own session
//   POST { revoke: "all" }                  → revoke every session for the caller's email
//   POST { revoke: "token", token: "ses_…" } → revoke a specific other session
//                                              (must belong to caller's email)
//
// Auth: x-api-key may be EITHER the raw ADMIN_API_KEY (dev/superuser) or a
// caller-bound ses_<hex> session token. For session callers, all operations
// are scoped to that caller's email — they can never affect other admins.
// For raw-key callers, body.email selects the scope (defaults to first allowlist
// entry — usually mom). Raw-key path is the break-glass interface.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const ADMIN_KEY = (process.env.ADMIN_API_KEY || '').trim();

function defaultEmail() {
  // Picks the first email from the allowlist as the implicit scope for root
  // (raw-key) callers. Returns '' if the allowlist is empty — root callers must
  // then pass body.email explicitly. Fail-closed default.
  const allowlist = String(process.env.ADMIN_EMAIL_ALLOWLIST || '').trim();
  const first = allowlist.split(',')[0]?.trim().toLowerCase() || '';
  return first;
}

const ALLOWED_ORIGINS = [
  'https://<your-app>.vercel.app',
  'http://localhost:3001',
  'http://localhost:3000',
];
function setCors(req, res) {
  const origin = String(req.headers.origin || '');
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Cache-Control', 'no-store');
}

// authenticate — returns { ok, kind, email, token }. kind="root" for the raw
// admin key (dev/server scripts), kind="session" for a ses_<hex> caller. The
// email field tells revoke endpoints which scope the caller is allowed to touch.
async function authenticate(req) {
  const sent = String(req.headers['x-api-key'] || '').trim();
  if (!sent) return { ok: false };
  if (ADMIN_KEY && sent === ADMIN_KEY) {
    return { ok: true, kind: 'root', email: null, token: null };
  }
  if (!sent.startsWith('ses_')) return { ok: false };
  try {
    const r = await fetch(`${CONVEX_SITE_URL}/admin-auth/validate-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ token: sent }),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(() => ({}));
    if (!j.ok || !j.email) return { ok: false };
    return { ok: true, kind: 'session', email: j.email, token: sent };
  } catch (_) {
    return { ok: false };
  }
}

async function convexCall(path, body) {
  const r = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`convex_${r.status}: ${JSON.stringify(j).slice(0, 150)}`);
  return j;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'admin_key_not_configured' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  // For root callers, prefer body.email; fall back to the first allowlist entry.
  // For session callers, pin to the caller's bound email — they cannot escape it.
  const scopeEmail =
    auth.kind === 'session' ? auth.email : (req.body?.email || defaultEmail());

  if (req.method === 'GET') {
    try {
      const r = await convexCall('/admin-auth/list-sessions', { email: scopeEmail });
      return res.status(200).json({
        ok: true,
        email: scopeEmail,
        currentToken: auth.kind === 'session' ? auth.token : null,
        sessions: r.sessions || [],
      });
    } catch (err) {
      console.error('[auth/sessions GET]', err.message);
      return res.status(502).json({ ok: false, error: 'list_failed' });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const body = req.body || {};
  const op = String(body.revoke || '').toLowerCase();

  // op=current — revoke the caller's own session. Only meaningful for ses_ callers.
  if (op === 'current') {
    if (auth.kind !== 'session') {
      return res.status(400).json({ ok: false, error: 'no_current_session' });
    }
    try {
      await convexCall('/admin-auth/revoke-session', { token: auth.token });
      return res.status(200).json({ ok: true, revoked: 'current' });
    } catch (err) {
      console.error('[auth/sessions revoke-current]', err.message);
      return res.status(502).json({ ok: false, error: 'revoke_failed' });
    }
  }

  // op=all — revoke every active session for the caller's email scope.
  if (op === 'all') {
    try {
      const r = await convexCall('/admin-auth/revoke-all', { email: scopeEmail });
      return res.status(200).json({
        ok: true,
        revoked: 'all',
        email: scopeEmail,
        deletedSessions: r.deletedSessions || 0,
        deletedLinks: r.deletedLinks || 0,
      });
    } catch (err) {
      console.error('[auth/sessions revoke-all]', err.message);
      return res.status(502).json({ ok: false, error: 'revoke_failed' });
    }
  }

  // op=session — revoke ONE specific session by its Convex _id (returned from
  // GET /api/auth/sessions). Convex enforces the email-scope match server-side
  // so a session caller can never delete another admin's session, even if they
  // guess the _id. (Root callers pass scope=email or default to mom.)
  if (op === 'session') {
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'missing_sessionId' });
    }
    try {
      const r = await convexCall('/admin-auth/revoke-session-by-id', {
        sessionId,
        scopeEmail,
      });
      if (!r.ok) {
        // out_of_scope or not_found bubble up as 403/404
        const status = r.reason === 'out_of_scope' ? 403 : 404;
        return res.status(status).json({ ok: false, error: r.reason || 'revoke_failed' });
      }
      return res.status(200).json({ ok: true, revoked: 'session', sessionId });
    } catch (err) {
      console.error('[auth/sessions revoke-session]', err.message);
      return res.status(502).json({ ok: false, error: 'revoke_failed' });
    }
  }

  return res.status(400).json({ ok: false, error: 'unknown_op', expected: ['current', 'all', 'session'] });
}
