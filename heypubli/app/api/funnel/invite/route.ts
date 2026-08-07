import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteLeadByEmail } from "@/lib/data/skool-invite-dispatch";

/**
 * Send somebody their community invite before they ask for it.
 *
 * Hugo, 07 Aug 2026: "the invites should be sent first thing regardless. When
 * you send the link for them to watch, already send the invite, so they do not
 * have to wait and ask you for the invite."
 *
 * Until now an invite only existed after a creator signed up, connected
 * Instagram, reached step 2 and pressed a button. Edelyn did all of that and
 * then spent an hour asking where her email was. The invite costs nothing, does
 * not expire and is idempotent, so there is no reason it cannot already be
 * sitting in their inbox when they get there.
 *
 * Same shared secret as the cron, because this sends real email to a real
 * address and nothing else about the caller is checked.
 *
 *   curl -X POST https://heypubli.com/api/funnel/invite \
 *     -H "authorization: Bearer $CRON_SECRET" \
 *     -H "content-type: application/json" \
 *     -d '{"email":"someone@gmail.com","firstName":"Sam","whatsapp":"+919..."}'
 */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { email?: string; firstName?: string; whatsapp?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }

  const result = await inviteLeadByEmail(createAdminClient(), {
    email: body.email,
    firstName: body.firstName ?? null,
    whatsapp: body.whatsapp ?? null,
  });
  // 200 either way: "we will not invite this person" is an answer, not a fault.
  return NextResponse.json(result);
}
