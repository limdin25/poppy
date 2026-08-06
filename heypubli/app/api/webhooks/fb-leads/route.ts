import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { resolveLeadLane, queueSkoolInvite } from "@/lib/data/lanes";
import { verifyFunnelSignature } from "@/lib/funnel/hmac";
import { createAdminClient } from "@/lib/supabase/admin";

// A Facebook lead-form submission, relayed by Zapier (FB Lead Ads trigger -> Webhooks
// POST with a Code step computing X-Funnel-Signature over the raw body).
//
// Contract notes that matter:
// - Idempotent on fb_leadgen_id (unique index): Zapier replays are folded into one lead.
// - Business-rule rejections answer 200, never 5xx. Zapier retries 5xx, and a retried
//   "rejection" becomes a duplicate lead.
// - This is Lane A's front door. Every lead landing here is lane=partner, which is
//   exactly what the free Skool invite requires. The invite is QUEUED here, immediately,
//   because the corrected flow is community first, platform second.
const leadSchema = z.object({
  leadgen_id: z.string().min(1),
  form_id: z.string().optional(),
  ad_id: z.string().optional(),
  campaign_id: z.string().optional(),
  created_time: z.string().optional(),
  first_name: z.string().trim().min(1),
  last_name: z.string().trim().default(""),
  email: z.email(),
  phone_number: z.string().trim().min(8),
});

export async function POST(request: Request) {
  const raw = await request.text();
  const ok = verifyFunnelSignature(
    raw,
    request.headers.get("x-funnel-signature"),
    process.env.FB_LEADS_WEBHOOK_SECRET,
  );
  if (!ok) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, skipped: "bad_json" }, { status: 200 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, skipped: "bad_fields", detail: parsed.error.issues[0]?.message },
      { status: 200 },
    );
  }
  const lead = parsed.data;

  // Replay check up front so a Zapier retry is a fast no-op.
  const admin = createAdminClient();
  const { data: dupe } = await admin
    .from("signup_leads")
    .select("id")
    .eq("fb_leadgen_id", lead.leadgen_id)
    .maybeSingle();
  if (dupe) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  const phone = lead.phone_number.startsWith("+")
    ? lead.phone_number.replace(/[^\d+]/g, "")
    : "+" + lead.phone_number.replace(/\D/g, "");

  const result = await resolveLeadLane({
    firstName: lead.first_name,
    lastName: lead.last_name,
    email: lead.email,
    whatsapp: phone,
    lane: "partner",
    source: "fb_lead_form",
    fb: {
      leadgenId: lead.leadgen_id,
      formId: lead.form_id,
      adId: lead.ad_id,
      campaignId: lead.campaign_id,
    },
    consentAt: lead.created_time,
  });

  if (!result.ok || !result.leadId) {
    // A real failure we want Zapier to retry: infrastructure, not business rules.
    return NextResponse.json({ error: "storage failed" }, { status: 500 });
  }

  if (result.outcome === "conflict") {
    // Logged in lane_conflicts for Hugo. The lead exists; no invite, no nurture.
    return NextResponse.json(
      { ok: true, skipped: "lane_conflict", lead_id: result.leadId },
      { status: 200 },
    );
  }

  // Community first: queue the free Skool invite the moment the recruit is captured.
  if (result.lane === "partner") {
    await queueSkoolInvite(result.leadId);
    // Arm the nurture machine; the funnel tick does the sending under all its guards.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({ nurture_state: "active", nurture_next_at: new Date().toISOString() })
      .eq("id", result.leadId)
      .eq("nurture_state", "idle");
  }

  return NextResponse.json(
    { ok: true, lead_id: result.leadId, outcome: result.outcome },
    { status: 200 },
  );
}
