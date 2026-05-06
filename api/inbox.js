// /api/inbox — Combined inbox operations using Convex HTTP actions
// Convex deployment: exuberant-elk-188 (site: https://exuberant-elk-188.convex.site)

// .trim() in case the Vercel env var has a trailing newline (we saw this cause
// silent field-drops on POST elsewhere).
const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();

// In-memory fallback for when Convex is unavailable
const memoryStore = {
  inquiries: [],
  stats: { total: 0, unreplied: 0, replied: 0 }
};

// Helper: call Convex HTTP action
async function convexCall(path, method = 'GET', body = null) {
  const url = `${CONVEX_SITE_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Convex ${res.status}: ${text.slice(0, 120)}`);
  }
  return await res.json();
}

// ============== STORE INQUIRY ==============
async function storeInquiry(body, trace) {
  const { name, contact, message, dog, dates, service, lang, page_url } = body;

  if (!name || !contact || !message) {
    return { ok: false, error: 'missing_fields' };
  }

  const inquiryData = {
    name: String(name).slice(0, 80),
    contact: String(contact).slice(0, 120),
    message: String(message).slice(0, 2000),
    dog: dog ? String(dog).slice(0, 80) : '',
    dates: dates ? String(dates).slice(0, 80) : '',
    service: service ? String(service).slice(0, 30) : '',
    lang: lang || 'en',
    page_url: page_url ? String(page_url).slice(0, 400) : '',
  };

  // Try Convex HTTP action
  try {
    const result = await convexCall('/inquiries/store', 'POST', inquiryData);
    return { ok: true, trace, inquiryId: result.inquiryId, convex: true };
  } catch (e) {
    console.error('Convex store error:', e.message);
  }

  // Fallback to memory
  const id = 'msg_' + Date.now().toString(36);
  const inquiry = {
    ...inquiryData,
    id,
    timestamp: Date.now(),
    replied: false,
    status: 'new',
  };
  memoryStore.inquiries.unshift(inquiry);
  memoryStore.stats.total++;
  memoryStore.stats.unreplied++;
  return { ok: true, trace, inquiryId: id, memory: true };
}

// ============== FETCH INBOX ==============
async function fetchInbox(query, apiKey) {
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey) return { ok: false, error: 'server_misconfigured' }; // fail closed
  if (!apiKey || (apiKey || '').trim() !== validKey) {
    return { ok: false, error: 'unauthorized' };
  }

  const filter = query.filter || 'all';

  // Try Convex HTTP action
  try {
    const result = await convexCall(`/inquiries/fetch?filter=${encodeURIComponent(filter)}`, 'GET');
    // Normalize: add `id` alongside `_id` for frontend compatibility
    const inquiries = (result.inquiries || []).map((i) => ({ ...i, id: i.id || i._id }));
    return {
      ok: true,
      inquiries,
      stats: result.stats || { total: inquiries.length, unreplied: inquiries.filter(x => !x.replied).length },
      convex: true,
    };
  } catch (e) {
    console.error('Convex fetch error:', e.message);
  }

  // Fallback to memory
  let inquiries = [...memoryStore.inquiries];
  if (filter === 'new') inquiries = inquiries.filter(i => !i.replied);
  if (filter === 'replied') inquiries = inquiries.filter(i => i.replied);
  inquiries.sort((a, b) => b.timestamp - a.timestamp);

  return {
    ok: true,
    inquiries,
    stats: { ...memoryStore.stats },
    memory: true,
  };
}

