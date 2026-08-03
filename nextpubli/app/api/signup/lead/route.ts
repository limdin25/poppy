import { NextResponse } from "next/server";
import { recordSignupLead } from "@/lib/data/signup-leads";
import { igSignupSchema } from "@/schemas";

/**
 * Called by the signup wizard the moment someone finishes the three questions and lands
 * on the Instagram screen, BEFORE Instagram is involved.
 *
 * That timing is the whole point. Without it, anyone who answered the questions and then
 * closed the tab, or bailed at Instagram, left nothing behind at all: the answers only
 * ever lived in a one-hour cookie.
 *
 * Always answers 200. This is bookkeeping running alongside a live signup, and a failure
 * here must never surface as an error in front of the person signing up.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const parsed = igSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  const ok = await recordSignupLead({ ...parsed.data, stage: "started" });
  return NextResponse.json({ ok }, { status: 200 });
}
