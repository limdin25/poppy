import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { verifyFunnelSignature } from "@/lib/funnel/hmac";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSignupLead } from "@/lib/data/signup-leads";

// Everything Skool tells us comes back through here, via Zapier:
// - invite_result: the tail of our own invite Zap (Catch Hook -> Skool Invite Member ->
//   Unlock Course -> Webhooks POST back here), confirming a queued invite landed.
// - new_paid_member: Skool's "New Paid Member" trigger. This is what makes the
//   customer lane REAL: a paid row here is the fact that blocks a future free invite.
// - membership_question: Skool's "Answered Membership Questions" trigger (optional).
const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("invite_result"),
    idempotency_key: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("new_paid_member"),
    email: z.email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    paid_at: z.string().optional(),
  }),
  z.object({
    type: z.literal("membership_question"),
    email: z.email(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  }),
]);

export async function POST(request: Request) {
  const raw = await request.text();
  const ok = verifyFunnelSignature(
    raw,
    request.headers.get("x-funnel-signature"),
    process.env.SKOOL_WEBHOOK_SECRET,
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, skipped: "bad_json" }, { status: 200 });
  }
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, skipped: "bad_fields" }, { status: 200 });
  }
  const event = parsed.data;
  const admin = createAdminClient();

  if (event.type === "invite_result") {
    const nowIso = new Date().toISOString();
    if (event.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: invite } = await (admin.from("skool_invites") as any)
        .update({ status: "confirmed", confirmed_at: nowIso })
        .eq("idempotency_key", event.idempotency_key)
        .select("lead_id, email, first_name")
        .maybeSingle();
      if (invite?.lead_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("signup_leads") as any)
          .update({ status: "invited", invited_at: nowIso, last_seen_at: nowIso })
          .eq("id", invite.lead_id)
          .neq("status", "invited");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("skool_members") as any).upsert(
          {
            email_normalized: String(invite.email).trim().toLowerCase(),
            lead_id: invite.lead_id,
            membership: "free_invited",
            source: "zapier",
            updated_at: nowIso,
          },
          { onConflict: "email_normalized", ignoreDuplicates: false },
        );
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("skool_invites") as any)
        .update({ status: "failed", last_error: event.error ?? "zap reported failure" })
        .eq("idempotency_key", event.idempotency_key);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (event.type === "new_paid_member") {
    const emailNorm = event.email.trim().toLowerCase();
    const nowIso = new Date().toISOString();
    // The paid fact first: this is the row that protects the lane gate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("skool_members") as any).upsert(
      {
        email_normalized: emailNorm,
        membership: "paid",
        paid_at: event.paid_at ?? nowIso,
        source: "zapier",
        updated_at: nowIso,
      },
      { onConflict: "email_normalized", ignoreDuplicates: false },
    );
    // Make sure a lead row exists carrying the customer lane. If this email is already a
    // partner or organic lead, resolveLeadLane's rules keep their lane and log a
    // conflict; recordSignupLead is NOT used here because a paid member is not a signup.
    const { data: existing } = await admin
      .from("signup_leads")
      .select("id")
      .eq("email_normalized", emailNorm)
      .maybeSingle();
    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("signup_leads") as any).insert({
        first_name: event.first_name ?? "",
        last_name: event.last_name ?? "",
        email: event.email.trim(),
        whatsapp: "",
        lane: "customer",
        source: "affiliate_link",
        lane_locked_by: "skool:new_paid_member",
        status: "captured",
        captured_at: nowIso,
        last_seen_at: nowIso,
      });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // membership_question: informational only for now; keep the lead's last_seen fresh.
  await recordSignupLead({
    first_name: event.first_name ?? "",
    last_name: event.last_name ?? "",
    email: event.email,
    whatsapp: "",
    stage: "captured",
  });
  return NextResponse.json({ ok: true }, { status: 200 });
}