// ============== TRANSLATION (shared helper for reply-translation + templates) ==============
// Plain-text translation via OpenRouter. Simpler than contact.js's JSON-wrapped
// detect+translate: in the inbox context we ALREADY know source + target (mom
// types in ZH, target = customer's detected lang). No detection needed, no JSON
// parsing, no max_tokens truncation risk. Kimi K2 was returning empty content
// when given the wrapped JSON prompt; plain-text output is more reliable.
async function translateText({ text, targetLang, sourceLang }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { text: null, skipped: true, error: 'no_api_key' };
  if (!text || !text.trim()) return { text: '', skipped: false };

  const langName = {
    zh: 'Simplified Chinese (简体中文)', en: 'English', es: 'Spanish', vi: 'Vietnamese',
    tl: 'Tagalog', ko: 'Korean', ja: 'Japanese', hi: 'Hindi', ar: 'Arabic',
    fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese',
  }[String(targetLang || '').toLowerCase()] || targetLang;

  const srcName = {
    zh: 'Chinese', en: 'English', es: 'Spanish', vi: 'Vietnamese', tl: 'Tagalog',
    ko: 'Korean', ja: 'Japanese', hi: 'Hindi', ar: 'Arabic',
  }[String(sourceLang || '').toLowerCase()] || 'the source language';

  // Use a FAST model for on-demand inbox translations — mom is clicking a chip
  // and waiting. Gemini Flash responds in 2-4s vs Kimi K2's 10-15s. Quality is
  // plenty for short reply templates. Falls back via OPENROUTER_TRANSLATE_MODEL env.
  const model = process.env.OPENROUTER_TRANSLATE_MODEL || 'google/gemini-2.5-flash-lite';
  // Plain-text instruction. No JSON. Preserves names/dates/phone/price literals.
  const system = `Translate from ${srcName} to ${langName}. Preserve dog names, human names, dates, phone numbers, email addresses, and prices exactly as written. Output ONLY the translation — no prefixes, no explanation, no markdown, no quotes around the output.`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22_000);
  let rawContent = null;
  let httpStatus = null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'http-referer': 'https://<your-app>.vercel.app',
        'x-title': 'Paw Paw Pet Care inbox translate',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      }),
    });
    httpStatus = res.status;
    const respText = await res.text();
    if (!res.ok) throw new Error(`openrouter_${res.status}: ${respText.slice(0, 200)}`);
    const data = JSON.parse(respText);
    rawContent = data?.choices?.[0]?.message?.content || '';
    // Light cleanup: strip surrounding quotes/fences if model adds them despite instructions.
    const cleaned = rawContent.trim()
      .replace(/^```(?:[a-z]+)?\s*/i, '').replace(/\s*```$/, '')
      .replace(/^["'“]/, '').replace(/["'”]$/, '')
      .trim();
    if (!cleaned) {
      return { text: null, skipped: false, error: 'empty_translation', rawContent: rawContent.slice(0, 200), httpStatus };
    }
    return { text: cleaned, detectedLang: sourceLang || null, skipped: false };
  } catch (err) {
    return {
      text: null, skipped: false,
      error: err.message || String(err),
      rawContent: rawContent ? rawContent.slice(0, 200) : null,
      httpStatus,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============== REPLY TO CUSTOMER ==============
async function sendReply(body, apiKey) {
  const validKey = String(process.env.ADMIN_API_KEY || '').trim();
  if (!validKey) return { ok: false, error: 'server_misconfigured' }; // fail closed
  if (!apiKey || (apiKey || '').trim() !== validKey) {
    return { ok: false, error: 'unauthorized' };
  }

  const { inquiryId, message, translateReply } = body;
  if (!inquiryId || !message) {
    return { ok: false, error: 'missing_fields' };
  }

  // Look up the inquiry early so we know detectedLang + contact up front.
  // We need this for: (1) optional reply translation, (2) email send targeting.
  let contactAddr = null;
  let detectedLang = null;
  try {
    const fetchResult = await convexCall(`/inquiries/fetch?filter=all`, 'GET');
    const inq = (fetchResult.inquiries || []).find(i => (i._id || i.id) === inquiryId);
    if (inq) {
      contactAddr = inq.contact;
      detectedLang = inq.detectedLang || inq.lang || null;
    }
  } catch {}
  if (!contactAddr) {
    const memInq = memoryStore.inquiries.find(i => i.id === inquiryId);
    if (memInq) {
      contactAddr = memInq.contact;
      detectedLang = memInq.detectedLang || memInq.lang || null;
    }
  }

  // Optional: translate mom's reply into the customer's detected language.
  // Only fires when the caller explicitly asks AND the customer's language isn't ZH.
  // If translation fails we return an error — safer than silently sending ZH to a
  // Spanish speaker and confusing them.
  let outboundText = String(message);
  let sentLang = 'zh'; // mom's native
  let translation = null;
  if (translateReply && detectedLang && detectedLang !== 'zh') {
    const t = await translateText({ text: outboundText, targetLang: detectedLang, sourceLang: 'zh' });
    if (!t.text) {
      return { ok: false, error: 'translate_failed', detail: t.error || 'unknown' };
    }
    translation = t.text;
    outboundText = translation;
    sentLang = detectedLang;
  }

  // Persist outbound text + (if translated) mom's ZH original.
  // Optional-field drop on the Vercel→Convex path is a known quirk, so we stash
  // both texts inside the core `replyMessage` field using an unambiguous delimiter.
  // The customer's email uses `outboundText` directly — this only affects the
  // admin inbox's stored value, which the frontend splits back into two halves.
  const REPLY_ORIG_DELIMITER = '\n\n【ZH-ORIGINAL】\n';
  let convexOk = false;
  try {
    let persistedReply = outboundText;
    if (translation && String(message) !== outboundText) {
      persistedReply = outboundText + REPLY_ORIG_DELIMITER + String(message);
    }
    const payload = {
      inquiryId,
      replyMessage: persistedReply.slice(0, 4000), // room for both halves
    };
    const result = await convexCall('/inquiries/reply', 'POST', payload);
    if (result.ok) convexOk = true;
  } catch (e) {
    console.error('Convex reply error:', e.message);
  }

  // Send email via Resend if configured and contact is email
  const channels = [];
  try {
    if (contactAddr && contactAddr.includes('@') && process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Yan @ Paw Paw Pet Care <onboarding@resend.dev>',
          to: contactAddr,
          subject: 'Re: Your Paw Paw Pet Care Inquiry',
          text: `${outboundText}\n\n---\nYan\nPaw Paw Pet Care\n415-823-0199`,
          html: `<div style="font-family: sans-serif;"><p>${outboundText.replace(/\n/g, '<br>')}</p><hr><p>Yan<br>Paw Paw Pet Care<br>📞 415-823-0199</p></div>`,
        }),
      });
      if (res.ok) channels.push('email');
    }
  } catch (e) {
    console.error('Email send error:', e.message);
  }

  if (convexOk) {
    return { ok: true, convex: true, channels, sentLang, translation };
  }

  // Fallback: update memory store
  const memInq = memoryStore.inquiries.find(i => i.id === inquiryId);
  if (memInq) {
    memInq.replied = true;
    memInq.repliedAt = Date.now();
    memInq.replyMessage = outboundText;
    memoryStore.stats.unreplied = Math.max(0, memoryStore.stats.unreplied - 1);
    memoryStore.stats.replied = (memoryStore.stats.replied || 0) + 1;
    return { ok: true, memory: true, channels, sentLang, translation };
  }

  return { ok: false, error: 'inquiry_not_found' };
}

