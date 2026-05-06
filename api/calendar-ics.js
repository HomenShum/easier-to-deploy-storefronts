// /api/calendar-ics — iCalendar (RFC 5545) feed of inquiries with parseable dates.
// Mom subscribes with webcal://<your-app>.vercel.app/api/calendar-ics?key=...
// iOS Calendar / Google Calendar refresh this periodically; we set a 5 min cache.
//
// Auth model: private URL via ?key=. Anyone with the URL can read. Same pattern as
// Google Calendar "Secret address in iCal format". Rotate ADMIN_API_KEY to revoke.
//
// Conflict flag: SUMMARY gets a ⚠️ prefix when an event's range overlaps another's.

const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
const CAL_NAME = 'Paw Paw Pet Care · 预订';
const CAL_TZID = 'America/Los_Angeles';
const PRODID = '-//Paw Paw Pet Care//Inquiry Calendar//EN';
const MAX_EVENTS = 500;

// --- Date parsing (mirrors inbox.html parseDatesInMonth, but returns full ranges) ---
// Returns Array<{start: Date, end: Date}> (end is INCLUSIVE day).
function parseRanges(text, refYear) {
  if (!text) return [];
  const out = [];
  const ensure = (m, d1, d2) => {
    const y = refYear;
    const s = new Date(y, m, d1);
    const e = new Date(y, m, d2 || d1);
    if (!isNaN(s) && !isNaN(e)) out.push({ start: s, end: e });
  };

  // M/D or M/D-D or M/D-M/D
  for (const m of text.matchAll(/(\d{1,2})\/(\d{1,2})(?:\s*[-–]\s*(?:(\d{1,2})\/)?(\d{1,2}))?/g)) {
    const m1 = +m[1] - 1, d1 = +m[2];
    const m2 = m[3] ? +m[3] - 1 : m1;
    const d2 = m[4] ? +m[4] : d1;
    if (m1 === m2) ensure(m1, d1, d2);
    else { ensure(m1, d1, 31); ensure(m2, 1, d2); }
  }
  // English month name
  const monthMap = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
  for (const m of text.toLowerCase().matchAll(/(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?/g)) {
    const mi = monthMap[m[1]];
    if (mi == null) continue;
    ensure(mi, +m[2], m[3] ? +m[3] : +m[2]);
  }
  // Chinese: M月D日 or M月D-D日
  for (const m of text.matchAll(/(\d{1,2})月(\d{1,2})(?:\s*[-–~至到]\s*(\d{1,2}))?日?/g)) {
    ensure(+m[1] - 1, +m[2], m[3] ? +m[3] : +m[2]);
  }
  return out;
}

// Pick the year to use when the text has no year. Rule: use the inquiry's submission year.
// If the parsed date is more than 60 days BEFORE the submission, roll to the next year
// (handles "book for Jan" submitted in December).
function yearFor(inquiryTimestamp, parsedMonth, parsedDay) {
  const submitted = new Date(inquiryTimestamp || Date.now());
  let y = submitted.getFullYear();
  const candidate = new Date(y, parsedMonth, parsedDay);
  const diffDays = (candidate - submitted) / 86_400_000;
  if (diffDays < -60) y += 1;
  return y;
}

function fmtIcsDate(d) {
  // UTC extraction — startMs/endMs in the bookings table are UTC midnight.
  // Local extraction would silently shift DTSTART by up to 24hrs for servers
  // running outside UTC.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function fmtIcsStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

function escIcs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 75-octet line folding.
function foldLines(text) {
  const lines = text.split('\r\n');
  const folded = [];
  for (const line of lines) {
    if (line.length <= 75) { folded.push(line); continue; }
    let rest = line;
    folded.push(rest.slice(0, 75));
    rest = rest.slice(75);
    while (rest.length > 74) { folded.push(' ' + rest.slice(0, 74)); rest = rest.slice(74); }
    if (rest.length) folded.push(' ' + rest);
  }
  return folded.join('\r\n');
}

function rangesOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

async function fetchInquiries() {
  const url = `${CONVEX_SITE_URL}/inquiries/fetch?filter=all`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`convex_${res.status}`);
  const body = await res.json();
  return body.inquiries || [];
}

async function fetchBookings() {
  // Bookings table is the authoritative source once populated.
  const url = `${CONVEX_SITE_URL}/bookings/fetch`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    return body.bookings || [];
  } catch {
    return [];
  }
}

