// /api/site-content — CMS read/write proxy.
//
// GET  ?lang=en|zh|es                       → public, no auth, edge-cached 60s
// POST body {lang, data, updatedBy?}        → admin: full content blob upsert
// POST ?action=gallery-upload-url           → admin: returns Convex upload URL (browser PUTs file directly)
// POST ?action=gallery-add  body {storageId, caption?}  → admin: commits storageId into siteContent.gallery
// POST ?action=gallery-remove body {storageId}          → admin: removes from gallery + deletes blob
// POST ?action=verify-key                   → admin probe: 200 if key valid, 401 otherwise. No-cache.
//                                            Landing pages call this before showing the edit FAB so
//                                            stale/leaked localStorage keys don't expose the editor.
//
// Public landing pages hit GET on every page-load to hydrate from Convex.
// Mom's admin in /inbox.html hits POST on Save and gallery actions.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const VALID_LANGS = ['en', 'zh', 'es'];

// Tightened CORS: explicit allowlist instead of `*`. Mom's site, local dev, and
// previews. Anything else gets the canonical prod origin (effectively a deny —
// browsers reject the response when Origin doesn't match).
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
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '64kb' }, // content blob cap; gallery uploads bypass via direct-to-Convex URL
  },
};

// requireAuth — accepts EITHER the legacy raw ADMIN_API_KEY or a session token
// minted by the email magic-link flow (`ses_<hex>`). The session-token branch
// makes a Convex round-trip; we early-reject anything that doesn't carry the
// `ses_` prefix so the legacy fast path stays sync-fast and 99% of admin
// requests never pay the round-trip cost.
async function requireAuth(req) {
  const sent = String(req.headers['x-api-key'] || '').trim();
  if (!sent) return false;
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  // Legacy raw-key path — used by /inbox.html FAB before mom switches over,
  // and by server-side scripts (bulk-upload-photos.py, cron jobs).
  if (validKey && sent === validKey) return true;
  // Session-token path — issued by /api/auth/verify after Resend link click.
  if (sent.startsWith('ses_')) {
    try {
      const r = await fetch(`${CONVEX_SITE_URL}/admin-auth/validate-session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': validKey },
        body: JSON.stringify({ token: sent }),
      });
      if (!r.ok) return false;
      const j = await r.json().catch(() => ({}));
      return Boolean(j?.ok);
    } catch (_) {
      // Convex outage → fail closed. Better to lock mom out for a minute than
      // to fail open on a transient network blip.
      return false;
    }
  }
  return false;
}

async function convexCall(path, method = 'GET', body = null, extraHeaders = {}) {
  const res = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`convex_${res.status}: ${text.slice(0, 150)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const action = (searchParams.get('action') || '').toLowerCase();

  // ============== ADMIN KEY PROBE (cheap 200/401 — no Convex call) ==============
  // Landing pages ping this on load when localStorage has a key. Bad/stale keys
  // get cleared client-side and the FAB stays hidden. This is the gate that
  // prevents leaked magic-links from exposing the editor on shared devices.
  if (req.method === 'POST' && action === 'verify-key') {
    res.setHeader('Cache-Control', 'no-store');
    if (await requireAuth(req)) {
      return res.status(200).json({ ok: true });
    }
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // ============== GALLERY (admin POST actions, forwarded to Convex) ==============
  if (req.method === 'POST' && action.startsWith('gallery-')) {
    if (!(await requireAuth(req))) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    const adminKey = String(process.env.ADMIN_API_KEY || '').trim();
    const auth = { 'x-api-key': adminKey };

    try {
      if (action === 'gallery-upload-url') {
        // No body required. Convex returns a short-lived upload URL.
        const result = await convexCall('/gallery/upload-url', 'POST', {}, auth);
        return res.status(200).json(result);
      }
      if (action === 'gallery-add') {
        const body = req.body || {};
        if (!body.storageId) {
          return res.status(400).json({ ok: false, error: 'missing_storageId' });
        }
        const caption = String(body.caption || '').slice(0, 280);
        const result = await convexCall('/gallery/add', 'POST', { storageId: body.storageId, caption }, auth);
        return res.status(200).json(result);
      }
      if (action === 'gallery-remove') {
        const body = req.body || {};
        if (!body.storageId) {
          return res.status(400).json({ ok: false, error: 'missing_storageId' });
        }
        const result = await convexCall('/gallery/remove', 'POST', { storageId: body.storageId }, auth);
        return res.status(200).json(result);
      }
      return res.status(400).json({ ok: false, error: 'unknown_action', action });
    } catch (err) {
      console.error('[site-content gallery]', action, err.message);
      return res.status(502).json({ ok: false, error: err.message });
    }
  }

  // ============== PUBLIC GET ==============
  if (req.method === 'GET') {
    const lang = (searchParams.get('lang') || 'en').toLowerCase();
    if (!VALID_LANGS.includes(lang)) {
      return res.status(400).json({ ok: false, error: 'invalid_lang' });
    }
    try {
      const result = await convexCall(`/site-content/get?lang=${lang}`, 'GET');
      // Edge cache 60s — mom's edit appears within ~1 minute, fast for visitors.
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      return res.status(200).json({ ok: true, lang, data: result?.data || null, updatedAt: result?.updatedAt || null });
    } catch (err) {
      console.error('[site-content GET]', err.message);
      return res.status(200).json({ ok: false, lang, data: null, error: err.message });
    }
  }

  // ============== ADMIN POST (full upsert) ==============
  if (req.method === 'POST') {
    if (!(await requireAuth(req))) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    // Explicit body-size guard — Vercel's `config.api.bodyParser.sizeLimit` is
    // not always honored on the current runtime, so check Content-Length and
    // a serialized-size fallback.
    const MAX_BODY_BYTES = 64 * 1024; // 64 KB
    const cl = parseInt(req.headers['content-length'] || '0', 10);
    if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
      return res.status(413).json({ ok: false, error: 'payload_too_large', limit_bytes: MAX_BODY_BYTES });
    }
    const body = req.body || {};
    try {
      const serialized = JSON.stringify(body);
      if (serialized.length > MAX_BODY_BYTES) {
        return res.status(413).json({ ok: false, error: 'payload_too_large', limit_bytes: MAX_BODY_BYTES });
      }
    } catch (_) {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
    const lang = String(body.lang || '').toLowerCase();
    if (!VALID_LANGS.includes(lang)) {
      return res.status(400).json({ ok: false, error: 'invalid_lang' });
    }
    if (!body.data || typeof body.data !== 'object') {
      return res.status(400).json({ ok: false, error: 'invalid_data' });
    }
    try {
      const result = await convexCall('/site-content/upsert', 'POST', {
        lang,
        data: body.data,
        updatedBy: body.updatedBy || 'admin',
      });
      return res.status(200).json(result);
    } catch (err) {
      console.error('[site-content POST]', err.message);
      return res.status(502).json({ ok: false, error: err.message });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}
