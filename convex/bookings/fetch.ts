import { v } from "convex/values";
import { query } from "../_generated/server";

// Fetch bookings, optionally filtered by status and/or overlapping a range.
// Overlap rule: booking.startMs <= range.endMs AND booking.endMs >= range.startMs.
export const fetchBookings = query({
  args: {
    status: v.optional(v.string()), // "all" | "confirmed" | "tentative" | "cancelled"
    rangeStartMs: v.optional(v.number()),
    rangeEndMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    bookings: v.array(v.any()),
    stats: v.object({
      total: v.number(),
      confirmed: v.number(),
      tentative: v.number(),
      cancelled: v.number(),
    }),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit || 500, 1000);
    try {
      // Start from the startMs index so we can bound by range cheaply.
      let rows;
      if (args.rangeStartMs != null && args.rangeEndMs != null) {
        // Candidate window: any booking whose startMs is before range end.
        // We then filter for endMs >= rangeStartMs in-memory.
        rows = await ctx.db
          .query("bookings")
          .withIndex("by_startMs", (q) => q.lte("startMs", args.rangeEndMs!))
          .order("desc")
          .take(limit);
        rows = rows.filter((b) => b.endMs >= args.rangeStartMs!);
      } else if (args.status && args.status !== "all") {
        rows = await ctx.db
          .query("bookings")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(limit);
      } else {
        rows = await ctx.db
          .query("bookings")
          .withIndex("by_startMs")
          .order("desc")
          .take(limit);
      }

      if (args.status && args.status !== "all") {
        rows = rows.filter((b) => b.status === args.status);
      }

      // Stats across all bookings (small table, fine to scan).
      const all = await ctx.db.query("bookings").take(1000);
      const stats = {
        total: all.length,
        confirmed: all.filter((b) => b.status === "confirmed").length,
        tentative: all.filter((b) => b.status === "tentative").length,
        cancelled: all.filter((b) => b.status === "cancelled").length,
      };

      return { ok: true, bookings: rows, stats };
    } catch (err: any) {
      return {
        ok: false,
        bookings: [],
        stats: { total: 0, confirmed: 0, tentative: 0, cancelled: 0 },
        error: err.message,
      };
    }
  },
});
