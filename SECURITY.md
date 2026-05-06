# Security policy

This template ships an admin auth flow and a CMS-write surface. If you find a vulnerability in either, please report it privately rather than opening a public issue.

## Reporting a vulnerability

Email **`hshum2018@gmail.com`** with subject `[security] easier-to-deploy-storefronts`.

Include:

- The affected file or endpoint
- Reproduction steps (or a minimal proof-of-concept)
- The realistic impact (e.g. "anyone can read the inquiry table," "stale links can be re-used," "CORS allowlist bypass")
- Whether you've disclosed this to anyone else

I'll acknowledge within **3 business days** and coordinate a fix + disclosure timeline. For high-severity issues (auth bypass, data exfiltration, RCE-equivalents) I aim to ship a patch within 14 days. For lower-severity (rate limiting, log hygiene, hardening) timelines are looser.

## What's in scope

This template's own surface — the auth state machine in `convex/admin/auth.ts`, the Vercel routes under `api/auth/*`, the admin gates on `api/site-content.js` and `api/admin/notify.js`, the public landing-page CMS hydration, and the shipped cron jobs.

## What's out of scope

- **Bugs in upstream providers** (Convex, Vercel, Resend, OpenRouter). Report those to the provider directly.
- **Bugs in your fork's customizations** that aren't present in this template. If `git diff origin/main` shows the issue is in your changes, the template can't help.
- **Issues that require already-elevated access.** A bug that requires the attacker to already hold the `ADMIN_API_KEY` is not a vulnerability in the template — it's a reason to rotate the key.
- **Rate-limit / DoS reports without a working PoC.** The Vercel + Convex tier limits provide soft rate limiting by default. If you have a real amplification, please include the math.

## Things that ARE template-level concerns (PRs welcome)

- The `requireAuth` dual-mode gate (raw key OR `ses_<hex>` session token) — any path that accepts an invalid token is a vulnerability.
- The single-use enforcement on `lnk_<hex>` magic-link tokens (Convex `consumeLink` mutation patches `consumedAt` before minting the session — verify the race-safety claim still holds).
- The email-scope check in `revokeSessionById` — a session caller must not be able to revoke another admin's session.
- The CORS allowlist on the public API surface (`api/site-content.js`, `api/admin/notify.js`) — never `Access-Control-Allow-Origin: *`.
- The `Cache-Control: no-store` on `verify-key`, `verify`, `request-link`, and `sessions` responses.
- The 64KB body cap on `api/site-content.js` POST.
- The body-shape validators on every Convex public mutation.

## Hall of fame

If you report a real bug and want acknowledgment, I'll list you here with a one-line description of the find. PRs to fix the bug are welcome too — credit for both the report and the fix lands in the changelog and here.

(empty so far — be the first)
