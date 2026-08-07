import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { armFreshPartnerLead } from "@/lib/data/lead-arming";
import { resolveLeadLane, queueSkoolInvite } from "@/lib/data/lanes";
import { pitchBlockedForPhone } from "@/lib/data/reply-brain";
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

  // STRICT: only a number that declares its country (+ or 00) is accepted. Blindly
  // prefixing "+" onto bare national digits invents a number in another country and
  // texts a stranger (9824840910 in India becomes +9824840910, which is Iran). A lead
  // stored without a phone still gets the email steps; a text to the wrong human is
  // not recoverable.
  const cleaned = lead.phone_number.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  let phone = "";
  if (digits.length >= 8) {
    if (cleaned.startsWith("+") && !cleaned.slice(1).startsWith("0")) phone = "+" + digits;
    else if (cleaned.startsWith("00")) phone = "+" + digits.replace(/^00/, "");
  }

  // Same door as sheet-sync. Hugo, 07 Aug 2026: no leads from a country Skool
  // cannot pay. Refused before anything is stored, 200 so Zapier never retries.
  if (phone && pitchBlockedForPhone(phone)) {
    return NextResponse.json({ ok: true, skipped: "blocked_country" }, { status: 200 });
  }

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
    // Arm through the SAME path as the sheet-sync: contact stamped, live threads
    // handed to the inbox, everyone else on the 10 minute grace. This used to arm at
    // NOW with no checks, which meant whichever intake door won the race decided
    // whether the safety layer existed.
    if (phone) {
      await armFreshPartnerLead(admin, {
        id: result.leadId,
        phone,
        firstName: lead.first_name,
      });
    }
  }

  return NextResponse.json(
    { ok: true, lead_id: result.leadId, outcome: result.outcome, phone_ok: Boolean(phone) },
    { status: 200 },
  );
}
