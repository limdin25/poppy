// HOURLY roster email to every admin, on the hour.
//
// Hugo, 08 Aug 2026, twice in one day. First: "every day I want an email
// summary of all the accounts, 7am and 8pm." Then, after the audit found most
// creators had no link in their bio: "I wanna the reports every hour for now,
// with the accounts, the date joined, the time joined, the posts and the
// school URL and everything."
//
// Every run does a LIVE read of each connected creator's real Instagram, so
// the Skool column is what is actually on their page rather than what they
// told us. That is one API call per account, which is why maxDuration is 300.

import { NextResponse } from "next/server";
import { sendAccountsDigest } from "@/lib/data/accounts-digest";

// The live Instagram read walks every connected account one API call at a time,
// so this needs longer than the default as the roster grows.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    // The metrics capture used to live here, gated to 07:00 UK so it ran once a
    // day. It has moved to /api/cron/metrics and now runs every hour, because a
    // once-a-day sample cannot show what a video did in its first hours and the
    // "last 24 hours" column had nothing to subtract from. Keeping it out of
    // this route also means an email failure and a lost reading stay separate
    // problems: a reading missed is a hole nothing can fill in later.
    const result = await sendAccountsDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[accounts-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
