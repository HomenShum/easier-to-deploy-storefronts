// /api/ical-proxy — fetch a user-supplied ICS URL, parse VEVENTs, return 90-day window.
//
// Why a proxy: Google Calendar's private iCal URLs don't expose CORS headers, so
// the browser can't fetch them directly. Server-side fetch sidesteps this.
//
// SSRF protection — allowlist of known calendar providers:
//   - calendar.google.com          (Google)
//   - p{N}-caldav.icloud.com       (Apple iCloud)
//   - outlook.live.com / outlook.office365.com  (Microsoft 365)
//   - Any *.ics on a host not in the allowlist → rejected.
// Max response size 2MB. Timeout 8s. No redirect to non-allowlisted host.
//
// Auth: same x-api-key scheme as /api/bookings. The ICS URL itself is a secret
// token; we treat the request like any other admin read. The URL stays in the
// request body (not query string → not in access logs).

const ALLOWED_HOSTS = [
  /^calendar\.google\.com$/i,
  /^p\d+-caldav\.icloud\.com$/i,
  /^(www\.)?icloud\.com$/i,
  /^outlook\.(live|office365|office)\.com$/i,
];
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const WINDOW_DAYS = 90;

function requireAuth(req) {
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey) return false; // fail closed if env not configured
  const sent = String(req.headers['x-api-key'] || '').trim();
  return sent.length > 0 && sent === validKey;
}

function isHostAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((re) => re.test(u.host));
  } catch {
    return false;
  }
}

// Parse an ICS date/datetime value. Handles:
//   DTSTART;VALUE=DATE:20260601                → midnight UTC of that date
//   DTSTART:20260601T090000Z                   → explicit UTC
//   DTSTART;TZID=America/Los_Angeles:20260601T090000  → best-effort (no tzdb)
// For TZID, we treat as UTC (acceptable loss — mom's blocks are coarse day-granularity).
function parseIcsDate(raw) {
  if (!raw) return null;
  const value = raw.includes(':') ? raw.split(':').pop() : raw;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  if (!hh) return Date.UTC(+y, +mo - 1, +d);
  return Date.UTC(+y, +mo - 1, +d, +hh || 0, +mm || 0, +ss || 0);
}

// Minimal line unfold (RFC 5545 §3.1: continuation lines start with space/tab).
function unfoldLines(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function parseIcs(text) {
  const lines = unfoldLines(text).split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (line.startsWith('DTSTART')) cur.startRaw = line;
    else if (line.startsWith('DTEND')) cur.endRaw = line;
    else if (line.startsWith('SUMMARY:')) cur.summary = line.slice(8).replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').slice(0, 120);
    else if (line.startsWith('TRANSP:')) cur.transp = line.slice(7).trim();
    else if (line.startsWith('STATUS:')) cur.status = line.slice(7).trim();
    else if (line.startsWith('RRULE:')) cur.rrule = line.slice(6).trim();
  }
  return events;
}

function shapeEvent(raw) {
  const startMs = parseIcsDate(raw.startRaw);
  if (startMs == null) return null;
  let endMs = parseIcsDate(raw.endRaw);
  if (endMs == null) endMs = startMs + 86_400_000; // default 1-day event
  // DTEND is exclusive for VALUE=DATE events → subtract 1 day for our inclusive model.
  if (raw.endRaw && /VALUE=DATE/i.test(raw.endRaw)) {
    endMs = endMs - 86_400_000;
  }
  if (endMs < startMs) endMs = startMs;
  return {
    startMs,
    endMs,
    summary: raw.summary || '(busy)',
    transp: raw.transp || 'OPAQUE',
    status: raw.status || 'CONFIRMED',
    recurring: !!raw.rrule,
  };
}

async function fetchWithBudget(url, maxBytes, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',   // no silent redirect to SSRF-unfriendly host
      signal: ctrl.signal,
      headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      if (loc && isHostAllowed(loc)) {
        return await fetchWithBudget(loc, maxBytes, timeoutMs);
      }
      throw new Error(`redirect_blocked`);
    }
    if (!res.ok) throw new Error(`upstream_${res.status}`);
    // Enforce body size via reader (not res.text() which could buffer unlimited).
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('body_too_large');
      chunks.push(value);
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timer);
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '4kb' }, // just enough for {url}
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!requireAuth(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const body = req.body || {};
  const url = String(body.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'missing_url' });
  if (!isHostAllowed(url)) return res.status(400).json({ ok: false, error: 'host_not_allowed' });

  try {
    const ics = await fetchWithBudget(url, MAX_RESPONSE_BYTES, FETCH_TIMEOUT_MS);
    const rawEvents = parseIcs(ics);
    const now = Date.now();
    const windowEnd = now + WINDOW_DAYS * 86_400_000;

    const events = rawEvents
      .map(shapeEvent)
      .filter((e) => e && e.status !== 'CANCELLED')
      // Skip transparent events (TRANSP:TRANSPARENT = "free time" — not a busy block).
      .filter((e) => e.transp !== 'TRANSPARENT')
      // Keep only events overlapping the rolling 90-day window.
      .filter((e) => e.endMs >= now && e.startMs <= windowEnd)
      // Cap to 200 events for safety (pathological calendars shouldn't DoS us).
      .slice(0, 200);

    // Cache 15 min on the CDN so we don't hammer Google for every refresh.
    res.setHeader('Cache-Control', 'private, max-age=900');
    return res.status(200).json({ ok: true, events, fetchedAt: now, windowDays: WINDOW_DAYS });
  } catch (err) {
    console.error('[ical-proxy]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
}
