import { v } from "convex/values";
import { mutation } from "../_generated/server";

// Gallery photos live INSIDE siteContent.data.gallery (one row per lang).
// Photos are added to all 3 langs (shared gallery) so visitors on any locale
// see the same recent activity stream. Capped at 24 photos — older ones drop.

type GalleryEntry = {
  url: string;
  storageId: string;
  caption: string;
  ts: number;
};

type SiteData = {
  gallery?: GalleryEntry[];
  [key: string]: any;
};

export const addPhoto = mutation({
  args: {
    storageId: v.id("_storage"),
    caption: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    url: v.string(),
    storageId: v.string(),
  }),
  handler: async (ctx, args) => {
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) throw new Error("storage_not_found");

    const langs = ["en", "zh", "es"];
    for (const lang of langs) {
      const existing = await ctx.db
        .query("siteContent")
        .withIndex("by_lang", (q) => q.eq("lang", lang))
        .first();
      const data: SiteData = (existing?.data as SiteData) || {};
      const gallery = Array.isArray(data.gallery) ? [...data.gallery] : [];
      gallery.unshift({
        url,
        storageId: String(args.storageId),
        caption: args.caption || "",
        ts: Date.now(),
      });
      // Cap at 48 entries — older photos drop off (raised from 24 once mom started
      // uploading historical archive). Storage is cheap; mom can ✕-remove via UI.
      if (gallery.length > 48) gallery.length = 48;

      const newData: SiteData = { ...data, gallery };

      if (existing) {
        await ctx.db.patch(existing._id, { data: newData, updatedAt: Date.now() });
      } else {
        await ctx.db.insert("siteContent", {
          lang,
          data: newData,
          updatedAt: Date.now(),
          updatedBy: "gallery-add",
        });
      }
    }
    return { ok: true, url, storageId: String(args.storageId) };
  },
});

export const removePhoto = mutation({
  args: { storageId: v.string() },
  returns: v.object({ ok: v.boolean(), removedFromLangs: v.number() }),
  handler: async (ctx, args) => {
    const docs = await ctx.db.query("siteContent").collect();
    let removedFromLangs = 0;
    for (const doc of docs) {
      const data = (doc.data as SiteData) || {};
      const gallery = Array.isArray(data.gallery) ? data.gallery : [];
      const filtered = gallery.filter((p: GalleryEntry) => p.storageId !== args.storageId);
      if (filtered.length !== gallery.length) {
        await ctx.db.patch(doc._id, {
          data: { ...data, gallery: filtered },
          updatedAt: Date.now(),
        });
        removedFromLangs += 1;
      }
    }
    // Best-effort delete the actual storage blob (ignore failures — orphan storage is fine).
    try {
      await ctx.storage.delete(args.storageId as any);
    } catch (_) {
      // Storage may have been deleted already, or storageId wasn't a valid Convex storage ID.
    }
    return { ok: true, removedFromLangs };
  },
});
