import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const storeInquiry = mutation({
  args: {
    name: v.string(),
    contact: v.string(),
    message: v.string(),
    dog: v.optional(v.string()),
    dates: v.optional(v.string()),
    service: v.optional(v.string()),
    lang: v.optional(v.string()),
    page_url: v.optional(v.string()),
    utm_source: v.optional(v.string()),
    utm_medium: v.optional(v.string()),
    utm_campaign: v.optional(v.string()),
    detectedLang: v.optional(v.string()),
    translatedMessage: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    inquiryId: v.optional(v.id("inquiries")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const trace = "msg_" + Date.now().toString(36);

    if (!args.name || !args.contact || !args.message) {
      return { ok: false, error: "missing_fields" };
    }

    const threadId =
      "thread_" +
      args.contact.replace(/\W/g, "").slice(0, 20) +
      "_" +
      Date.now().toString(36);

    const inquiryId = await ctx.db.insert("inquiries", {
      name: args.name.slice(0, 80),
      contact: args.contact.slice(0, 120),
      message: args.message.slice(0, 2000),
      dog: args.dog?.slice(0, 80) || "",
      dates: args.dates?.slice(0, 80) || "",
      service: args.service?.slice(0, 30) || "",
      lang: args.lang || "en",
      page_url: args.page_url?.slice(0, 400) || "",
      utm_source: args.utm_source ? args.utm_source.slice(0, 40) : undefined,
      utm_medium: args.utm_medium ? args.utm_medium.slice(0, 40) : undefined,
      utm_campaign: args.utm_campaign ? args.utm_campaign.slice(0, 60) : undefined,
      detectedLang: args.detectedLang ? args.detectedLang.slice(0, 8) : undefined,
      translatedMessage: args.translatedMessage ? args.translatedMessage.slice(0, 2500) : undefined,
      threadId,
      type: "inquiry",
      direction: "inbound",
      status: "new",
      timestamp: Date.now(),
      replied: false,
    });
    
    console.log(JSON.stringify({ trace, ev: "inquiry_stored", inquiryId, threadId }));
    
    return { ok: true, inquiryId };
  },
});
