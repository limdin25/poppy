import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { verifyFunnelSignature } from "@/lib/funnel/hmac";
import { createAdminClient } from "@/lib/supabase/admin";

// HeyElsie's wk-sms-incoming relays a heypubli lead's WhatsApp reply here (fan-out is
// pre-gated on the contact being stamped product=heypubli). Two jobs:
//   1. A reply STOPS the template drip: the lead is now in a live conversation, which is
//      free inside the 24h window and better than any nudge.
//   2. STOP words mark the opt-out on heypubli's side too, so the nurture engine can
//      never queue them again even if HeyElsie's tag were lost.
const relaySchema = z.object({
  type: z.literal("inbound_whatsapp"),
  phone: z.string().min(8),
  body: z.string().default(""),
  opt_out: z.boolean().default(false),
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
  const { data: lead } = await admin
    .from("signup_leads")
    .select("id, status, engaged_at")
    .eq("whatsapp_e164", event.phone)
    .maybeSingle<{ id: string; status: string; engaged_at: string | null }>();
  if (!lead) return NextResponse.json({ ok: true, matched: false }, { status: 200 });

  if (event.opt_out) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({
        nurture_state: "blocked",
        nurture_stop_reason: "opted out",
        whatsapp_opted_out_at: nowIso,
        last_seen_at: nowIso,
      })
      .eq("id", lead.id);
    return NextResponse.json({ ok: true, opted_out: true }, { status: 200 });
  }

  // Engaged: stamp it unconditionally (the stamp is history), and stop the drip. The
  // status itself only moves forward, so a lead already at 'started' stays there.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("signup_leads") as any)
    .update({
      engaged_at: lead.engaged_at ?? nowIso,
      status: lead.status === "captured" || lead.status === "contacted" ? "engaged" : lead.status,
      nurture_state: "stopped",
      nurture_stop_reason: "replied",
      last_seen_at: nowIso,
    })
    .eq("id", lead.id);

  return NextResponse.json({ ok: true, matched: true }, { status: 200 });
}
