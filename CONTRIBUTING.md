# Contributing to easier-to-deploy-storefronts

Thanks for being interested. This template has a deliberate one-owner / many-customers shape, so contributions that **extend** the template (add a new third-party provider option, harden auth, generalize the customer form) are more likely to land than ones that **change** the shape (add multi-tenant support, remove the magic-link flow, swap to a different DB).

## Before opening an issue

Search existing issues first. Then, if you're reporting a bug, please include:

- Which file or endpoint
- What you expected vs. what you observed
- Reproduction steps (a `curl` or a one-liner that reproduces beats prose)
- Your provider versions (Vercel runtime, Convex CLI, Node version)

For feature requests, please answer: "Does this fit the one-owner / many-customers shape, or does it require breaking that shape?" If it requires breaking the shape, the issue is probably going to get closed with "see the README's *What this skill is NOT for* section." That's not a rejection of you — it's the template staying focused.

## Before opening a PR

1. **Open an issue first** for anything beyond a typo / one-line fix. A 30-second alignment chat saves you from rebuilding a feature that won't merge.
2. **Keep diffs scoped.** One PR = one concern. A PR that fixes a bug AND adds a feature AND refactors a third thing is hard to review; reviewers default to closing.
3. **No new dependencies without justification.** Every npm package has a long-tail maintenance cost. If the change can be done with `fetch` + 30 lines, do that.
4. **Match the existing style.** Comments tell the next reader **why**, not what. Functions are small. Server-side validation is fail-closed. If your code drifts from those, you'll get review feedback.

## Style — what I'm picky about

| Concern | Pattern |
|---|---|
| **Auth gates** | Always async `requireAuth(req)`. Always check `await`-ed result. Never trust client-stated email — derive scope from the validated token. |
| **Convex schema changes** | Backwards-compatible migrations only (use `widen → backfill → narrow`). Never delete a field in the same deploy you stop reading it. |
| **CORS** | Explicit allowlist, never `*`. Empty `PUBLIC_BASE_URL` should fail closed (not fall back to "any origin"). |
| **Comments** | "Why this exists" > "what this does." If the line of code says what, the comment says why someone tried the obvious thing first and it broke. |
| **Logging** | Console-log JSON objects with `ev:` short-name keys (e.g. `{ev:'auth_link_sent'}`) — easy to grep in Vercel logs without fancy infrastructure. Truncate user-supplied strings to ~200 chars before logging to avoid log injection. |
| **TypeScript on Convex** | Validators on every public function. Never `v.any()` for arguments — only for free-form `data` blobs that are explicitly part of the schema design (e.g. `siteContent.data`). |
| **Async / await** | No `.then()` chains. No floating promises. If you need fire-and-forget, comment why. |

## High-leverage areas where PRs are especially welcome

- **More language pairs** for the customer-message translation (Vietnamese, Tagalog, Korean, Hindi, Arabic — anything for which the OpenRouter chain has competent models).
- **Templates for other industries** (tutoring, photography, mobile services, freelance editing). The customer form, gallery semantics, and pricing layout differ. New industry = new folder with its own `index.html` + sample `siteContent.data` shape.
- **Stripe or payment integration** for marketplaces that take deposits. Schema's there (`bookings.depositPaid`); the integration isn't.
- **Rate limiting** for `/api/auth/request-link` (currently relies on Resend's 100/day cap). An Upstash Redis token-bucket would fit.
- **A `@frontdesk/cli`** that runs the [`SKILL.md`](SKILL.md) phases interactively. (If you build this, namespace it under your own scope; I'll link it from the README.)
- **A "logged-in devices" panel with last-seen tracking.** Currently we show created/expires only. Last-seen would require turning `validateSession` from query → mutation (cost vs. benefit, see [`SKILL.md`](SKILL.md) Phase 3).
- **GitHub Calendar / Apple Calendar booking sync.** Schema's there (`bookings.startMs`, `endMs`), the integration isn't.

## Companion repos

This template is part of a trio. Contributions to the protocol or design layers are also welcome at:

- [`easier-to-read-submissions`](https://github.com/HomenShum/easier-to-read-submissions) — the changelog + handoff protocol
- [`parity-studio`](https://github.com/HomenShum/parity-studio) — the design staging + visual QA layer

## License

By contributing you agree that your contribution will be licensed under the repository's [MIT license](LICENSE).
