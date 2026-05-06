import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// Health check endpoint
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    return new Response(JSON.stringify({ ok: true, status: "healthy" }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Store inquiry endpoint
http.route({
  path: "/inquiries/store",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("inquiries/store:storeInquiry", body);
    return new Response(JSON.stringify({ ok: true, inquiryId: result.inquiryId }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Fetch inquiries endpoint
http.route({
  path: "/inquiries/fetch",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") || "all";
    const result = await ctx.runQuery("inquiries/fetch:fetchInquiries", { filter });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Reply to inquiry endpoint
http.route({
  path: "/inquiries/reply",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("inquiries/reply:markAsReplied", {
      inquiryId: body.inquiryId,
      replyMessage: body.replyMessage,
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============== BOOKINGS ==============

// Create a booking (manual or promoted from an inquiry).
http.route({
  path: "/bookings/create",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("bookings/store:createBooking", body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// List bookings with optional status/range filter.
// ?status=confirmed&rangeStartMs=...&rangeEndMs=...&limit=...
http.route({
  path: "/bookings/fetch",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const args: Record<string, unknown> = {};
    const status = url.searchParams.get("status");
    if (status) args.status = status;
    const rs = url.searchParams.get("rangeStartMs");
    if (rs) args.rangeStartMs = Number(rs);
    const re = url.searchParams.get("rangeEndMs");
    if (re) args.rangeEndMs = Number(re);
    const lim = url.searchParams.get("limit");
    if (lim) args.limit = Number(lim);
    const result = await ctx.runQuery("bookings/fetch:fetchBookings", args);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Patch a booking (status, dates, notes, etc).
http.route({
  path: "/bookings/update",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("bookings/update:updateBooking", body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Public view of a booking — used by /stay.html thank-you page. No auth
// because the URL IS the credential (like a Google Docs share link).
// Sensitive fields (contact, notes, price) are stripped by the query itself.
http.route({
  path: "/bookings/public",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return new Response(JSON.stringify({ ok: false, error: "missing_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const result = await ctx.runQuery("bookings/public:fetchPublicStay", { bookingId: id });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
  }),
});

// List bookings whose stays ended 20-72 hrs ago and haven't been asked for a review yet.
http.route({
  path: "/bookings/pending-reviews",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery("bookings/reviews:fetchPendingReviewRequests", {});
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Mark a booking as having been asked for a review (email sent / SMS queued / skipped).
http.route({
  path: "/bookings/mark-review-requested",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("bookings/reviews:markReviewRequested", body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============== SITE CMS ==============

// Public read — landing pages hydrate from this. ?lang=en|zh|es
http.route({
  path: "/site-content/get",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const lang = url.searchParams.get("lang") || "en";
    const result = await ctx.runQuery("siteContent/store:getByLang", { lang });
    return new Response(JSON.stringify(result || { lang, data: null }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  }),
});

// Admin write — auth happens at the Vercel /api/site-content layer
http.route({
  path: "/site-content/upsert",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation("siteContent/store:upsert", body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============== ADMIN ==============

// Wipe QA / E2E / production-test fixtures. Default is dry-run; pass {"dryRun": false} to commit.
http.route({
  path: "/admin/cleanup-test-fixtures",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json().catch(() => ({}));
    const result = await ctx.runMutation("admin/cleanup:wipeTestFixtures", body || {});
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ============== GALLERY (admin-auth required) ==============

function checkGalleryAuth(request: Request): boolean {
  const sent = (request.headers.get("x-api-key") || "").trim();
  const valid = (process.env.ADMIN_API_KEY || "").trim();
  return valid.length > 0 && sent.length > 0 && sent === valid;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// Generate a short-lived upload URL — client PUTs file directly to it.
http.route({
  path: "/gallery/upload-url",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const url = await ctx.storage.generateUploadUrl();
    return new Response(JSON.stringify({ ok: true, uploadUrl: url }), {
      headers: JSON_HEADERS,
    });
  }),
});

// Commit an uploaded photo into the gallery (after client uploads + gets storageId).
http.route({
  path: "/gallery/add",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.storageId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_storageId" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation("gallery/store:addPhoto", {
      storageId: body.storageId,
      caption: body.caption,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

// Remove a photo from gallery + delete underlying storage blob.
http.route({
  path: "/gallery/remove",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.storageId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_storageId" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation("gallery/store:removePhoto", {
      storageId: body.storageId,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

// ============== ADMIN AUTH (passwordless email login) ==============
// All four routes are admin-key-gated because Vercel is the only legitimate
// caller — the actual user-facing tokens (lnk_, ses_) live in the request body,
// not in the x-api-key header. Gating with the platform key keeps random
// internet probes from hammering the auth surface.

http.route({
  path: "/admin-auth/create-link",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.email || typeof body.email !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "missing_email" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation(internal["admin/auth"].createLink, {
      email: body.email,
    });
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/consume-link",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.token || typeof body.token !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "missing_token" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation(internal["admin/auth"].consumeLink, {
      token: body.token,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/validate-session",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.token || typeof body.token !== "string") {
      return new Response(JSON.stringify({ ok: false }), { headers: JSON_HEADERS });
    }
    const result = await ctx.runQuery(internal["admin/auth"].validateSession, {
      token: body.token,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/revoke-session",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.token || typeof body.token !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "missing_token" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation(internal["admin/auth"].revokeSession, {
      token: body.token,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/revoke-session-by-id",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.sessionId || !body.scopeEmail) {
      return new Response(JSON.stringify({ ok: false, error: "missing_fields" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation(internal["admin/auth"].revokeSessionById, {
      sessionId: body.sessionId,
      scopeEmail: body.scopeEmail,
    });
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/list-sessions",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    const result = await ctx.runQuery(internal["admin/auth"].listSessions, {
      email: typeof body.email === "string" ? body.email : undefined,
    });
    return new Response(JSON.stringify({ ok: true, sessions: result }), { headers: JSON_HEADERS });
  }),
});

http.route({
  path: "/admin-auth/revoke-all",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!checkGalleryAuth(request)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }
    const body = await request.json().catch(() => ({}));
    if (!body.email || typeof body.email !== "string") {
      return new Response(JSON.stringify({ ok: false, error: "missing_email" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
    const result = await ctx.runMutation(internal["admin/auth"].revokeAllForEmail, {
      email: body.email,
    });
    return new Response(JSON.stringify({ ok: true, ...result }), { headers: JSON_HEADERS });
  }),
});

// Convex expects the router to be the default export of convex/http.ts
export default http;
