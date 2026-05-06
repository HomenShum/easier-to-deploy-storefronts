import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

// Passwordless email login state machine.
//
// Flow:
//   1. Vercel `/api/auth/request-link` calls createLink → returns lnk_<hex>
//   2. Resend emails mom https://.../api/auth/verify?token=lnk_<hex>
//   3. Vercel `/api/auth/verify` calls consumeLink → returns ses_<hex> (long-lived)
//   4. Frontend stashes ses_<hex> in localStorage["pawpaw_inbox_key"] (same slot
//      the legacy raw-admin-key used to occupy)
//   5. All admin endpoints in api/* call validateSession to gate writes
//
// Why both kinds in one table: lets a single sweepExpired pass clean both up,
// and makes audit ("who was logged in last week") a single .collect() away.

const LINK_TTL_MS = 15 * 60 * 1000;            // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function genToken(prefix: "lnk" | "ses"): string {
  // 32 random bytes → 64 hex chars. crypto.getRandomValues is available in the
  // Convex V8 runtime. Don't use Math.random — predictable, not safe for tokens.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

// createLink — issue a single-use magic-link token for an allowlisted email.
// Allowlist enforcement happens UPSTREAM (in api/auth/request-link.js) using the
// ADMIN_EMAIL_ALLOWLIST env var. This mutation trusts its caller; only the
// admin-key-gated HTTP route in convex/http.ts can invoke it.
export const createLink = internalMutation({
  args: { email: v.string() },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const token = genToken("lnk");
    const now = Date.now();
    const expiresAt = now + LINK_TTL_MS;
    await ctx.db.insert("adminAuth", {
      kind: "link",
      token,
      email: args.email,
      expiresAt,
      createdAt: now,
    });
    return { token, expiresAt };
  },
});

// consumeLink — exchange a valid lnk_ token for a fresh ses_ session token.
// Idempotent-resistant: marks the link `consumedAt` so a second click fails.
// Returns { ok: false } on any failure path so the Vercel route can return a
// uniform 401 without leaking whether the token was unknown vs. expired vs. used.
export const consumeLink = internalMutation({
  args: { token: v.string() },
  returns: v.object({
    ok: v.boolean(),
    sessionToken: v.optional(v.string()),
    email: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!args.token.startsWith("lnk_")) return { ok: false, reason: "wrong_prefix" };
    const row = await ctx.db
      .query("adminAuth")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row || row.kind !== "link") return { ok: false, reason: "not_found" };
    const now = Date.now();
    if (row.consumedAt) return { ok: false, reason: "already_used" };
    if (row.expiresAt < now) return { ok: false, reason: "expired" };
    // Mark the link consumed BEFORE inserting the session so a concurrent click
    // can't double-mint. Convex mutations are serialized per-document, so this
    // patch + a parallel patch on the same doc race deterministically.
    await ctx.db.patch(row._id, { consumedAt: now });
    const sessionToken = genToken("ses");
    await ctx.db.insert("adminAuth", {
      kind: "session",
      token: sessionToken,
      email: row.email,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });
    return { ok: true, sessionToken, email: row.email };
  },
});

// validateSession — called on every admin write to gate access. Returns ok:true
// only if the token exists, kind=session, and not expired. Treat any other
// outcome as unauthorized. Cheap: indexed lookup, no scans.
export const validateSession = internalQuery({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean(), email: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    if (!args.token.startsWith("ses_")) return { ok: false };
    const row = await ctx.db
      .query("adminAuth")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row || row.kind !== "session") return { ok: false };
    if (row.expiresAt < Date.now()) return { ok: false };
    return { ok: true, email: row.email };
  },
});

// revokeSession — explicit logout. Idempotent (returns ok=true even if the
// token is unknown so the client UX stays simple).
export const revokeSession = internalMutation({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("adminAuth")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (row && row.kind === "session") {
      await ctx.db.delete(row._id);
    }
    return { ok: true };
  },
});

// revokeSessionById — revoke one session by its Convex _id. Email scope is
// passed in and verified server-side, so a caller can never delete a session
// outside their own scope (even if they guess an _id). Used by the /inbox
// "logged-in devices" UI: listSessions returns rows with _id, the user clicks
// "✕" on a row, and we round-trip _id back here.
export const revokeSessionById = internalMutation({
  args: { sessionId: v.id("adminAuth"), scopeEmail: v.string() },
  returns: v.object({ ok: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!row || row.kind !== "session") return { ok: false, reason: "not_found" };
    if (row.email !== args.scopeEmail) return { ok: false, reason: "out_of_scope" };
    await ctx.db.delete(row._id);
    return { ok: true };
  },
});

// listSessions — return active sessions for one email (or all, if not specified).
// Used by the /inbox account panel so mom can audit "what devices are signed in
// as me." Returns a sanitized projection — never the raw token (the holder
// already has it, and any audit UI only needs an opaque id-suffix to disambiguate).
export const listSessions = internalQuery({
  args: { email: v.optional(v.string()) },
  returns: v.array(
    v.object({
      _id: v.id("adminAuth"),
      email: v.string(),
      createdAt: v.number(),
      expiresAt: v.number(),
      tokenSuffix: v.string(), // last 6 hex chars only — enough to disambiguate
    }),
  ),
  handler: async (ctx, args) => {
    // Walk by_expires for active sessions, then filter by email + kind in JS.
    // Cap at 200 — even if mom logs in from many devices, we only show the most
    // recent slice; revoke-all is the answer to "too many to manage."
    const now = Date.now();
    const rows = await ctx.db
      .query("adminAuth")
      .withIndex("by_expires", (q) => q.gt("expiresAt", now))
      .take(200);
    return rows
      .filter((r) => r.kind === "session" && (!args.email || r.email === args.email))
      .map((r) => ({
        _id: r._id,
        email: r.email,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        tokenSuffix: r.token.slice(-6),
      }));
  },
});

// revokeAllForEmail — nuclear "sign out everywhere" for one email. Deletes every
// active session AND every unconsumed link for that email. Deliberately scoped
// per-email so a future multi-admin world doesn't accidentally lock everyone out.
export const revokeAllForEmail = internalMutation({
  args: { email: v.string() },
  returns: v.object({ deletedSessions: v.number(), deletedLinks: v.number() }),
  handler: async (ctx, args) => {
    // Walk all rows for this email — there will only be a handful, no index needed.
    // (If admin count ever grows we can add a by_email index; not worth it today.)
    const all = await ctx.db.query("adminAuth").collect();
    let deletedSessions = 0;
    let deletedLinks = 0;
    for (const row of all) {
      if (row.email !== args.email) continue;
      await ctx.db.delete(row._id);
      if (row.kind === "session") deletedSessions += 1;
      else deletedLinks += 1;
    }
    return { deletedSessions, deletedLinks };
  },
});

// sweepExpired — opportunistic cleanup. Called from the existing cleanup cron
// (or one-off via HTTP). Expired/consumed links + expired sessions disappear.
// Capped at 200 deletions per call to stay inside the mutation transaction
// budget; cron re-fires until clean.
export const sweepExpired = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("adminAuth")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(200);
    let deleted = 0;
    for (const row of stale) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    return { deleted };
  },
});
