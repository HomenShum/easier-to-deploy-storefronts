// /api/cron/review-requests — daily Vercel Cron that:
//   1. Fetches bookings whose stay ended ~24hrs ago and hasn't been asked for a review yet
//   2. For email contacts: sends a friendly review-request email via Resend
//   3. For phone contacts: leaves in Convex as status="sms_queued" so the inbox UI
//      surfaces them — mom taps "📱 问评价" which opens her native Messages app
//
// Auth: Vercel Cron requests include a special header; we also accept the admin key
// for manual triggering / local test.
//
// Cron schedule configured in vercel.json.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const GOOGLE_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || 'https://<your-app>.vercel.app/';
const EMAIL_FROM = process.env.EMAIL_FROM || 'Paw Paw Pet Care <onboarding@resend.dev>';

function isAuthorized(req) {
  // Vercel injects this header on cron-triggered requests (prod only; on dev we
  // can bypass by passing the admin key).
  if (req.headers['x-vercel-cron']) return true;
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey) return false; // fail closed if env not configured
  const sent = String(req.headers['x-api-key'] || '').trim();
  return sent.length > 0 && sent === validKey;
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function convexCall(path, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${CONVEX_SITE_URL}${path}`, options);
  if (!res.ok) throw new Error(`convex_${res.status}`);
  return await res.json();
}

async function sendReviewEmail({ customerName, dogName, email }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('no_resend_key');

  const dogPhrase = dogName ? dogName.split(/[,，]/)[0] : 'your pup';
  const subject = `Thanks for trusting us with ${dogPhrase}! 🐾`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:540px;margin:0 auto;padding:20px;color:#1e3a2e">
  <h2 style="font-size:18px;margin:0 0 10px">Hi ${customerName.split(/\s+/)[0]} 👋</h2>
  <p style="font-size:14px;line-height:1.6;margin:0 0 12px">
    Thank you so much for trusting me with <strong>${dogPhrase}</strong>. It was a pleasure to have them stay with us.
  </p>
  <p style="font-size:14px;line-height:1.6;margin:0 0 16px">
    If you had a good experience, would you mind leaving a quick review on Google? Even one sentence means the world to a small business like ours — it helps other families find us.
  </p>
  <p style="margin:20px 0">
    <a href="${GOOGLE_REVIEW_URL}" style="background:#1e3a2e;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;display:inline-block">
      ⭐ Leave a Google review
    </a>
  </p>
  <p style="font-size:13px;color:#5a6b5f;margin:20px 0 0">
    No pressure at all — if you'd rather not, no worries. And please reach out anytime for future stays.
  </p>
  <p style="font-size:13px;color:#5a6b5f;margin:16px 0 0">
    Thanks again!<br />
    — Yan · Paw Paw Pet Care<br />
    📞 415-823-0199
  </p>
</div>`;
  const text = `Hi ${customerName.split(/\s+/)[0]},

Thank you so much for trusting me with ${dogPhrase}. It was a pleasure to have them stay with us.

If you had a good experience, would you mind leaving a quick review on Google? Even one sentence means the world to a small business like ours.

${GOOGLE_REVIEW_URL}

Thanks again!
— Yan · Paw Paw Pet Care
415-823-0199`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: email, subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend_${res.status}: ${detail.slice(0, 120)}`);
  }
  return true;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const trace = 'cron_' + Date.now().toString(36);
  try {
    const pending = await convexCall('/bookings/pending-reviews', 'GET');
    const rows = (pending && pending.pending) || [];
    const out = { checked: rows.length, emailed: 0, queued_sms: 0, failed: 0, window_days: pending?.windowDays };

    for (const b of rows) {
      const customerName = b.customerName || '';
      const dogName = b.dogName || '';
      const contact = b.customerContact || '';
      try {
        if (looksLikeEmail(contact)) {
          await sendReviewEmail({ customerName, dogName, email: contact });
          await convexCall('/bookings/mark-review-requested', 'POST', { bookingId: b._id, channel: 'email' });
          out.emailed += 1;
        } else {
          // Queue for mom to send via native Messages app from the inbox UI.
          await convexCall('/bookings/mark-review-requested', 'POST', { bookingId: b._id, channel: 'sms_queued' });
          out.queued_sms += 1;
        }
      } catch (err) {
        console.error(JSON.stringify({ trace, ev: 'review_fail', bookingId: b._id, err: String(err).slice(0, 200) }));
        out.failed += 1;
      }
    }

    console.log(JSON.stringify({ trace, ev: 'review_cron_done', ...out }));
    return res.status(200).json({ ok: true, trace, ...out });
  } catch (err) {
    console.error(JSON.stringify({ trace, ev: 'review_cron_fatal', err: String(err).slice(0, 200) }));
    return res.status(500).json({ ok: false, trace, error: err.message });
  }
}
