// Twice-daily roster email to every admin, 07:00 and 20:00.
//
// Hugo, 08 Aug 2026: "every day I want an email summary of all the accounts,
// 7am and 8pm... you need to bake that in."
//
// Vercel crons run in UTC, so the schedule in vercel.json is 06:00 and 19:00
// UTC to land on 07:00 and 20:00 UK time. That drifts by an hour when the
// clocks change, which is a deliberate trade: a fixed UTC cron is honest about
// what it does, and the alternative is a job that fires twice or not at all on
// the changeover day.

import { NextResponse } from "next/server";
import { sendAccountsDigest } from "@/lib/data/accounts-digest";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    const result = await sendAccountsDigest();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[accounts-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
