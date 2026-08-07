import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod/v4";
import { verifyFunnelSignature } from "@/lib/funnel/hmac";
import { runTriggeredReply, settleDelayMs } from "@/lib/data/reply-runner";
import { createAdminClient } from "@/lib/supabase/admin";

// HeyElsie's wk-sms-incoming relays a heypubli lead's WhatsApp reply here (fan-out is
// pre-gated on the contact being stamped product=heypubli). Three jobs:
//   1. A reply STOPS the template drip: the lead is now in a live conversation, which is
//      free inside the 24h window and better than any nudge.
//   2. STOP words mark the opt-out on heypubli's side too, so the nurture engine can
//      never queue them again even if HeyElsie's tag were lost.
//   3. It TRIGGERS the reply brain for this one thread, after a human pause. Hugo,
//      07 Aug 2026: "every time a new message comes the AI has to be triggered and
//      reply within like 30 seconds. Not one second, but 30 seconds, to sound
//      natural." The every-minute cron stays as the safety net; the claim-first
//      unique index in funnel_replies means both can fire with no double send.

// The settle pause runs AFTER the 200 is returned (next/server after()), so the
// relay caller is never held. maxDuration must outlive the longest pause plus the
// reply work itself.
export const maxDuration = 120;

const relaySchema = z.object({
  type: z.literal("inbound_whatsapp"),
  phone: z.string().min(8),
  body: z.string().default(""),
  opt_out: z.boolean().default(false),
  // A plain-English refusal ("not interested", "remove me"). Not the STOP
  // contract, so no do-not-text tag is set on HeyElsie's side and a human can
  // still reply in the inbox, but every automation here parks immediately.
  refused: z.boolean().default(false),
  twilio_sid: z.string().optional(),
});

export async function POST(request: Request) {
  const raw = await request.text();
  const ok = verifyFunnelSignature(
    raw,
    request.headers.get("x-funnel-signature"),
    process.env.WK_INBOUND_WEBHOOK_SECRET,
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  const parsed = relaySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 200 });
  const event = parsed.data;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  // Match on BOTH phone columns, and take the newest on a tie.
  //
  // This used to be .eq("whatsapp_e164", ...).maybeSingle(), while the nurture
  // engine sends to `whatsapp_e164 ?? whatsapp`. So the set we could MESSAGE
  // was larger than the set we could MATCH: a lead with only `whatsapp` filled
  // in could be texted but their "not interested" reply matched nothing, wrote
  // nothing, and the drip carried on. maybeSingle() also returned null when two
  // leads shared a number, losing the refusal the same silent way.
  const { data: leads } = await admin
    .from("signup_leads")
    .select("id, status, engaged_at")
    .or(`whatsapp_e164.eq.${event.phone},whatsapp.eq.${event.phone}`)
    .order("first_seen_at", { ascending: false })
    .limit(1)
    .returns<{ id: string; status: string; engaged_at: string | null }[]>();
  const lead = leads?.[0];

  let optedOut = false;
  if (lead) {
    // A STOP and a "not interested" both end the automated conversation. They
    // are stored the same way on purpose: whatsapp_opted_out_at is the one flag
    // the nurture drip AND the onboarding nudge brain both refuse to send past,
    // so one write closes every automated door. Hugo, 2026-08-06, after a lead
    // who answered "Not interested" was pitched again 70 minutes later.
    if (event.opt_out || event.refused) {
      optedOut = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({
          nurture_state: "blocked",
          nurture_stop_reason: event.opt_out ? "opted out" : "said not interested",
          whatsapp_opted_out_at: nowIso,
          last_seen_at: nowIso,
        })
        .eq("id", lead.id);
    } else {
      // Engaged: stamp it unconditionally (the stamp is history), and stop the drip.
      // The status itself only moves forward, so a lead already at 'started' stays.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any)
        .update({
          engaged_at: lead.engaged_at ?? nowIso,
          status:
            lead.status === "captured" || lead.status === "contacted" ? "engaged" : lead.status,
          nurture_state: "stopped",
          nurture_stop_reason: "replied",
          last_seen_at: nowIso,
        })
        .eq("id", lead.id);
    }
  }

  // The trigger fires WHETHER OR NOT a lead row matched: Angelica (07 Aug 2026)
  // messaged from a different number than her form, matched nothing here, and
  // sat unanswered for 10 minutes. The brain itself knows how to adopt her lead
  // from the form details; this route's only job is to wake it. Opt-outs and
  // refusals get no automated reply, so no trigger.
  //
  // A refusal on a message with no matching lead still reaches the brain via
  // the cron path, where decideReply's own refusal rules fire; the trigger
  // skips it here because sending anything after a "no" is the old mistake.
  if (!event.opt_out && !event.refused) {
    const triggerAtMs = Date.now();
    after(async () => {
      await new Promise((r) => setTimeout(r, settleDelayMs()));
      try {
        const result = await runTriggeredReply(event.phone, triggerAtMs);
        console.log(
          `[whatsapp-inbound] triggered reply for ${event.phone}: acted=${result.acted} (${result.why})`,
        );
      } catch (e) {
        // The cron sweep answers within the minute if this dies.
        console.error("[whatsapp-inbound] triggered reply threw", e);
      }
    });
  }

  return NextResponse.json(
    { ok: true, matched: Boolean(lead), opted_out: optedOut || undefined },
    { status: 200 },
  );
}