// ============== MAIN HANDLER ==============
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const action = searchParams.get('action') || req.body?.action;

  try {
    // GET requests → fetch inbox
    if (req.method === 'GET') {
      const apiKey = req.headers['x-api-key'];
      const result = await fetchInbox({ filter: searchParams.get('filter') }, apiKey);
      // Surface auth failures as HTTP 401 so the frontend's auth-retry path fires
      // instead of tripping a generic "unauthorized" error that users can't act on.
      if (result && result.ok === false && result.error === 'unauthorized') {
        return res.status(401).json(result);
      }
      return res.json(result);
    }

    // POST requests → reply or store
    if (req.method === 'POST') {
      const body = req.body;
      const apiKey = req.headers['x-api-key'];

      if (action === 'reply') {
        const result = await sendReply(body, apiKey);
        if (result && result.ok === false && result.error === 'unauthorized') {
          return res.status(401).json(result);
        }
        return res.json(result);
      }

      // Translate arbitrary text (used by template translation in the inbox UI).
      // Admin-auth only. Body: {text, targetLang, sourceLang?}
      if (action === 'translate') {
        const validKey = String(process.env.ADMIN_API_KEY || '').trim();
        if (!validKey) return res.status(500).json({ ok: false, error: 'server_misconfigured' });
        if (!apiKey || (apiKey || '').trim() !== validKey) {
          return res.status(401).json({ ok: false, error: 'unauthorized' });
        }
        const text = String(body?.text || '').slice(0, 4000);
        const targetLang = String(body?.targetLang || '').slice(0, 8).toLowerCase();
        const sourceLang = body?.sourceLang ? String(body.sourceLang).slice(0, 8).toLowerCase() : undefined;
        if (!text || !targetLang) return res.status(400).json({ ok: false, error: 'missing_fields' });
        const t = await translateText({ text, targetLang, sourceLang });
        if (!t.text) return res.status(502).json({ ok: false, error: t.error || 'translate_failed', debug: t });
        return res.json({ ok: true, text: t.text, detectedLang: t.detectedLang });
      }

      // Default: store inquiry
      const trace = 'msg_' + Date.now().toString(36);
      const result = await storeInquiry(body, trace);
      return res.json(result);
    }

    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('Inbox handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
