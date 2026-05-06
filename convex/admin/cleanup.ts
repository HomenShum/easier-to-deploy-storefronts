import { v } from "convex/values";
import { mutation } from "../_generated/server";

// Wipe QA / E2E / production-test fixtures from inquiries + bookings + replies.
// Deliberately does NOT expose a wildcard match — only fixed-prefix patterns that
// our own test code emits. Never matches real customer names.
//
// Usage:
//   dry-run first:  POST /admin/cleanup-test-fixtures  body={"dryRun": true}
//   then commit:    POST /admin/cleanup-test-fixtures  body={"dryRun": false}

const TEST_NAME_PATTERNS: RegExp[] = [
  /^QA[- ]/, // QA-ics-solo, QA SMS Tester, QA-conflict-1, etc.
  /^QA中文$/,
  /^E2E /, // E2E fixtures
  /^E2E moc/i,
  /^Contact moc/i,
  /^Production Test$/i,
  /^Test /i,
  /^spambot$/i, // honeypot-tripped submissions
  /^Eval Test$/i, // /api/eval/run scenario fixtures
  /^Customer moc/i, // load-test contact-form payloads
  /^SDK moc/i, // SDK probe payloads
  /^[A-Z]moc[a-z0-9]+$/i, // single-letter + moc + alphanumeric (Vmoc..., Pmoc..., Zmoc..., Dmoc...)
];

// Test contact patterns — domains that are RFC reserved for testing or our own probe paths.
// NEVER match a real customer email (gmail/yahoo/hotmail/etc).
const TEST_CONTACT_PATTERNS: RegExp[] = [
  /@example\.com$/i, // RFC 2606 reserved
  /@example\.org$/i,
  /@example\.net$/i,
  /@test\.com$/i, // common test domain (eval@test.com)
  /^eval@/i, // any eval@... contact
  /^cust-moc[a-z0-9]+@/i, // load-test customers
  /^sdk-moc[a-z0-9]+@/i,
  /^[a-z]moc[a-z0-9]+@/i, // matches Vmoc..., Pmoc... contact addresses
];

function isTestName(name: string | undefined): boolean {
  if (!name) return false;
  return TEST_NAME_PATTERNS.some((p) => p.test(name));
}

function isTestContact(contact: string | undefined): boolean {
  if (!contact) return false;
  return TEST_CONTACT_PATTERNS.some((p) => p.test(contact));
}

export const wipeTestFixtures = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    dryRun: v.boolean(),
    inquiriesMatched: v.number(),
    inquiriesDeleted: v.number(),
    bookingsDeleted: v.number(),
    repliesDeleted: v.number(),
    orphanBookingsDeleted: v.number(),
    sampleNames: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun !== false; // default to dry-run unless explicitly false
    let inqDel = 0;
    let bookDel = 0;
    let repDel = 0;
    let orphanBookDel = 0;
    const sampleNames: string[] = [];

    // 1. Find matching inquiries (bounded take — ok for this small table).
    // Match by name OR by contact-pattern (RFC test domains, eval@, load-test prefixes).
    const inquiries = await ctx.db.query("inquiries").take(1000);
    const testInquiries = inquiries.filter(
      (i) => isTestName(i.name) || isTestContact(i.contact)
    );

    for (const inq of testInquiries) {
      if (sampleNames.length < 12) sampleNames.push(inq.name);

      // 1a. Delete linked replies (by_inquiryId index).
      const replies = await ctx.db
        .query("replies")
        .withIndex("by_inquiryId", (q) => q.eq("inquiryId", inq._id))
        .take(200);
      for (const r of replies) {
        if (!dryRun) await ctx.db.delete(r._id);
        repDel += 1;
      }

      // 1b. Delete bookings that reference this inquiry.
      const linkedBookings = await ctx.db
        .query("bookings")
        .withIndex("by_inquiryId", (q) => q.eq("inquiryId", inq._id))
        .take(200);
      for (const b of linkedBookings) {
        if (!dryRun) await ctx.db.delete(b._id);
        bookDel += 1;
      }

      // 1c. Delete the inquiry.
      if (!dryRun) await ctx.db.delete(inq._id);
      inqDel += 1;
    }

    // 2. Orphaned test bookings (customerName matches but no inquiry).
    const allBookings = await ctx.db.query("bookings").take(1000);
    for (const b of allBookings) {
      if (!isTestName(b.customerName)) continue;
      // Skip ones we already counted above via inquiry linkage.
      if (b.inquiryId && testInquiries.some((i) => i._id === b.inquiryId)) continue;
      if (!dryRun) await ctx.db.delete(b._id);
      orphanBookDel += 1;
    }

    console.log(
      JSON.stringify({
        ev: "cleanup_test_fixtures",
        dryRun,
        inqDel,
        bookDel,
        repDel,
        orphanBookDel,
      })
    );

    return {
      ok: true,
      dryRun,
      inquiriesMatched: testInquiries.length,
      inquiriesDeleted: inqDel,
      bookingsDeleted: bookDel,
      repliesDeleted: repDel,
      orphanBookingsDeleted: orphanBookDel,
      sampleNames,
    };
  },
});
