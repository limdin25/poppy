import { NextResponse } from "next/server";
import { runReplyBrain } from "@/lib/data/reply-runner";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelSettings } from "@/types/database";

export const maxDuration = 300;

// The reply brain's heartbeat, every minute. ?dry=1 runs the full decision pass on the
// real inbox and returns what WOULD be sent, writing nothing and sending nothing: that
// is how a change to the brain is inspected against live conversations before it runs.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("funnel_settings")
    .select("*")
    .eq("id", "default")
    .single<FunnelSettings>();
  if (!settings) {
    return NextResponse.json({ error: "no funnel_settings row" }, { status: 500 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  const report = await runReplyBrain(admin, settings, { dry });
  // Heartbeat: proves this cron RAN, not that it was configured. Read by the
  // monitor and by Elsie's dead man's switch, which lives on a different Vercel
  // project precisely because a dead cron system takes the local watchdog with it.
  if (!dry) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("funnel_monitor_state") as any)
      .update({ reply_last_ok_at: new Date().toISOString() })
      .eq("id", "default");
  }
  return NextResponse.json({ ok: true, dry, ...report });
}
