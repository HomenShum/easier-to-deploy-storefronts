// /api/contact — Phase 1 contact-form endpoint.
//
// Flow:
//   1. Validate body (size, shape, honeypot).
//   2. Rate-limit by IP (in-memory LRU, bounded).
//   3. Translate the user's message to Chinese via OpenRouter (if EN) or English (if ZH).
//   4. Send two emails via Resend: mom (zh-primary, en-backup) + owner (audit copy).
//   5. Return {ok, traceId}. Never echo the API key or environment.
//
// Phase 2 will move rate-limit to Upstash, add structured logs to Axiom, and
// plug in an eval harness. This file intentionally stays boring.

// Platform-level body-size gate: Vercel rejects > 16KB with 413 before this
// handler runs. Required because Vercel auto-parses JSON; an in-handler size
// check on req.body would be dead code for JSON content-types.
export const config = {
  api: {
    bodyParser: { sizeLimit: '16kb' },
  },
};

const MAX_BODY_BYTES = 16 * 1024;            // mirrored for string-body paths (non-JSON requests)
const MAX_FIELD_LEN = { name: 80, contact: 120, dates: 80, dog: 80, service: 30, message: 2000, lang: 4, page_url: 400, utm_source: 40, utm_medium: 40, utm_campaign: 60 };
// .trim() because the Vercel env var was pasted with a trailing \r\n.
const CONVEX_SITE_URL = (process.env.CONVEX_SITE_URL || 'https://<your-deployment>.convex.site').trim();
// Derived .convex.cloud URL for the ConvexHttpClient SDK (different subdomain than HTTP actions).
const CONVEX_CLOUD_URL = CONVEX_SITE_URL.replace('.convex.site', '.convex.cloud');
const RATE_LIMIT = { windowMs: 60_000, max: 3, lruMax: 1000 };
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'moonshotai/kimi-k2-0905';
const FALLBACK_MODELS = ['qwen/qwen3-max', 'deepseek/deepseek-chat-v3.1:free'];
const TRANSLATE_TIMEOUT_MS = 8_000;
const EMAIL_TIMEOUT_MS = 8_000;

// --- Bounded in-memory rate-limit (HONEST_BOUND per agent-reliability 8-pt) ---
const rlHits = new Map(); // ip -> { count, resetAt }
function rateLimit(ip) {
  const now = Date.now();
  const entry = rlHits.get(ip);
  if (!entry || entry.resetAt < now) {
    rlHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
  } else {
    entry.count += 1;
    if (entry.count > RATE_LIMIT.max) return false;
  }
  // Eviction — never let the map grow unbounded.
  if (rlHits.size > RATE_LIMIT.lruMax) {
    const oldestKey = rlHits.keys().next().value;
    rlHits.delete(oldestKey);
  }
  return true;
}

function sanitize(data) {
  const out = {};
  for (const [k, max] of Object.entries(MAX_FIELD_LEN)) {
    const v = data?.[k];
    if (typeof v === 'string') out[k] = v.trim().slice(0, max);
    else out[k] = '';
  }
  // Fallback: if utm_* weren't sent explicitly but page_url has them, mine them.
  if (!out.utm_source && out.page_url) {
    try {
      const u = new URL(out.page_url);
      out.utm_source = out.utm_source || (u.searchParams.get('utm_source') || '').slice(0, 40);
      out.utm_medium = out.utm_medium || (u.searchParams.get('utm_medium') || '').slice(0, 40);
      out.utm_campaign = out.utm_campaign || (u.searchParams.get('utm_campaign') || '').slice(0, 60);
    } catch { /* bad url — ignore */ }
  }
  return out;
}

