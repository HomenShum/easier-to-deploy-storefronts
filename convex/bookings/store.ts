import { v } from "convex/values";
import { mutation } from "../_generated/server";

// Create a booking. Either pass `inquiryId` to promote an inquiry, or pass
// `customerName`/`customerContact` directly for a manual booking.
export const createBooking = mutation({
  args: {
    inquiryId: v.optional(v.id("inquiries")),
    startMs: v.number(),
    endMs: v.number(),
    customerName: v.optional(v.string()), // required if no inquiryId
    customerContact: v.optional(v.string()),
    dogName: v.optional(v.string()),
    service: v.optional(v.string()),
    status: v.optional(v.string()), // default "confirmed"
    notes: v.optional(v.string()),
    priceTotal: v.optional(v.number()),
    depositPaid: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    bookingId: v.optional(v.id("bookings")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.startMs) || !Number.isFinite(args.endMs)) {
      return { ok: false, error: "invalid_dates" };
    }
    if (args.endMs < args.startMs) {
      return { ok: false, error: "end_before_start" };
    }

    // Resolve customer fields either from inquiryId or directly.
    let customerName = args.customerName || "";
    let customerContact = args.customerContact || "";
    let dogName = args.dogName;
    let service = args.service;
    let createdFrom: "inquiry" | "manual" = "manual";

    if (args.inquiryId) {
      const inq = await ctx.db.get(args.inquiryId);
      if (!inq) return { ok: false, error: "inquiry_not_found" };
      customerName = customerName || inq.name;
      customerContact = customerContact || inq.contact;
      dogName = dogName || inq.dog;
      service = service || inq.service;
      createdFrom = "inquiry";
    }

    if (!customerName || !customerContact) {
      return { ok: false, error: "missing_customer_fields" };
    }

    const status = args.status || "confirmed";
    if (!["confirmed", "tentative", "cancelled"].includes(status)) {
      return { ok: false, error: "invalid_status" };
    }

    const bookingId = await ctx.db.insert("bookings", {
      inquiryId: args.inquiryId,
      startMs: args.startMs,
      endMs: args.endMs,
      customerName: customerName.slice(0, 80),
      customerContact: customerContact.slice(0, 120),
      dogName: dogName ? dogName.slice(0, 80) : undefined,
      service: service ? service.slice(0, 30) : undefined,
      status,
      notes: args.notes ? args.notes.slice(0, 500) : undefined,
      priceTotal: args.priceTotal,
      depositPaid: args.depositPaid,
      createdFrom,
      createdAt: Date.now(),
    });

    console.log(
      JSON.stringify({
        ev: "booking_created",
        bookingId,
        inquiryId: args.inquiryId || null,
        startMs: args.startMs,
        endMs: args.endMs,
        status,
      })
    );

    return { ok: true, bookingId };
  },
});
