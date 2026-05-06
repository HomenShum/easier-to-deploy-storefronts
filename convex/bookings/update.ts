import { v } from "convex/values";
import { mutation } from "../_generated/server";

// Patch booking fields (status, dates, price, deposit, notes). Returns the updated doc.
export const updateBooking = mutation({
  args: {
    bookingId: v.id("bookings"),
    status: v.optional(v.string()),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    notes: v.optional(v.string()),
    priceTotal: v.optional(v.number()),
    depositPaid: v.optional(v.boolean()),
    service: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.bookingId);
    if (!b) return { ok: false, error: "booking_not_found" };

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.status !== undefined) {
      if (!["confirmed", "tentative", "cancelled"].includes(args.status)) {
        return { ok: false, error: "invalid_status" };
      }
      patch.status = args.status;
    }
    if (args.startMs !== undefined) {
      if (!Number.isFinite(args.startMs)) return { ok: false, error: "invalid_start" };
      patch.startMs = args.startMs;
    }
    if (args.endMs !== undefined) {
      if (!Number.isFinite(args.endMs)) return { ok: false, error: "invalid_end" };
      patch.endMs = args.endMs;
    }
    const nextStart = patch.startMs ?? b.startMs;
    const nextEnd = patch.endMs ?? b.endMs;
    if ((nextEnd as number) < (nextStart as number)) {
      return { ok: false, error: "end_before_start" };
    }
    if (args.notes !== undefined) patch.notes = args.notes.slice(0, 500);
    if (args.priceTotal !== undefined) patch.priceTotal = args.priceTotal;
    if (args.depositPaid !== undefined) patch.depositPaid = args.depositPaid;
    if (args.service !== undefined) patch.service = args.service.slice(0, 30);

    await ctx.db.patch(args.bookingId, patch);
    console.log(
      JSON.stringify({ ev: "booking_updated", bookingId: args.bookingId, patch })
    );
    return { ok: true };
  },
});
