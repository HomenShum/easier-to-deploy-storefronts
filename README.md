# easier-to-deploy-storefronts

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) [![Stack](https://img.shields.io/badge/stack-Vercel%20%7C%20Convex%20%7C%20Resend%20%7C%20OpenRouter-purple)](#how-the-stack-divides-the-work) [![Auth](https://img.shields.io/badge/auth-magic--link%20(passwordless)-blue)](#auth-state-machine-passwordless-magic-link)

A drop-in template that lets a developer **stand up a working storefront for a non-technical owner in an afternoon.** A pet-sitter, a tutor, a freelance editor, a mobile mechanic — they all need the same thing on the web side: a multilingual storefront, a single inbox, a way to update prices without calling a developer. This repo is that thing, packaged so the dev does the deploy and never has to log back in.

Built so the owner is **non-technical and stays non-technical** — they edit copy and prices in the live page, see customer messages in a single inbox, sign in via email magic-link, and never touch the codebase, the deploy pipeline, or a database console. You ship code; they ship words.

The four things this gives you, out of the box:

- **A 3-language marketing site** (EN / ZH / ES) with shared structure, language switcher, and edit-in-place CMS hooks on every section. Adding a fourth language is one folder and a route.
- **A passwordless owner auth flow** — Resend-emailed magic-links → 30-day session tokens → "logged-in devices" panel with sign-out-everywhere. No passwords for the owner to forget, no raw API keys in URLs, no third-party identity provider to integrate.
- **A unified inbox** that ingests customer inquiries from the contact form (with auto-translation between Chinese and English via OpenRouter) and gives the owner Assist / Autopilot reply modes.
- **A photo gallery the owner self-manages** — uploads from their phone, compressed client-side, stored in Convex File Storage, capped to N most recent. Bulk-upload script for historical archives.

The reason this template is "easy to deploy and maintain" is structural: **static structure ships through git, dynamic content lives in Convex.** The owner edits the dynamic content with a button on the live page. You ship code; they ship words and prices.

> **Three companion docs:**
> - [`SKILL.md`](SKILL.md) — 10-phase construction playbook (writing the code, with the auth state machine front-and-center)
> - [`DEV_FLOW.md`](DEV_FLOW.md) — the meta-process: integration with [`parity-studio`](https://github.com/HomenShum/parity-studio) and [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions), the 11-phase dev flow from blank-repo to human-tested production, scaling math (free tier → 1M customers/month with Temporal / Fargate / DuckDB / etc.), and interview-prep framing
> - [`PUBLISH_CHECKLIST.md`](PUBLISH_CHECKLIST.md) — pre-flight before going public

---

## How the stack divides the work

| Layer | What it does | Why this one |
|---|---|---|
| **Vercel** | Hosts the static landing pages + `/api/*` serverless functions | Free tier covers solo-operator scale; CDN serves the static parts globally with no config |
| **Convex** | Authoritative state — `inquiries`, `bookings`, `siteContent` (CMS blob per language), `adminAuth` (sessions), file storage for gallery photos | Schema-first DB + reactive queries + free file storage in one product, no separate Postgres / S3 / Redis to wire |
| **Resend** | Customer-reply emails + magic-link delivery + admin notifications | Free tier is 3000 emails / month, 100 / day — plenty for a one-owner business; one API call, one library |
| **OpenRouter** | Auto-translates inbound messages (e.g. customer writes English → owner sees Chinese, or vice versa). Also powers the inbox "Assist" reply suggestions | One key, many models; cheap fallback chain (`kimi-k2` → `qwen3-max` → `deepseek-chat`) so a single provider outage doesn't kill replies |

The *only* runtime services you need an account for are Vercel, Convex, Resend, and OpenRouter. The first two have free tiers that cover steady-state operation forever. Resend + OpenRouter cost roughly $0–$5/month for a small operator's volume.

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/<you>/easier-to-deploy-storefronts
cd easier-to-deploy-storefronts

# 2. Install deps
npm install

# 3. Set up Convex (creates the deployment, generates types)
npx convex dev          # log in via browser, pick "create new project"
                        # leave running in another terminal during local dev

# 4. Configure env (see .env.example for the full list with comments)
cp .env.example .env.local
# fill in: ADMIN_API_KEY, ADMIN_EMAIL_ALLOWLIST, RESEND_API_KEY,
#         MOM_EMAIL, OWNER_EMAIL, OPENROUTER_API_KEY, etc.

# 5. Deploy Convex schema + functions to prod
CONVEX_DEPLOYMENT=prod:<your-deployment> npx convex deploy

# 6. Deploy the Vercel app
npx vercel --prod
# ... when prompted, link to a new project and copy the env vars from
# .env.local into the Vercel dashboard (Production + Preview).

# 7. Test the magic-link flow
# Visit https://<your-app>.vercel.app/inbox
# Enter your allowlisted email → check inbox → click → you're in.
```

That's the entire setup. The owner doesn't see any of this — they just get the magic link in their inbox.

---

## What it actually looks like at runtime

This is the full architecture diagram. Five layers — DEPLOY, FRONTEND, BACKEND, DATABASE, AGENT — and which paths the **owner** vs. the **customer** take. `· LIVE` is in production today; `· OPTIONAL` is wired but inactive unless you turn it on (rate limiting, etc.):

```
┌──────────────────────────── DEPLOY (Vercel — production web) ─────────────────────┐
│                                                                                    │
│  · <your-app>.vercel.app                                                          │
│  · vercel.json:                                                                   │
│      rewrites: /admin → /inbox.html  (mom's bookmark works without ".html")       │
│                /favicon.ico → /favicon.svg                                        │
│      routes:   /api/* → serverless functions in api/                              │
│  · CDN: static HTML/CSS/images cached globally; /api/* hits the function region   │
│                                                                                    │
└─────────────┬──────────────────────────────────────────┬───────────────────────────┘
              │ visitor: GET /                            │ owner: GET /inbox
              ▼                                           ▼
┌─── FRONTEND (CUSTOMER) ───────────────────┐  ┌─── FRONTEND (OWNER) ───────────────┐
│                                            │  │                                    │
│  ~ index.html / zh/index.html / es/index   │  │  ~ inbox.html (admin SPA)          │
│      [hero] [host bio] [pricing] [gallery] │  │     login overlay (email primary,  │
│      [contact form] [faq]                  │  │       password under <details>)    │
│                                            │  │     ↓ POST /api/auth/request-link  │
│  Hydration: every section has data-cms     │  │     ↓ owner clicks email link      │
│  attrs. On load, fetches /api/site-content │  │     → /api/auth/verify             │
│  ?lang=<x> and overlays the dynamic copy.  │  │     → /inbox?key=ses_<hex>         │
│  Static fallback if Convex is unreachable. │  │     → localStorage["pawpaw_inbox_  │
│                                            │  │       key"] = ses_<hex>            │
│  Owner-only FAB (🎨 编辑模式) appears when │  │                                    │
│  /api/site-content?action=verify-key       │  │  Tabs: 咨询列表 / 日历 / 统计 /    │
│  returns 200 for the localStorage token.   │  │  🎨 编辑网站 / 🚪 sessions modal   │
│  Edit-in-place via contenteditable.        │  │                                    │
│                                            │  │                                    │
└────────────────────┬───────────────────────┘  └────────────────┬───────────────────┘
                     │ POST /api/contact                          │ all admin routes
                     │ (multilingual: detect → translate → store) │ require x-api-key
                     ▼                                            ▼
┌─────────────────────── BACKEND (Vercel serverless functions, api/*) ────────────────┐
│                                                                                      │
│  Public:  /api/contact            → translate via OpenRouter, persist to Convex,    │
│                                     fire Resend "new inquiry" email to owner        │
│           /api/site-content?GET   → public CMS read (60s edge cache)                │
│                                                                                      │
│  Auth:    /api/auth/request-link  → allowlist check → mint lnk_ → Resend email     │
│           /api/auth/verify        → exchange lnk_ for ses_, 302 → /inbox?key=ses_   │
│           /api/auth/sessions      → list / revoke devices (gated by ses_ or root)   │
│                                                                                      │
│  Admin:   /api/site-content?POST  → upsert CMS (gated)                              │
│           /api/site-content?gallery-* → upload-url / add / remove (gated)           │
│           /api/admin/notify       → arbitrary owner / operator notification (gated) │
│           /api/inbox              → list / reply to inquiries (gated)               │
│                                                                                      │
│  requireAuth dual-mode:                                                              │
│    1. raw ADMIN_API_KEY   (sync, server-side scripts only)                          │
│    2. ses_<hex> session   (Convex round-trip; only path mom's browser uses)         │
│                                                                                      │
└──┬──────────────────────────────────────┬──────────────────────────────────────┬────┘
   │ all reads/writes                     │ Resend (auth + customer-facing)      │ OpenRouter
   ▼                                       ▼                                       ▼
┌── DATABASE (Convex — schema + funcs + storage) ─┐  ┌── INTEGRATION (Resend) ─┐  ┌── AGENT ────┐
│                                                 │  │                         │  │             │
│  Tables:                                        │  │  · magic-link emails    │  │ OpenRouter  │
│   inquiries        — inbound customer messages  │  │  · new-inquiry alerts   │  │  Models:    │
│      (translation, threadId, replied flag)      │  │  · auto-replies         │  │   kimi-k2   │
│   replies          — outbound by the owner      │  │  · review requests      │  │   qwen3-max │
│   bookings         — confirmed/tentative stays  │  │  · 15s timeout via      │  │   deepseek  │
│   siteContent      — CMS blob, one row per lang │  │    AbortController      │  │             │
│      ({hero, host, pricing, faq, gallery, ...}) │  │  Free tier: 3k/mo, 100/d│  │  Use:       │
│   adminAuth        — kind="link" | "session"    │  │                         │  │  · zh<->en  │
│      (lnk_/ses_ tokens; by_token + by_expires)  │  └─────────────────────────┘  │   translate │
│                                                 │                                │  · reply   │
│  HTTP routes (httpAction, admin-key gated):     │                                │   suggest  │
│   /admin-auth/*   create/consume/list/revoke    │                                │             │
│   /gallery/*      upload-url / add / remove     │                                │  ~$0.001-   │
│   /site-content/* get / upsert                  │                                │  $0.01 per  │
│   /inquiries/*    store / fetch / reply         │                                │  inquiry    │
│                                                 │                                │             │
│  Cron: convex/crons.ts — daily sweepExpired    │                                │             │
│                                                 │                                │             │
│  File storage: gallery photos (~200KB JPEG ea., │                                │             │
│   ctx.storage URLs cached at the edge)          │                                │             │
│                                                 │                                │             │
└─────────────────────────────────────────────────┘                                └─────────────┘

Legend:  · LIVE   · OPTIONAL (wire it when traffic warrants)   ~ MODIFIED   + NEW
```

A reviewer who sees this knows in 30 seconds: customers and the owner take **different code paths through the same site** (one writes inquiries, the other reads them), the **owner's auth is a state machine** (allowlist → email → click → session) entirely under your control, all dynamic content lives in **one CMS blob per language** so adding a section never requires a migration, and the **OpenRouter translation step is what makes the multilingual marketplace actually work** without forcing the owner to write three copies of every reply.

---

## Auth state machine (passwordless magic-link)

The whole authentication surface — including the previously-leaky "raw key in URL" flow — is now this single state machine. Lives in `convex/admin/auth.ts` + `api/auth/*` + `convex/http.ts`:

```
                  ┌──────────────────────────────────┐
                  │   Owner visits /inbox in browser │
                  │   (any device, no account)       │
                  └──────────────┬───────────────────┘
                                 │
                                 ▼
        ┌──────────────────────────────────────────────────┐
        │  Email input + 📧 Send login link                │
        │      ↓                                           │
        │  POST /api/auth/request-link  { email }          │
        │      ↓                                           │
        │  ADMIN_EMAIL_ALLOWLIST contains email?           │
        │      no  → 200 {ok:true, queued:false}  (silent  │
        │             — never leaks who's an admin)        │
        │      yes →                                       │
        │           ↓                                      │
        │     Convex: insert adminAuth row                 │
        │       kind="link", token=lnk_<32-byte-hex>,      │
        │       expiresAt=+15min                           │
        │           ↓                                      │
        │     Resend: email containing                     │
        │       <PUBLIC_BASE_URL>/api/auth/verify          │
        │           ?token=lnk_<hex>                       │
        └──────────────────────────┬───────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  Owner clicks the link in their email client     │
        │      ↓                                           │
        │  GET /api/auth/verify?token=lnk_<hex>            │
        │      ↓                                           │
        │  Convex consumeLink:                             │
        │    · find row by token                           │
        │    · if !row OR kind != "link"  → fail           │
        │    · if consumedAt set          → fail           │
        │    · if expiresAt < now         → fail           │
        │    · patch row.consumedAt = now (single-use)     │
        │    · insert kind="session", token=ses_<hex>,     │
        │      expiresAt=+30 days                          │
        │      ↓                                           │
        │  302 → /inbox?key=ses_<hex>                      │
        │      ↓                                           │
        │  inbox.html magic-link bootstrap:                │
        │    · grabs ?key=  from URL                       │
        │    · localStorage["pawpaw_inbox_key"] = ses_<hex>│
        │    · history.replaceState() scrubs URL           │
        │      ↓                                           │
        │  Owner is signed in. Every admin request now     │
        │  carries x-api-key: ses_<hex>.                   │
        └──────────────────────────┬───────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  On every admin request:                         │
        │      ↓                                           │
        │  api/* requireAuth dual-mode:                    │
        │    1. raw ADMIN_API_KEY     → ok (server-side)   │
        │    2. starts with "ses_"    → POST Convex        │
        │       /admin-auth/validate-session               │
        │       · row exists? not expired? kind=session?   │
        │       · returns {ok, email}                      │
        │    3. else                  → 401                │
        │      ↓                                           │
        │  Owner's email becomes the scope for any         │
        │  session-management call (revokeSessionById      │
        │  refuses to delete sessions outside that email). │
        └──────────────────────────────────────────────────┘
```

**Properties this gives you:**

- 🔐 **No passwords for the owner** — they don't choose one, they don't forget one, they don't get phished.
- 🔐 **No raw key in URL after Phase 1** — the only thing Resend ever ships is `lnk_<hex>`. Single-use. Expired in 15 min.
- 🔐 **Server-validated, fail-closed** — the FAB on the public landing page only shows after `/api/site-content?action=verify-key` returns 200. Convex outage = 401 everywhere, not silent fail-open.
- 🔐 **Email-scoped revocation** — a session caller cannot delete another admin's session, even if they guess the `_id` (verified server-side in `revokeSessionById`).
- 🔐 **No enumeration** — non-allowlist email gets the same `{ok:true, queued:false}` as success. Attackers can't probe the allowlist.
- 🔐 **"Sign out everywhere" exists and works** — one button revokes every session for an email. Verified live.

---

## Why these choices (the actual learnings)

A few decisions worth lifting out — these are the ones that, in retrospect, made the most difference for a non-technical owner:

### 1. Dynamic content lives in one Convex blob per language, not in normalized tables

`siteContent` has exactly one schema:

```ts
siteContent: defineTable({
  lang: v.string(),  // "en" | "zh" | "es"
  data: v.any(),     // free-form blob: { hero, host, why, how, pricing, faq, ... }
  updatedAt: v.number(),
  updatedBy: v.optional(v.string()),
}).index("by_lang", ["lang"])
```

Adding a new editable section (host bio, FAQ row, pricing tier) takes **zero migrations** — just add a `data-cms="hero.eyebrow"` attribute to the HTML and start writing. The frontend owns the shape. The cost is no schema enforcement on dynamic copy, which is fine because the failure mode is "wrong word on a webpage," not "data corruption."

The opposite extreme — normalized `pricing_tiers` / `faq_items` / `hero_text` tables — would have forced a migration for every piece of new copy and a schema review for every wording change. The owner would have hit a wall.

### 2. Edit-in-place via `contenteditable`, not a separate dashboard

The 🎨 编辑模式 button on the public site flips every `[data-cms]` element into a `contenteditable` zone. The owner edits the live page they're already looking at. Save POSTs the diff to `/api/site-content`, which upserts the blob.

A separate `/admin/cms-editor` would be a UI to maintain, a JSON form to fight, a preview-vs-live mismatch to debug. Edit-in-place sidesteps all three. The trick is gating it server-side (the FAB only renders after a valid-key probe — see the security fix in commit history).

### 3. Owner auth ≠ customer auth

Customers don't authenticate. They submit a form, get an email reply, that's the relationship. Building an "account system for customers" would have been weeks of work for nothing — there's nothing they want to manage.

Only the owner authenticates, and they do it with email magic-links because that's the **lowest possible friction** for a non-technical user. They already know how to read email. They don't need to know what a password manager is.

### 4. CMS blob shape diverges per language, on purpose

The English / Chinese / Spanish landing pages all have **the same `data-cms` attribute namespace** but the owner can put **different content under each**. So the Chinese version of the hero says something culturally idiomatic, the Spanish version emphasizes Castro Valley & Hayward (the local Spanish-speaking communities), the English one emphasizes professional bona fides. Same template, three voices. Adding a 4th language is a new folder + a row in `siteContent`.

### 5. The auth flow lives in two layers, not three

The naive design would have been: Convex stores sessions, Vercel API forwards calls, frontend talks to Vercel. That's two network hops per validation.

The shipped design lets the **frontend send `x-api-key: ses_<hex>` directly to Vercel**, and Vercel makes a single Convex round-trip to validate. The legacy raw-key path skips even that round-trip. So the hot path for owner reads (loading the inbox) is **one network hop**, not two.

### 6. Treat the third-party providers as commodities, not platforms

OpenRouter, Resend, Convex, Vercel — all swappable behind the API surface. OpenRouter's free fallback chain (`kimi-k2` → `qwen3-max` → `deepseek-chat`) means a single provider outage doesn't kill translation. Resend's `from:` is configurable, so moving sender domains is a env-var change. Convex's HTTP routes look like any other backend, so migrating to Postgres+Hono later is "rewrite `convex/http.ts`," not "rebuild the auth flow."

The lock-in is in the *integration code*, not the providers. That's the right level to absorb lock-in.

---

## Costs (real numbers from running this)

For a small operator (~50 inquiries/month, 200 visitors/month, ~50 photos in the gallery):

| Service | Tier | Actual usage | Cost |
|---|---|---|---|
| Vercel | Hobby (free) | ~5K function invocations/mo, ~2GB bandwidth | $0 |
| Convex | Free | < 1M function calls/mo, < 100MB storage | $0 |
| Resend | Free | ~100 emails/mo (well under 3K/mo cap) | $0 |
| OpenRouter | PAYG | ~$0.01/inquiry × 50 inquiries | ~$0.50 |
| **Total** | | | **~$0.50/month** |

A custom domain ($12/year) is the only thing that's not free at this scale.

---

## What's in the box

```
api/
  auth/                  passwordless email login (request-link, verify, sessions)
  admin/notify.js        Resend wrapper for owner/operator notifications
  contact.js             customer inquiry intake (translation + storage + alerts)
  inbox.js               admin inbox: list / reply
  site-content.js        public CMS read + admin upsert + gallery uploads + verify-key
  cron/                  scheduled jobs (review-requests, follow-up)
  agent/                 reply suggestions ("泡泡" the inbox assistant)
convex/
  schema.ts              all tables (inquiries, replies, bookings, siteContent, adminAuth)
  admin/auth.ts          createLink, consumeLink, validateSession, revoke*, sweepExpired
  admin/cleanup.ts       test-fixture wipe (manual + cron)
  inquiries/             store / fetch / reply
  bookings/              calendar source-of-truth
  siteContent/           CMS reads (admin writes go through Vercel)
  gallery/store.ts       addPhoto / removePhoto (cap-N, multi-lang fanout)
  http.ts                all the HTTP-routed httpActions
  crons.ts               daily sweepExpired
index.html / zh/index.html / es/index.html    multilingual landing pages
inbox.html               owner SPA (login overlay, tabs, sessions modal)
scripts/bulk-upload-photos.py    bulk-import historical archives
```

## Origin

Built for my mom. She runs a one-person dog-boarding business out of her home in the Bay Area — speaks Chinese natively, picks up English as needed, and wanted a website that lets her edit her own pricing without calling me. The first version was a static site I had to redeploy every time she wanted to change a phrase. After three "Homen, can you change the daycare price to $35 again" texts in one week, I rebuilt it with edit-in-place + magic-link auth.

The `easier-to-deploy-storefronts` framing came after — looking at the design, it generalized cleanly to any developer who's been asked to "make my mom / aunt / friend a website" for a one-person service business: dog boarding, tutoring, photography, freelance editing, mobile mechanics. **One owner setting the terms; many customers asking about availability.** The template is what came out of that generalization, packaged so the *dev* (you) can deploy once and walk away — same target reader as the sibling repo [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions).

## License

MIT. Take it, fork it, adapt it. PRs welcome — particularly:

- Templates for other industries (tutoring, photography, mobile services) — the customer form, gallery semantics, and pricing layout differ.
- More language pairs in the OpenRouter translation chain (Vietnamese, Tagalog, Korean — South Bay regulars).
- A "logged-in devices" panel with last-seen tracking (currently we show created/expires only — last-seen would require turning `validateSession` from query → mutation).
- Booking-side calendar sync (Google Calendar, Apple Calendar) — schema's there, the integration isn't.
- Stripe / payment surface for marketplaces where the owner takes deposits.

## Contact

[@HomenShum](https://github.com/HomenShum) — built this so my mom could update her own website. Reach out if you adapt it for your own solo-operator business; I'd love to see what you build.
