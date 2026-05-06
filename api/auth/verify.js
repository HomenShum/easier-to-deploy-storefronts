// /api/auth/verify?token=lnk_<hex>  — exchanges a magic-link token for a session.
//
// Mom clicks the link in her email → Resend renders this URL → we forward to
// Convex which marks the link consumed and mints a `ses_<hex>` session token →
// 302 redirect to /inbox?key=ses_<hex>.
//
// /inbox.html already has a magic-link bootstrap that grabs `?key=` from the
// URL, stores it in localStorage["pawpaw_inbox_key"], and scrubs the URL. So
// no client-side changes are needed for the session to land in the right place.
//
// On any failure (expired, used, unknown) we render a tiny HTML page with a
// link back to the login screen rather than a JSON 4xx — the user is a person
// in their email client, not a script. Don't make mom debug a 401.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://<your-app>.vercel.app').trim();
const ADMIN_KEY = (process.env.ADMIN_API_KEY || '').trim();

function errorPage(reason) {
  // Bilingual minimal page. Mom's flow lands here when something's wrong (link
  // expired, already used, mistyped). Give her a way back without exposing the
  // raw reason — "expired" is friendly, "wrong_prefix" is not.
  const friendly = {
    not_found: { zh: '链接无效', en: 'Invalid link' },
    expired: { zh: '链接已过期，请重新申请', en: 'This link has expired — request a new one' },
    already_used: { zh: '链接已使用过一次', en: 'This link was already used' },
    mint_failed: { zh: '系统暂时不可用', en: 'Service temporarily unavailable' },
  }[reason] || { zh: '无法登录', en: 'Cannot sign in' };
  return `<!doctype html>
<meta charset="utf-8">
<title>登录失败 / Sign-in failed</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 24px; color: #333; }
  h1 { color: #1e3a2e; font-size: 22px; margin: 0 0 8px; }
  .sub { color: #666; margin: 0 0 24px; }
  a { display: inline-block; padding: 12px 24px; background: #1e3a2e; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
</style>
<h1>${friendly.zh}</h1>
<p class="sub">${friendly.en}</p>
<a href="${PUBLIC_BASE_URL}/inbox">← 返回登录 / Back to sign in</a>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer'); // don't leak the token to third parties

  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const token = (searchParams.get('token') || '').trim();
  if (!token || !token.startsWith('lnk_')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(errorPage('not_found'));
  }
  if (!ADMIN_KEY) {
    console.error('[auth/verify] missing ADMIN_API_KEY env');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(503).send(errorPage('mint_failed'));
  }

  // Exchange link → session via Convex.
  let result;
  try {
    const r = await fetch(`${CONVEX_SITE_URL}/admin-auth/consume-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': ADMIN_KEY },
      body: JSON.stringify({ token }),
    });
    result = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[auth/verify] convex consume-link http', r.status, result);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(502).send(errorPage('mint_failed'));
    }
  } catch (err) {
    console.error('[auth/verify] convex error', err.message);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(502).send(errorPage('mint_failed'));
  }

  if (!result.ok) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(401).send(errorPage(result.reason || 'not_found'));
  }

  // 302 → /inbox?key=ses_... — the page's magic-link bootstrap takes it from
  // here. Cache-Control already no-store, Referrer-Policy already no-referrer
  // so the session token doesn't leak in any subsequent third-party calls.
  const sessionToken = result.sessionToken;
  const dest = `${PUBLIC_BASE_URL}/inbox?key=${encodeURIComponent(sessionToken)}`;
  res.setHeader('Location', dest);
  return res.status(302).end();
}
