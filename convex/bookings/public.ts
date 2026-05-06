import { v } from "convex/values";
import { query } from "../_generated/server";

// Public-safe view of a booking for the shareable thank-you page.
// Strips: contact info, notes, price, deposit state, customer last name, internal ids.
// Returns: first-name only, dog name, dates, service.
//
// Cancelled bookings return ok=false so a cancelled booking's old URL dies gracefully.
// Personal blocks also return ok=false — those aren't customer stays.
export const fetchPublicStay = query({
  args: {
    bookingId: v.id("bookings"),
  },
  returns: v.object({
    ok: v.boolean(),
    stay: v.optional(
      v.object({
        firstName: v.string(),
        dogName: v.string(),
        startMs: v.number(),
        endMs: v.number(),
        service: v.string(),
        status: v.string(),
      })
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.bookingId);
    if (!b) return { ok: false, error: "not_found" };
    if (b.status === "cancelled") return { ok: false, error: "cancelled" };
    if (b.service === "off") return { ok: false, error: "private" };
    if (/^Personal /.test(b.customerName || "")) return { ok: false, error: "private" };

    const firstName = (b.customerName || "").split(/\s+/)[0] || "friend";
    const dogName = (b.dogName || "").split(/[,，]/)[0] || "your dog";

    return {
      ok: true,
      stay: {
        firstName,
        dogName,
        startMs: b.startMs,
        endMs: b.endMs,
        service: b.service || "stay",
        status: b.status,
      },
    };
  },
});
