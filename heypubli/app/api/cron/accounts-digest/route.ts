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
import { captureCreatorMetrics } from "@/lib/data/creator-stats";

// Capturing metrics walks every connected account one API call at a time, so
// this needs longer than the default as the roster grows.
export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    // Capture BEFORE the email, so a Resend problem cannot cost us a reading.
    // A missed reading is permanent: growth is the gap between two of them and
    // there is no way to ask Instagram what a number was yesterday.
    //
    // Hourly now, so the daily snapshot is taken ONCE a day (at 07:00 UK) and
    // the other 23 runs skip it: a growth series with 24 points a day is not
    // more truthful, it just costs 24 times the API calls.
    let metrics: { captured: number; skipped: number } = { captured: 0, skipped: 0 };
    const ukHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    );
    if (ukHour === 7) {
      try {
        metrics = await captureCreatorMetrics();
      } catch (err) {
        console.error("[accounts-digest] metrics capture failed:", err);
      }
    }
    const result = await sendAccountsDigest();
    return NextResponse.json({ ok: true, ...result, metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[accounts-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
