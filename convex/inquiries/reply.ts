import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const markAsReplied = mutation({
  args: {
    inquiryId: v.id("inquiries"),
    replyMessage: v.string(),
    replyMessageOriginal: v.optional(v.string()), // mom's ZH source, when reply was translated
  },
  returns: v.object({
    ok: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      const inquiry = await ctx.db.get(args.inquiryId);
      if (!inquiry) {
        return { ok: false, error: "inquiry_not_found" };
      }

      // Allow up to 4000 chars — we stash both outbound + original ZH here, split
      // by a delimiter, because optional fields silently drop on the Vercel→Convex
      // SDK path (documented in HANDOFF.md).
      const patch: Record<string, unknown> = {
        replied: true,
        repliedAt: Date.now(),
        replyMessage: args.replyMessage.slice(0, 4000),
        status: "replied",
      };
      if (args.replyMessageOriginal && args.replyMessageOriginal !== args.replyMessage) {
        patch.replyMessageOriginal = args.replyMessageOriginal.slice(0, 2000);
      }

      await ctx.db.patch(args.inquiryId, patch);

      // Store the reply audit trail
      await ctx.db.insert("replies", {
        inquiryId: args.inquiryId,
        threadId: inquiry.threadId,
        message: args.replyMessage,
        timestamp: Date.now(),
        sentVia: ["web"],
      });

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
});

export const getInquiry = query({
  args: {
    inquiryId: v.id("inquiries"),
  },
  returns: v.optional(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.inquiryId);
  },
});
