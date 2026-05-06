import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  inquiries: defineTable({
    // Core fields
    name: v.string(),
    contact: v.string(),
    message: v.string(),

    // Optional fields
    dog: v.optional(v.string()),
    dates: v.optional(v.string()),
    service: v.optional(v.string()),
    lang: v.optional(v.string()),
    page_url: v.optional(v.string()),

    // Attribution — which channel drove this inquiry.
    // Populated by the landing-page script from URL params (?utm_source=wechat ...).
    utm_source: v.optional(v.string()),
    utm_medium: v.optional(v.string()),
    utm_campaign: v.optional(v.string()),

    // Detected source language of the customer's original message (ISO 639-1: "es", "vi",
    // "tl", "ko", "ja", "hi", "ar", "en", "zh"). Populated by the /api/contact
    // translation step which auto-detects + translates to Chinese for mom in one call.
    // `lang` (above) is just the form's advisory hint; detectedLang is ground truth.
    detectedLang: v.optional(v.string()),
    translatedMessage: v.optional(v.string()), // ZH translation (for mom's review)

    // System fields
    threadId: v.string(),
    type: v.literal("inquiry"),
    direction: v.literal("inbound"),
    status: v.string(),
    timestamp: v.number(),
    replied: v.boolean(),
    repliedAt: v.optional(v.number()),
    replyMessage: v.optional(v.string()),        // What was SENT to the customer (possibly translated)
    replyMessageOriginal: v.optional(v.string()), // What mom typed (ZH) — preserved for audit/dual display
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_replied", ["replied"])
    .index("by_threadId", ["threadId"]),
    
  replies: defineTable({
    inquiryId: v.id("inquiries"),
    threadId: v.string(),
    message: v.string(),
    timestamp: v.number(),
    sentVia: v.optional(v.array(v.string())),
  })
    .index("by_inquiryId", ["inquiryId"])
    .index("by_threadId", ["threadId"]),

  // Bookings: authoritative confirmed/tentative stays.
  // Unlike inquiries (which are "someone asked"), a booking is "dog is actually
  // staying these dates" — the source of truth for the calendar + conflict check
  // + revenue tracking. Created by promoting an inquiry or manually.
  bookings: defineTable({
    // Optional link back to the originating inquiry (null for manually-created).
    inquiryId: v.optional(v.id("inquiries")),

    // Date range (UTC ms at start-of-day). endMs is the last day INCLUSIVE.
    startMs: v.number(),
    endMs: v.number(),

    // Customer / dog info (denormalized so booking survives inquiry deletion).
    customerName: v.string(),
    customerContact: v.string(),
    dogName: v.optional(v.string()),
    service: v.optional(v.string()), // boarding | daycare | walk | dropin

    // Lifecycle.
    status: v.string(), // "confirmed" | "tentative" | "cancelled"
    notes: v.optional(v.string()),

    // Money (optional — mom can fill later).
    priceTotal: v.optional(v.number()),
    depositPaid: v.optional(v.boolean()),

    // Provenance.
    createdFrom: v.string(), // "inquiry" | "manual"
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),

    // Post-stay review request tracking. When the Vercel cron fires a review
    // request (email or flags it for mom to send via SMS), we mark the timestamp
    // so we don't ask the same customer twice.
    reviewRequestedAt: v.optional(v.number()),
    reviewRequestChannel: v.optional(v.string()), // "email" | "sms_queued" | "skipped"
  })
    .index("by_startMs", ["startMs"])
    .index("by_status", ["status"])
    .index("by_inquiryId", ["inquiryId"])
    .index("by_endMs", ["endMs"]),

  // Site CMS — Squarespace-style content store. One row per language. Mom edits
  // in /inbox admin → public landing pages hydrate on load. `data` is a free-form
  // blob (no Convex schema enforcement) so adding new editable sections doesn't
  // require a migration. Frontend owns the shape.
  siteContent: defineTable({
    lang: v.string(), // "en" | "zh" | "es"
    data: v.any(),    // nested object: { hero, trust, host, why, how, pricing, faq, serviceArea, hours, contact, footer, ctaFinal }
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()), // "mom" | "homen" — for audit
  }).index("by_lang", ["lang"]),

  // adminAuth — passwordless email login.
  // Replaces the old "raw ADMIN_API_KEY pasted into URL as ?key=" pattern, which
  // gave permanent admin to anyone who got the URL. Now: mom enters her allowlisted
  // email → we mint a single-use `link` token → Resend emails her the URL → click
  // exchanges the link for a long-lived `session` token that lives in localStorage.
  //
  // Two doc kinds in one table (so we can sweep expired ones together):
  //   - kind="link"    — one-time, ~15 min TTL, consumed on /api/auth/verify hit
  //   - kind="session" — issued after link consumption, ~30 day TTL, deletable
  //
  // Tokens carry a prefix (`lnk_`/`ses_`) so server-side validation can early-reject
  // without a DB lookup, and so the legacy ADMIN_API_KEY path stays sync-fast.
  adminAuth: defineTable({
    kind: v.union(v.literal("link"), v.literal("session")),
    token: v.string(),       // `lnk_<hex>` or `ses_<hex>` — primary lookup key
    email: v.string(),       // allowlisted owner email (denormalized for audit)
    expiresAt: v.number(),   // ms epoch; reads check this and treat past as missing
    createdAt: v.number(),
    consumedAt: v.optional(v.number()), // for links: set when verified (single-use guard)
  })
    .index("by_token", ["token"])
    .index("by_expires", ["expiresAt"]),
});
