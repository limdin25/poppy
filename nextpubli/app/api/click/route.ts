import { NextResponse } from "next/server";
import crypto from "crypto";
import { isValidReferralTag } from "@/lib/referral";
import { resolveTag, logClick } from "@/lib/data/clicks";

// Public endpoint. The ScanPlates site pings this (GET pixel or POST beacon) with the
// influencer's `sck` tag when someone opens their share link, so we can count clicks.
// Not under the auth middleware matcher, so anonymous traffic reaches it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT_UA =
  /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|headless|monitor|curl|wget/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// 1×1 transparent GIF.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function hashIp(request: Request): string | null {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT ?? "nextpubli";
  return crypto
    .createHash("sha256")
    .update(ip + salt)
    .digest("hex")
    .slice(0, 32);
}

async function readTag(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("sck");
  if (fromQuery) return fromQuery.trim().toLowerCase();

  if (request.method === "POST") {
    const text = await request.text().catch(() => "");
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (json?.sck) return String(json.sck).trim().toLowerCase();
    } catch {
      const v = new URLSearchParams(text).get("sck");
      if (v) return v.trim().toLowerCase();
    }
  }
  return null;
}

async function track(request: Request): Promise<void> {
  const tag = await readTag(request);
  if (!tag || !isValidReferralTag(tag)) return;

  const resolved = await resolveTag(tag);
  if (!resolved) return;

  const userAgent = request.headers.get("user-agent");
  await logClick({
    profileId: resolved.profileId,
    brandId: resolved.brandId,
    referralTag: tag,
    referer: request.headers.get("referer"),
    userAgent,
    ipHash: hashIp(request),
    isBot: userAgent ? BOT_UA.test(userAgent) : false,
  }).catch((err) => console.error("[click-api] logClick failed:", err));
}

export async function GET(request: Request): Promise<Response> {
  await track(request).catch((err) => console.error("[click-api] track failed:", err));
  return new Response(new Uint8Array(PIXEL), {
    status: 200,
    headers: { ...CORS, "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  await track(request).catch((err) => console.error("[click-api] track failed:", err));
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function OPTIONS(): Response {
  return new NextResponse(null, { status: 204, headers: CORS });
}