// Write to Convex so inbox surfaces real customer inquiries. Fire-and-forget
// from the handler's perspective — if Convex is down, customer still gets email.
// Use the ConvexHttpClient SDK instead of raw fetch to the HTTP action. The HTTP
// action path was silently dropping optional fields (utm_*) from Vercel but not
// from other clients — root cause never fully isolated, but SDK path is canonical
// and validated end-to-end.
async function storeInConvex(clean, trace) {
  const payload = {
    name: clean.name,
    contact: clean.contact,
    message: clean.message,
  };
  if (clean.dog) payload.dog = clean.dog;
  if (clean.dates) payload.dates = clean.dates;
  if (clean.service) payload.service = clean.service;
  if (clean.lang) payload.lang = clean.lang;
  if (clean.page_url) payload.page_url = clean.page_url;
  if (clean.utm_source) payload.utm_source = clean.utm_source;
  if (clean.utm_medium) payload.utm_medium = clean.utm_medium;
  if (clean.utm_campaign) payload.utm_campaign = clean.utm_campaign;
  if (clean.detectedLang) payload.detectedLang = clean.detectedLang;
  if (clean.translatedMessage) payload.translatedMessage = clean.translatedMessage;

  try {
    const { ConvexHttpClient } = await import('convex/browser');
    const client = new ConvexHttpClient(CONVEX_CLOUD_URL);
    const result = await client.mutation('inquiries/store:storeInquiry', payload);
    console.log(JSON.stringify({ trace, ev: 'convex_store_ok_sdk', inquiryId: result.inquiryId, detected: payload.detectedLang }));
    return result.inquiryId;
  } catch (err) {
    console.error(JSON.stringify({ trace, ev: 'convex_store_fail_sdk', err: String(err).slice(0, 200) }));
    return null;
  }
}

function traceId() {
  return 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function withTimeout(promise, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`${label}_timeout`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// Translate text + auto-detect source language in one OpenRouter call.
// Returns {text, detectedLang, model, skipped}. targetLang is an ISO 639-1
// code ("zh", "en", "es", etc.). If sourceLang is omitted, we ask the model
// to detect it in the same response — saves a round-trip.
//
// Output contract: the model returns JSON `{"detectedLang":"xx","translation":"..."}`.
// We parse it robustly (stripping code fences, falling back to raw on parse error).
// Normalize language identifiers the model might return (names, aliases) to ISO 639-1.
// Kimi K2 occasionally returns "Spanish" or "español" instead of "es" despite prompting.
function normalizeLangCode(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return null;
  // Already a valid 2-letter code
  if (/^[a-z]{2}$/.test(s)) return s;
  const map = {
    'english': 'en', 'en-us': 'en', 'en-gb': 'en',
    'chinese': 'zh', 'mandarin': 'zh', 'cantonese': 'zh', 'simplified chinese': 'zh',
    'simplified': 'zh', '简体中文': 'zh', '中文': 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh',
    'spanish': 'es', 'español': 'es', 'castellano': 'es',
    'vietnamese': 'vi', 'tiếng việt': 'vi', 'tieng viet': 'vi',
    'tagalog': 'tl', 'filipino': 'tl',
    'korean': 'ko', '한국어': 'ko',
    'japanese': 'ja', '日本語': 'ja',
    'hindi': 'hi', 'हिन्दी': 'hi',
    'arabic': 'ar', 'العربية': 'ar',
    'french': 'fr', 'français': 'fr', 'francais': 'fr',
    'german': 'de', 'deutsch': 'de',
    'russian': 'ru', 'русский': 'ru',
    'portuguese': 'pt', 'português': 'pt', 'portugues': 'pt',
  };
  if (map[s]) return map[s];
  // Try to extract a 2-letter code from anywhere in the string (e.g., "(es)" or "code: vi")
  const m = s.match(/\b([a-z]{2})\b/);
  if (m) return m[1];
  return null;
}

async function translateAndDetect({ text, targetLang, sourceLang, trace }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.warn(JSON.stringify({ trace, ev: 'translate_skip', reason: 'no_api_key' }));
    return { text: null, detectedLang: null, model: null, skipped: true };
  }
  const targetName = {
    zh: 'Simplified Chinese (简体中文)', en: 'English', es: 'Spanish', vi: 'Vietnamese',
    tl: 'Tagalog', ko: 'Korean', ja: 'Japanese', hi: 'Hindi', ar: 'Arabic',
    fr: 'French', de: 'German', ru: 'Russian', pt: 'Portuguese',
  }[targetLang] || targetLang;

  const models = [DEFAULT_MODEL, ...FALLBACK_MODELS];
  const system = sourceLang
    ? `You are a professional translator for a small dog-boarding business. Translate the user's message from ${sourceLang} to ${targetName}. Preserve intent, tone, dog names, human names, dates, phone numbers, and email addresses exactly. Do not add greetings or sign-offs. Respond with ONLY valid JSON in this exact shape (no markdown, no code fences, no commentary): {"detectedLang":"${sourceLang}","translation":"..."}`
    : `You are a professional translator for a small dog-boarding business. First detect the source language of the user's message as an ISO 639-1 two-letter code (e.g. "en", "zh", "es", "vi", "tl", "ko", "ja", "hi", "ar"). Then translate the message to ${targetName}. Preserve intent, tone, dog names, human names, dates, phone numbers, and email addresses exactly. Do not add greetings or sign-offs. Respond with ONLY valid JSON in this exact shape (no markdown, no code fences, no commentary): {"detectedLang":"xx","translation":"..."}`;

  let lastErr = null;
  for (const model of models) {
    try {
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 1000,
        // response_format json — supported by most OpenRouter models, ignored otherwise.
        response_format: { type: 'json_object' },
      };
      const result = await withTimeout(async (signal) => {
        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          signal,
          headers: {
            'authorization': `Bearer ${key}`,
            'content-type': 'application/json',
            'http-referer': 'https://<your-app>.vercel.app',
            'x-title': 'Paw Paw Pet Care translation',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`openrouter_${res.status}: ${detail.slice(0, 200)}`);
        }
        return await res.json();
      }, TRANSLATE_TIMEOUT_MS, 'translate');

      const raw = result?.choices?.[0]?.message?.content?.trim() || '';
      // Strip markdown fences if the model added them despite instructions.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Model didn't produce JSON — treat the whole output as translation, lang unknown.
        console.warn(JSON.stringify({ trace, ev: 'translate_json_parse_fail', model, preview: raw.slice(0, 80) }));
        parsed = { detectedLang: sourceLang || null, translation: cleaned };
      }
      const translation = String(parsed.translation || '').trim();
      const detected = normalizeLangCode(parsed.detectedLang || sourceLang);
      if (translation) {
        console.log(JSON.stringify({ trace, ev: 'translate_ok', model, detected, chars: translation.length }));
        return { text: translation, detectedLang: detected || null, model, skipped: false };
      }
      throw new Error('empty_translation');
    } catch (err) {
      lastErr = err;
      console.warn(JSON.stringify({ trace, ev: 'translate_fail', model, err: String(err).slice(0, 200) }));
    }
  }
  throw lastErr || new Error('translate_all_models_failed');
}

