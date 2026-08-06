import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { markPostPublished, markPostFailed } from "@/lib/data/posts";

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Fail closed: never accept an unsigned/unverified webhook.
  const signingSecret = process.env.OUTSTAND_WEBHOOK_SECRET;
  if (!signingSecret) {
    console.error("[outstand-webhook] OUTSTAND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  const raw = request.headers.get("x-outstand-signature") ?? "";
  const signature = raw.startsWith("sha256=") ? raw.slice(7) : raw;
  const expected = crypto
    .createHmac("sha256", signingSecret)
    .update(rawBody)
    .digest("hex");

  if (
    !signature ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = payload.event as string;

  switch (event) {
    case "post.published":
      await handlePostPublished(payload.data);
      break;
    case "post.error":
      await handlePostError(payload.data);
      break;
    case "account.token_expired":
      await handleTokenExpired(payload.data);
      break;
    default:
      console.log("[outstand-webhook] unhandled event:", event);
  }

  return NextResponse.json({ received: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePostPublished(data: any) {
  const postId = data?.postId || data?.id;
  if (!postId) return;

  const supabase = createAdminClient();
  const { data: post } = await supabase
    .from("scheduled_posts")
    .select("id")
    .eq("outstand_post_id", postId)
    .eq("status", "pending")
    .single();

  if (post) {
    const platformPostId = data?.socialAccounts?.[0]?.platformPostId || postId;
    await markPostPublished((post as { id: string }).id, platformPostId);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePostError(data: any) {
  const postId = data?.postId || data?.id;
  if (!postId) return;

  const supabase = createAdminClient();
  const { data: post } = await supabase
    .from("scheduled_posts")
    .select("id")
    .eq("outstand_post_id", postId)
    .eq("status", "pending")
    .single();

  if (post) {
    const error =
      data?.error || data?.socialAccounts?.[0]?.error || "Outstand publish error";
    await markPostFailed((post as { id: string }).id, error);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleTokenExpired(data: any) {
  const socialAccountId = data?.socialAccountId || data?.id;
  if (!socialAccountId) return;

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from("outstand_connections") as any)
    .update({ is_connected: false })
    .eq("outstand_social_account_id", socialAccountId);
}
