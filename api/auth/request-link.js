// /api/auth/request-link — body { email } → emails a magic login link via Resend.
//
// This is the *first* leg of the passwordless flow that replaced "raw admin key
// in URL". Mom enters her email on /inbox login screen → if it matches the
// allowlist, we ask Convex to mint a single-use lnk_ token, then ask Resend to
// deliver the link to her inbox. The link points at /api/auth/verify which
// exchanges lnk_ for a long-lived ses_ session.
//
// Privacy posture: ALWAYS return 200 {ok:true} regardless of whether the email
// is on the allowlist. We don't want this endpoint to leak which addresses
// belong to mom — a determined attacker would just know that mom@gmail is the
// admin from any guest book. But we also don't email someone who didn't ask, so
// we silently no-op for non-allowlisted addresses.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://<your-app>.vercel.app').trim();
const ADMIN_KEY = (process.env.ADMIN_API_KEY || '').trim();
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM = (process.env.EMAIL_FROM || 'Paw Paw Pet Care <onboarding@resend.dev>').trim();

// Allowlist: comma-separated emails (case-insensitive). REQUIRED — empty
// allowlist fails closed (no email is admin). Set ADMIN_EMAIL_ALLOWLIST in
// your Vercel project env to your owner email(s), e.g. "owner@example.com".
function parseAllowlist() {
  const raw = String(process.env.ADMIN_EMAIL_ALLOWLIST || '').trim();
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Same CORS allowlist style as /api/site-content — explicit origins, never `*`.
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (!ADMIN_KEY || !RESEND_KEY) {
    // Misconfig: don't 500 (would leak that the endpoint exists), but log loudly.
    console.error('[auth/request-link] missing ADMIN_API_KEY or RESEND_API_KEY env');
    return res.status(200).json({ ok: true, queued: false });
  }

  const body = req.body || {};
  const rawEmail = String(body.email || '').trim().toLowerCase();
  // Permissive shape check — we don't need RFC 5321 here, just rule out the obvious junk.
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail);
  if (!looksLikeEmail) {
    // Same uniform success response — don't reveal validation outcome.
    return res.status(200).json({ ok: true, queued: false });
  }

  const allowlist = parseAllowlist();
  if (!allowlist.includes(rawEmail)) {
    // Silent reject. Logging the email could be a tarpit if attackers spam — keep it short.
    console.warn(JSON.stringify({ ev: 'auth_link_denied', emailHash: rawEmail.slice(0, 3) + '***' }));
    return res.status(200).json({ ok: true, queued: false });
  }

  // 1. Mint the link token in Convex.
  let token;
  try {
    const r = await fetch(`${CONVEX_SITE_URL}/admin-auth/create-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ email: rawEmail }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.token) {
      console.error('[auth/request-link] convex create-link failed', r.status, j);
      return res.status(502).json({ ok: false, error: 'mint_failed' });
    }
    token = j.token;
  } catch (err) {
    console.error('[auth/request-link] convex error', err.message);
    return res.status(502).json({ ok: false, error: 'mint_failed' });
  }

  // 2. Build the magic link URL — points back here, the verify route consumes it.
  const linkUrl = `${PUBLIC_BASE_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;

  // 3. Email it via Resend (15s timeout, same pattern as /api/admin/notify).
  const subject = '🐾 Paw Paw 登录链接 / Login link';
  const text =
    `点击以下链接登录管理后台（15 分钟内有效，仅限一次）：\n\n${linkUrl}\n\n` +
    `Click the link to sign in (valid for 15 minutes, single use):\n\n${linkUrl}\n\n` +
    `如果不是你本人发起的，可以忽略此邮件。 / If you didn't request this, you can ignore this email.`;
  const html =
    `<p>点击下方按钮登录管理后台（15 分钟内有效，仅限一次）：</p>` +
    `<p style="margin:24px 0;"><a href="${linkUrl}" style="display:inline-block;padding:12px 24px;background:#1e3a2e;color:white;text-decoration:none;border-radius:8px;font-weight:600;">登录 / Sign in</a></p>` +
    `<p style="color:#666;font-size:13px;">链接：<br><code style="word-break:break-all;">${linkUrl}</code></p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">` +
    `<p style="color:#888;font-size:12px;">如果不是你本人发起的，可以忽略此邮件。<br>If you didn't request this, you can ignore this email.</p>`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: rawEmail, subject, text, html }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[auth/request-link] resend error', r.status, j);
      return res.status(502).json({ ok: false, error: 'email_failed' });
    }
    console.log(JSON.stringify({ ev: 'auth_link_sent', id: j?.id || null }));
    return res.status(200).json({ ok: true, queued: true });
  } catch (err) {
    console.error('[auth/request-link] resend exception', err.message);
    return res.status(502).json({ ok: false, error: 'email_failed' });
  }
}