async function sendEmail({ to, subject, html, text, replyTo, trace }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(JSON.stringify({ trace, ev: 'email_skip', reason: 'no_resend_key', to }));
    return { id: null, skipped: true };
  }
  const from = process.env.EMAIL_FROM || 'Paw Paw Pet Care <onboarding@resend.dev>';
  return await withTimeout(async (signal) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal,
      headers: {
        'authorization': `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text, reply_to: replyTo }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`resend_${res.status}: ${detail.slice(0, 200)}`);
    }
    const body = await res.json();
    console.log(JSON.stringify({ trace, ev: 'email_ok', id: body.id, to }));
    return { id: body.id, skipped: false };
  }, EMAIL_TIMEOUT_MS, 'email');
}

// Map ISO 639-1 codes to Chinese-display names for email templates.
function langNameZh(code) {
  return {
    en: '英文 (English)', zh: '中文', es: '西班牙文 (Español)', vi: '越南文 (Tiếng Việt)',
    tl: '菲律宾文 (Tagalog)', ko: '韩文 (한국어)', ja: '日文 (日本語)', hi: '印地文 (हिन्दी)',
    ar: '阿拉伯文 (العربية)', fr: '法文 (Français)', de: '德文 (Deutsch)',
    ru: '俄文 (Русский)', pt: '葡萄牙文 (Português)',
  }[String(code || '').toLowerCase()] || (code ? `${code.toUpperCase()} 语` : '未知语言');
}

function buildMomEmail(original, translated, sourceLang) {
  const isChinese = sourceLang === 'zh';
  const langDisplay = langNameZh(sourceLang);
  const intro = isChinese ? '🐾 新客户留言' : `🐾 新客户留言（${langDisplay}，已翻译为中文）`;
  const fields = [
    ['姓名', original.name],
    ['联系方式', original.contact],
    ['日期', original.dates || '（未填）'],
    ['狗狗', original.dog || '（未填）'],
    ['服务', labelService(original.service, 'zh')],
    ['来源语言', langDisplay],
  ];
  const messageZh = isChinese ? original.message : (translated || original.message);
  const rows = fields.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#555;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:500">${escapeHtml(v)}</td></tr>`).join('');
  const originalBlock = isChinese ? '' : `<hr style="border:0;border-top:1px solid #eee;margin:16px 0" /><div style="color:#888;font-size:12px;margin-bottom:4px">原文（${escapeHtml(langDisplay)}）：</div><div style="white-space:pre-wrap;color:#666;font-size:13px">${escapeHtml(original.message)}</div>`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(intro)}</h2>
  <table style="border-collapse:collapse;font-size:14px">${rows}</table>
  <div style="margin-top:14px;padding:14px;background:#fafaf7;border-radius:8px;white-space:pre-wrap;font-size:14px;line-height:1.5">${escapeHtml(messageZh)}</div>
  ${originalBlock}
  <p style="margin-top:20px;font-size:12px;color:#888">请尽量在一小时内回复。营业时间：早 8 点 – 晚 8 点。${isChinese ? '' : '在管理页面回复时，可以勾选"翻译回客户语言"让系统自动翻译。'}</p>
