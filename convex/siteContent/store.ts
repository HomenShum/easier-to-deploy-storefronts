import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

// Get content for one language. Returns null if no row exists yet.
export const getByLang = query({
  args: { lang: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("siteContent"),
      _creationTime: v.number(),
      lang: v.string(),
      data: v.any(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("siteContent")
      .withIndex("by_lang", (q) => q.eq("lang", args.lang))
      .first();
    return row ?? null;
  },
});

// Get all 3 languages at once — used by the admin editor.
export const getAll = query({
  args: {},
  returns: v.object({
    en: v.union(v.any(), v.null()),
    zh: v.union(v.any(), v.null()),
    es: v.union(v.any(), v.null()),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("siteContent").take(10);
    const byLang: Record<string, any> = {};
    for (const r of rows) byLang[r.lang] = r.data;
    return { en: byLang.en ?? null, zh: byLang.zh ?? null, es: byLang.es ?? null };
  },
});

// Upsert one language's content. Caller (Vercel /api/site-content) is responsible
// for admin-key auth — Convex side accepts whatever. Validates the lang code.
export const upsert = mutation({
  args: {
    lang: v.string(),
    data: v.any(),
    updatedBy: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    if (!["en", "zh", "es"].includes(args.lang)) {
      return { ok: false, error: "invalid_lang" };
    }
    const existing = await ctx.db
      .query("siteContent")
      .withIndex("by_lang", (q) => q.eq("lang", args.lang))
      .first();
    const patch = {
      lang: args.lang,
      data: args.data,
      updatedAt: Date.now(),
      updatedBy: args.updatedBy,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("siteContent", patch);
    }
    return { ok: true };
  },
});
