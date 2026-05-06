// /api/bookings — thin proxy to Convex HTTP actions for bookings.
// Auth: x-api-key header (same admin key used by /api/inbox).
//
// GET  /api/bookings?status=&rangeStartMs=&rangeEndMs=&limit=  → list
// POST /api/bookings                    body: create-booking args → create
// POST /api/bookings?action=update      body: update-booking args → patch
// POST /api/bookings?action=cancel      body: { bookingId }      → status=cancelled
// POST /api/bookings?action=promote     body: { inquiryId, startMs, endMs, ... } → create from inquiry

const CONVEX_SITE_URL =
  (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();

async function convexCall(path, method = 'GET', body = null) {
  const url = `${CONVEX_SITE_URL}${path}`;
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`convex_${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

function requireAuth(req) {
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey) return false; // fail closed if env not configured
  const sent = String(req.headers['x-api-key'] || '').trim();
  return sent.length > 0 && sent === validKey;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const action = searchParams.get('action') || req.body?.action;

  // PUBLIC view — thank-you page. NO auth required. The booking ID IS the credential
  // (like a Google Docs share link). Convex-side public query strips sensitive fields.
  if (req.method === 'GET' && searchParams.get('view') === 'public') {
    const id = (searchParams.get('id') || '').trim();
    if (!id || !/^[a-zA-Z0-9]{20,40}$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'invalid_id' });
    }
    try {
      const result = await convexCall(`/bookings/public?id=${encodeURIComponent(id)}`, 'GET');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      return res.status(200).json(result);
    } catch (err) {
      console.error('[bookings public view]', err.message);
      return res.status(502).json({ ok: false, error: 'upstream' });
    }
  }

  if (!requireAuth(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      // Sub-resource: pending review requests (bookings ended ~24hrs ago that
      // still need mom's attention for a Google review ask).
      if (searchParams.get('view') === 'pending-reviews') {
        const result = await convexCall(`/bookings/pending-reviews`, 'GET');
        return res.status(200).json(result);
      }
      const qs = new URLSearchParams();
      for (const k of ['status', 'rangeStartMs', 'rangeEndMs', 'limit']) {
        const v = searchParams.get(k);
        if (v != null) qs.set(k, v);
      }
      const result = await convexCall(`/bookings/fetch?${qs.toString()}`, 'GET');
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      if (action === 'update') {
        if (!body.bookingId) return res.status(400).json({ ok: false, error: 'missing_bookingId' });
        const result = await convexCall('/bookings/update', 'POST', body);
        return res.status(200).json(result);
      }

      if (action === 'cancel') {
        if (!body.bookingId) return res.status(400).json({ ok: false, error: 'missing_bookingId' });
        const result = await convexCall('/bookings/update', 'POST', { bookingId: body.bookingId, status: 'cancelled' });
        return res.status(200).json(result);
      }

      if (action === 'mark-review-requested') {
        if (!body.bookingId || !body.channel) return res.status(400).json({ ok: false, error: 'missing_fields' });
        const result = await convexCall('/bookings/mark-review-requested', 'POST', { bookingId: body.bookingId, channel: body.channel });
        return res.status(200).json(result);
      }

      // Default (action === 'create' or 'promote'): createBooking accepts inquiryId or raw fields.
      if (!Number.isFinite(body.startMs) || !Number.isFinite(body.endMs)) {
        return res.status(400).json({ ok: false, error: 'missing_dates' });
      }
      const result = await convexCall('/bookings/create', 'POST', body);
      return res.status(200).json(result);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[api/bookings] error:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
}
