## Summary

(1–3 sentences on what this PR does and why.)

## Linked issue

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Docs / README / SKILL / DEV_FLOW update only
- [ ] CI / tooling

## Scope

Which files / surfaces did you touch? (One PR = one concern, please.)

- [ ] Auth (`convex/admin/auth.ts`, `api/auth/*`)
- [ ] Public CMS (`api/site-content.js`, landing pages)
- [ ] Owner inbox (`inbox.html`, `api/inbox.js`)
- [ ] Customer intake (`api/contact.js`, agent / translation)
- [ ] Gallery (`convex/gallery/store.ts`, `scripts/bulk-upload-photos.py`)
- [ ] Bookings (`convex/bookings/*`)
- [ ] Cron (`convex/crons.ts`, `api/cron/*`)
- [ ] Docs only

## Test plan

- [ ] Ran `npm install` from a fresh clone
- [ ] Ran `npx convex codegen --typecheck enable` (no errors)
- [ ] Manually verified the unhappy paths I added/changed
- [ ] (if auth-related) Ran the [SKILL.md Phase 3 unhappy-path checklist](../SKILL.md)
- [ ] No new PII / hardcoded secrets / deployment IDs in the diff

## Companion repos

- [ ] This PR doesn't touch the protocol / design layer
- [ ] OR — companion change pending in: (link the PR or "will open")
