import { v } from "convex/values";
import { query } from "../_generated/server";

export const fetchInquiries = query({
  args: {
    filter: v.optional(v.string()), // 'all', 'new', 'replied'
    limit: v.optional(v.number()),
  },
  returns: v.object({
    ok: v.boolean(),
    inquiries: v.array(v.any()),
    stats: v.object({
      total: v.number(),
      unreplied: v.number(),
    }),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const filter = args.filter || "all";
    const limit = args.limit || 50;
    
    try {
      let inquiries;
      
      if (filter === "new") {
        inquiries = await ctx.db
          .query("inquiries")
          .withIndex("by_replied", (q) => q.eq("replied", false))
          .order("desc")
          .take(limit);
      } else if (filter === "replied") {
        inquiries = await ctx.db
          .query("inquiries")
          .withIndex("by_replied", (q) => q.eq("replied", true))
          .order("desc")
          .take(limit);
      } else {
        inquiries = await ctx.db
          .query("inquiries")
          .order("desc")
          .take(limit);
      }
      
      // Get stats
      const allInquiries = await ctx.db.query("inquiries").collect();
      const total = allInquiries.length;
      const unreplied = allInquiries.filter((i) => !i.replied).length;
      
      return {
        ok: true,
        inquiries,
        stats: { total, unreplied },
      };
    } catch (err: any) {
      return { ok: false, inquiries: [], stats: { total: 0, unreplied: 0 }, error: err.message };
    }
  },
});
