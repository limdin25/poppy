import { NextResponse } from "next/server";
import { isValidReferralTag } from "@/lib/referral";
import { resolveTag } from "@/lib/data/clicks";

// Public endpoint: does this referral tag belong to a real influencer?
// The ScanPlates onboarding calls it when a buyer types a creator code by hand,
// so typos get flagged before the purchase instead of silently losing the
// attribution. Read-only, no side effects — clicks are counted by /api/click.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("tag") ?? "";
  const tag = raw.trim().toLowerCase();

  if (!isValidReferralTag(tag)) {
    return NextResponse.json({ valid: false }, { headers: CORS });
  }

  const resolved = await resolveTag(tag);
  return NextResponse.json({ valid: resolved !== null }, { headers: CORS });
}
