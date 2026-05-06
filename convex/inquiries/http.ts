import { v } from "convex/values";
import { httpAction } from "../_generated/server";
import { api } from "../_generated/api";

// HTTP action for Vercel serverless functions to call Convex
export const storeInquiryHttp = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }
  
  const body = await request.json();
  const result = await ctx.runMutation(api.inquiries.store.storeInquiry, body);
  
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
});

export const fetchInquiriesHttp = httpAction(async (ctx, request) => {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }
  
  // Auth handled by Vercel layer
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "all";
  
  const result = await ctx.runQuery(api.inquiries.fetch.fetchInquiries, { filter });
  
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});

export const replyInquiryHttp = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }
  
  // Auth handled by Vercel layer
  const body = await request.json();
  const result = await ctx.runMutation(api.inquiries.reply.markAsReplied, {
    inquiryId: body.inquiryId,
    replyMessage: body.message,
  });
  
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
});