</div>`;
  const text = `${intro}\n\n姓名：${original.name}\n联系方式：${original.contact}\n日期：${original.dates || '（未填）'}\n狗狗：${original.dog || '（未填）'}\n服务：${labelService(original.service, 'zh')}\n来源语言：${langDisplay}\n\n${messageZh}${isChinese ? '' : `\n\n--- 原文 (${langDisplay}) ---\n${original.message}`}`;
  return { html, text, subject: `🐾 新留言 · ${original.name} (${original.contact})` };
}

function buildOwnerEmail(original, translated, sourceLang, trace) {
  const intro = 'New contact form submission (audit copy)';
  const lines = [
    ['Trace', trace],
    ['Lang', sourceLang],
    ['Name', original.name],
    ['Contact', original.contact],
    ['Dates', original.dates || '(blank)'],
    ['Dog', original.dog || '(blank)'],
    ['Service', labelService(original.service, 'en')],
    ['Page', original.page_url || '(blank)'],
  ];
  const rows = lines.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#555">${escapeHtml(k)}</td><td style="padding:3px 0">${escapeHtml(v)}</td></tr>`).join('');
  const zhBlock = translated ? `<div style="margin-top:14px;padding:12px;background:#f0f5f2;border-radius:6px;white-space:pre-wrap;font-size:13px"><div style="color:#888;font-size:11px;margin-bottom:4px">ZH (sent to mom):</div>${escapeHtml(translated)}</div>` : '';
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 10px;font-size:16px">${escapeHtml(intro)}</h2>
  <table style="border-collapse:collapse;font-size:13px">${rows}</table>
  <div style="margin-top:12px;padding:12px;background:#fafaf7;border-radius:6px;white-space:pre-wrap;font-size:13px">${escapeHtml(original.message)}</div>
  ${zhBlock}
