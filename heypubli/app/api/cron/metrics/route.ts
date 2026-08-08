// HOURLY readings: every creator's account numbers, and every recent video's own.
//
// Hugo, 08 Aug 2026: "why the ones that we posted already doesn't have the
// numbers of viewings etc in the last 24 hours."
//
// Because a "last 24 hours" figure is a SUBTRACTION, and until this ran there
// was only ever one reading to subtract from. Creator metrics were captured
// once a day at 07:00 UK, so the very first delta could not appear until the
// second morning, and per-video numbers were not captured at all.
//
// Hourly for both now. The reading is cheap next to what it buys: a video does
// most of its traffic in its first hours, and a once-a-day sample cannot show
// that at all. Nothing here is backfillable, so a missed hour is a permanent
// hole and the two captures are kept independent: one failing must not cost
// the other its reading.

import { NextResponse } from "next/server";
import { captureCreatorMetrics } from "@/lib/data/creator-stats";
import { capturePostMetrics } from "@/lib/data/post-metrics";

// Both sweeps walk their subjects one API call at a time and the post count
// only grows, so this needs the long ceiling.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  let creators: { captured: number; skipped: number } = { captured: 0, skipped: 0 };
  let posts = { read: 0, skipped: 0, urlsBackfilled: 0 };

  try {
    creators = await captureCreatorMetrics();
  } catch (err) {
    console.error("[cron/metrics] creator capture failed:", err);
  }

  try {
    posts = await capturePostMetrics();
  } catch (err) {
    console.error("[cron/metrics] post capture failed:", err);
  }

  return NextResponse.json({ ok: true, creators, posts });
}
