// /api/admin/notify — Admin-only Resend wrapper for sending arbitrary
// notifications to mom (or owner). Reusable for one-off "tell mom X" needs.
//
// Auth: x-api-key (ADMIN_API_KEY or ses_<hex>) — same gate as all other admin endpoints.
// Body: { to?: 'mom' | 'owner', subject, text, html? }
//   - `to`: 'mom' (default) → reads MOM_EMAIL env (the owner)
//           'owner'         → reads OWNER_EMAIL env (the developer/operator)
//   Both env vars are REQUIRED — empty values return 503 (no silent fallback).
//
// Why this exists: api.resend.com is fronted by Cloudflare, which blocks the
// agent sandbox IP/UA with error 1010. Calling from a Vercel function bypasses
// that. This endpoint also lets future tooling send mom-notifications without
// hand-rolling the Resend payload each time.

export const config = {
  api: {
    bodyParser: { sizeLimit: '32kb' },
  },
};

// requireAuth — same dual-mode gate as api/site-content.js. Accepts the legacy
// raw ADMIN_API_KEY (used by server-side scripts and dev) OR a magic-link
// session token (`ses_<hex>`) issued by /api/auth/verify after Resend confirms
// mom's email. Async because the session path round-trips Convex.
const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
async function requireAuth(req) {
  const sent = String(req.headers['x-api-key'] || '').trim();
  if (!sent) return false;
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (validKey && sent === validKey) return true;
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
      return false; // fail closed on Convex outage
    }
  }
  return false;
}

// Tightened CORS — explicit allowlist instead of `*`.
const ALLOWED_ORIGINS = [
  'https://<your-app>.vercel.app',
  'http://localhost:3001',
  'http://localhost:3000',
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const origin = String(req.headers.origin || '');
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!(await requireAuth(req))) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = req.body || {};
  const subject = String(body.subject || '').slice(0, 200);
  const text = String(body.text || '');
  const html = body.html ? String(body.html) : null;
  const target = (body.to || 'mom').toLowerCase();

  if (!subject || !text) {
    return res.status(400).json({ ok: false, error: 'missing_subject_or_text' });
  }
  if (text.length > 30000 || (html && html.length > 60000)) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!resendKey) {
    return res.status(503).json({ ok: false, error: 'resend_not_configured' });
  }

  // Recipients come ONLY from env. Empty env → 503 (don't email a placeholder).
  // Configure MOM_EMAIL (owner) and OWNER_EMAIL (developer/operator) in Vercel.
  let to;
  if (target === 'mom') {
    to = String(process.env.MOM_EMAIL || '').trim();
  } else if (target === 'owner') {
    to = String(process.env.OWNER_EMAIL || '').trim();
  } else {
    return res.status(400).json({ ok: false, error: 'invalid_recipient' });
  }
  if (!to) {
    return res.status(503).json({ ok: false, error: 'recipient_not_configured', target });
  }

  const from = String(process.env.EMAIL_FROM || 'onboarding@resend.dev').trim();

  const payload = { from, to, subject, text };
  if (html) payload.html = html;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    const respText = await r.text();
    let resp;
    try { resp = JSON.parse(respText); } catch { resp = { raw: respText.slice(0, 500) }; }

    if (!r.ok) {
      console.warn(JSON.stringify({ ev: 'notify_resend_err', status: r.status, to, target }));
      return res.status(502).json({ ok: false, error: 'resend_error', upstream_status: r.status, upstream: resp });
    }

    console.log(JSON.stringify({ ev: 'notify_sent', to, target, id: resp?.id || null }));
    return res.status(200).json({ ok: true, to: target, id: resp?.id || null });
  } catch (err) {
    console.error(JSON.stringify({ ev: 'notify_err', msg: String(err).slice(0, 200) }));
    return res.status(502).json({ ok: false, error: 'send_failed', detail: String(err).slice(0, 200) });
  }
}