</div>`;
  const text = `${intro}\ntrace=${trace}\nlang=${sourceLang}\nname=${original.name}\ncontact=${original.contact}\n\n${original.message}\n${translated ? '\n--- ZH ---\n' + translated : ''}`;
  return { html, text, subject: `[pawpaw] Contact · ${original.name}` };
}

function labelService(s, lang) {
  const en = { boarding: 'Overnight boarding', daycare: 'Daycare', walk: 'Dog walking', dropin: 'Drop-in visit', meet: 'Meet-and-greet', '': 'Not sure yet' };
  const zh = { boarding: '过夜寄养', daycare: '日托', walk: '遛狗', dropin: '上门探望', meet: '先见个面', '': '还不确定' };
  return (lang === 'zh' ? zh : en)[s || ''] || s;
}

export default async function handler(req, res) {
  const trace = traceId();
  res.setHeader('x-trace-id', trace);

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed', traceId: trace });
  }

  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    console.warn(JSON.stringify({ trace, ev: 'rate_limited', ip: ip.slice(0, 40) }));
    return res.status(429).json({ ok: false, error: 'rate_limited', traceId: trace });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) return res.status(413).json({ ok: false, error: 'body_too_large', traceId: trace });
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: 'bad_json', traceId: trace }); }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'bad_body', traceId: trace });
  }
  if (body.website) {
    // Honeypot tripped. Pretend success — don't give spammers signal.
    console.warn(JSON.stringify({ trace, ev: 'honeypot_tripped', ip: ip.slice(0, 40) }));
    return res.status(200).json({ ok: true, traceId: trace });
  }

  const clean = sanitize(body);
  if (!clean.name || !clean.contact || !clean.message) {
    return res.status(400).json({ ok: false, error: 'missing_fields', traceId: trace });
  }

  // Always translate to Chinese for mom. Auto-detect the source language in the
  // same OpenRouter call — covers Spanish, Vietnamese, Tagalog, Korean, etc. without
  // needing separate code paths. If Chinese came in, skip translation (mom reads it).
  let translated = null;
  let detectedLang = null;
  const formHint = (clean.lang || '').toLowerCase();

  if (formHint === 'zh') {
    // Customer used the ZH form; trust that, no translation needed for mom.
    detectedLang = 'zh';
  } else {
    try {
      // Pass form hint as sourceLang advisory ONLY if it looks trustworthy (en/zh).
      // Otherwise let the model detect from the message content.
      const hintable = formHint === 'en' ? 'English' : undefined;
      const t = await translateAndDetect({
        text: clean.message,
        targetLang: 'zh',
        sourceLang: hintable,
        trace,
      });
      translated = t.text;
      detectedLang = t.detectedLang;
    } catch (err) {
      console.warn(JSON.stringify({ trace, ev: 'translate_failed_noncritical', err: String(err).slice(0, 200) }));
    }
  }

  // Normalize detectedLang — default to form hint if detection yielded nothing.
  const sourceLang = detectedLang || formHint || 'en';

  const momEmail = buildMomEmail(clean, sourceLang === 'en' ? translated : null, sourceLang);
  const ownerEmail = buildOwnerEmail(clean, sourceLang === 'en' ? translated : null, sourceLang, trace);

  // Recipients come from env. Empty → caller responsible (we silently skip
  // that address). Configure MOM_EMAIL (owner) and OWNER_EMAIL (operator) in Vercel.
  const momTo = String(process.env.MOM_EMAIL || '').trim();
  const ownerTo = String(process.env.OWNER_EMAIL || '').trim();
  const replyTo = clean.contact.includes('@') ? clean.contact : undefined;

  // Parallel: persist to Convex (so inbox shows this inquiry) + send both emails.
  // Overload `lang` with the detected value since optional-string fields have been
  // observed to silently drop on the Vercel→Convex SDK path (see HANDOFF.md known
  // issues). `lang` is a core field that always persists, so we use it as the ground
  // truth for language in the inbox UI.
  const convexPayload = {
    ...clean,
    lang: sourceLang || clean.lang || 'en',
    detectedLang: sourceLang,
    translatedMessage: translated || undefined,
  };
  const results = await Promise.allSettled([
    sendEmail({ to: momTo, subject: momEmail.subject, html: momEmail.html, text: momEmail.text, replyTo, trace }),
    sendEmail({ to: ownerTo, subject: ownerEmail.subject, html: ownerEmail.html, text: ownerEmail.text, replyTo, trace }),
    storeInConvex(convexPayload, trace),
  ]);

  const momStatus = results[0].status;
  const ownerStatus = results[1].status;
  console.log(JSON.stringify({ trace, ev: 'submission', lang: sourceLang, mom: momStatus, owner: ownerStatus, translated: !!translated }));

  if (momStatus === 'rejected' && ownerStatus === 'rejected') {
    return res.status(502).json({ ok: false, error: 'email_send_failed', traceId: trace });
  }
  
  // Store in unified inbox (await so it completes before serverless fn ends)
  try {
    await fetch(`https://${req.headers.host}/api/inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: clean.name,
        contact: clean.contact,
        message: clean.message,
        dog: clean.dog,
        dates: clean.dates,
        service: clean.service,
        lang: sourceLang,
        page_url: clean.page_url
      })
    });
  } catch (e) {
    console.error('Inbox store failed:', e.message);
  }
  
  // Trigger autopilot: instant auto-reply to customer + SMS alert to mom
  try {
    fetch(`https://${req.headers.host}/api/auto-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerEmail: clean.contact.includes('@') ? clean.contact : null,
        customerPhone: clean.contact.match(/\d{10,}/) ? '+1' + clean.contact.replace(/\D/g, '') : null,
        customerName: clean.name,
        lang: sourceLang,
        inquiryType: clean.service || 'general'
      })
    }).catch(() => {}); // Fire and forget
  } catch {}
  
  return res.status(200).json({ ok: true, traceId: trace, translated: !!translated });
}
