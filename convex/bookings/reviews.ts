import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

// Window = "stay ended between N days ago and yesterday, and we haven't asked yet".
// 3-day lookback tolerates missed cron runs; 1-day minimum avoids catching bookings
// that are still in progress.
const LOOKBACK_DAYS = 3;
const MIN_HOURS_AFTER_END = 20; // ~day after

function isEligibleBooking(b: any, now: number): boolean {
  if (b.status !== "confirmed") return false;
  if (b.reviewRequestedAt) return false;
  // Skip personal blocks — they're mom's own days off, not real customers.
  if (b.service === "off") return false;
  if (/^Personal /.test(b.customerName || "")) return false;
  const lookbackMs = LOOKBACK_DAYS * 86_400_000;
  const minElapsed = MIN_HOURS_AFTER_END * 3_600_000;
  return b.endMs < now - minElapsed && b.endMs >= now - lookbackMs;
}

// List bookings whose stay ended 20-72 hrs ago, confirmed, not yet asked.
export const fetchPendingReviewRequests = query({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    pending: v.array(v.any()),
    windowDays: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_endMs")
      .order("desc")
      .take(200);
    const pending = bookings.filter((b) => isEligibleBooking(b, now));
    return { ok: true, pending, windowDays: LOOKBACK_DAYS };
  },
});

// Idempotent — calling twice is a no-op after the first. Returns whether this
// call was the one that actually recorded the event (ok + changed).
export const markReviewRequested = mutation({
  args: {
    bookingId: v.id("bookings"),
    channel: v.string(), // "email" | "sms_queued" | "skipped" | "manual"
  },
  returns: v.object({
    ok: v.boolean(),
    changed: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!["email", "sms_queued", "skipped", "manual"].includes(args.channel)) {
      return { ok: false, changed: false, error: "invalid_channel" };
    }
    const b = await ctx.db.get(args.bookingId);
    if (!b) return { ok: false, changed: false, error: "booking_not_found" };
    if (b.reviewRequestedAt) return { ok: true, changed: false };
    await ctx.db.patch(args.bookingId, {
      reviewRequestedAt: Date.now(),
      reviewRequestChannel: args.channel,
      updatedAt: Date.now(),
    });
    return { ok: true, changed: true };
  },
});