function buildIcs({ bookings, inquiries, includeInquiries }) {
  const now = new Date();
  const events = [];

  // Pass 1a: bookings — authoritative. Skip cancelled.
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    const start = new Date(b.startMs);
    const end = new Date(b.endMs);
    if (isNaN(start) || isNaN(end)) continue;
    // Personal blocks = mom's own days off. Use generic summary so notes don't leak
    // to anyone reading the shared ICS subscription.
    const isPersonal = b.service === 'off' || /^Personal /.test(b.customerName || '');
    events.push({
      id: b._id || b.id || `book_${b.startMs}`,
      source: isPersonal ? 'personal' : 'booking',
      start,
      end,
      name: isPersonal ? 'Personal' : (b.customerName || '(no name)'),
      dog: isPersonal ? '' : (b.dogName || ''),
      contact: isPersonal ? '' : (b.customerContact || ''),
      service: isPersonal ? 'off' : (b.service || ''),
      message: isPersonal ? '个人休息 (not available for new bookings)' : (b.notes || ''),
      status: b.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE',
      submittedAt: new Date(b.createdAt || Date.now()),
    });
  }

  // Pass 1b: inquiries (only if explicitly requested OR no bookings yet).
  // Skip any inquiry that's already been promoted (has a booking referencing it).
  if (includeInquiries || bookings.length === 0) {
    const promotedInquiryIds = new Set(bookings.map((b) => String(b.inquiryId || '')));
    for (const inq of inquiries) {
      if (promotedInquiryIds.has(String(inq._id || inq.id || ''))) continue;
      const ranges = parseRanges(inq.dates || '', null);
      for (const r of ranges) {
        const y = yearFor(inq.timestamp, r.start.getMonth(), r.start.getDate());
        const start = new Date(y, r.start.getMonth(), r.start.getDate());
        const end = new Date(y, r.end.getMonth(), r.end.getDate());
        if (isNaN(start) || isNaN(end)) continue;
        events.push({
          id: inq._id || inq.id || `inq_${inq.timestamp}`,
          source: 'inquiry',
          start,
          end,
          name: inq.name || '(no name)',
          dog: inq.dog || '',
          contact: inq.contact || '',
          service: inq.service || '',
          message: (inq.message || '').slice(0, 180),
          status: 'TENTATIVE',
          submittedAt: new Date(inq.timestamp || Date.now()),
        });
      }
    }
  }

  // Pass 2: flag overlapping events.
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (rangesOverlap(events[i], events[j])) {
        events[i].conflict = true;
        events[j].conflict = true;
      }
    }
  }

  // Pass 3: build VCALENDAR.
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escIcs(CAL_NAME)}`,
    `X-WR-TIMEZONE:${CAL_TZID}`,
    'X-PUBLISHED-TTL:PT5M',
    `REFRESH-INTERVAL;VALUE=DURATION:PT5M`,
  ];

  for (const e of events.slice(0, MAX_EVENTS)) {
    // RFC 5545: DTEND is exclusive for VALUE=DATE events. UTC-based so the
    // emitted date matches mom's phone calendar rendering.
    const endExclusive = new Date(Date.UTC(e.end.getUTCFullYear(), e.end.getUTCMonth(), e.end.getUTCDate() + 1));
    const conflictPrefix = e.conflict ? '⚠️ CONFLICT · ' : '';
    const sourceTag = e.source === 'inquiry' ? '[咨询] ' : '';
    // Personal blocks get a generic summary so subscription feed doesn't leak private notes.
    const summary = e.source === 'personal'
      ? `🚫 Personal (休息)`
      : `${conflictPrefix}${sourceTag}${e.name}${e.dog ? ' · ' + e.dog : ''}${e.service ? ' (' + e.service + ')' : ''}`;
    const desc = [
      `Contact: ${e.contact}`,
      `Source: ${e.source === 'booking' ? 'confirmed booking' : 'inquiry (not yet promoted)'}`,
      e.conflict ? '⚠️ Overlaps with another event — check before confirming.' : '',
      '',
      e.message,
    ].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escIcs(e.id)}@<your-app>.vercel.app`);
    lines.push(`DTSTAMP:${fmtIcsStamp(now)}`);
    lines.push(`DTSTART;VALUE=DATE:${fmtIcsDate(e.start)}`);
    lines.push(`DTEND;VALUE=DATE:${fmtIcsDate(endExclusive)}`);
    lines.push(`SUMMARY:${escIcs(summary)}`);
    lines.push(`DESCRIPTION:${escIcs(desc)}`);
    lines.push(`STATUS:${e.status}`);
    lines.push('TRANSP:OPAQUE');
    lines.push(`CATEGORIES:paw-paw,${e.source}${e.conflict ? ',conflict' : ''}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return foldLines(lines.join('\r\n')) + '\r\n';
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const key = (searchParams.get('key') || '').trim();
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey || !key || key !== validKey) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // ?include=inquiries → also emit tentative events from un-promoted inquiries.
  // Default = bookings table only (plus fallback to inquiries if the table is empty).
  const include = (searchParams.get('include') || '').toLowerCase();
  const includeInquiries = include === 'inquiries' || include === 'all';

  try {
    const [bookings, inquiries] = await Promise.all([
      fetchBookings(),
      includeInquiries || true /* always fetch — cheap, needed for empty-bookings fallback */
        ? fetchInquiries()
        : Promise.resolve([]),
    ]);
    const ics = buildIcs({ bookings, inquiries, includeInquiries });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="<your-app>.ics"');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(ics);
  } catch (err) {
    console.error('[calendar-ics] error:', err.message);
    return res.status(502).json({ ok: false, error: 'feed_build_failed' });
  }
}
