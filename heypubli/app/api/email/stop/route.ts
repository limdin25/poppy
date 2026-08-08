import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopToken } from "@/lib/data/email-follow-ups";

// One tap to stop the follow-up emails, no login and no form.
//
// Without it the only way out is marking us spam, and heypubli.com is the
// domain the Skool invite emails leave from: burning its reputation would stop
// the invites landing, which is the exact step most of these creators are stuck
// on. So the stop link is not a courtesy, it protects the funnel.
//
// The token is an HMAC of the profile id, so a guessed id cannot unsubscribe
// somebody else, and a leaked link only ever silences its own owner.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const profileId = url.searchParams.get("p") ?? "";
  const token = url.searchParams.get("t") ?? "";

  const page = (title: string, body: string) =>
    new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title>` +
        `<div style="font-family:sans-serif;max-width:520px;margin:14vh auto;padding:0 22px;color:#1A1A1A;line-height:1.55">` +
        `<h1 style="font-size:22px;margin:0 0 10px">${title}</h1><p style="color:#374151">${body}</p></div>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );

  if (!profileId || token !== stopToken(profileId)) {
    return page("That link did not work", "Reply to any of our emails and we will stop them by hand.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient().from("profiles") as any)
    .update({ email_follow_ups_stopped_at: new Date().toISOString() })
    .eq("id", profileId);
  if (error) {
    return page("Something went wrong", "Reply to any of our emails and we will stop them by hand.");
  }

  return page(
    "Done, no more emails",
    "You will not get another follow-up from us. If you want to pick your setup back up later it is still waiting at heypubli.com/onboarding, exactly where you left it.",
  );
}
