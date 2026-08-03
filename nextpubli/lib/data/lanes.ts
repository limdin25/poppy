import { createAdminClient } from "@/lib/supabase/admin";
import type { SignupLane, SignupLead, SignupLeadSource } from "@/types/database";

// ============================================================
// Pure decision logic (unit tested, no I/O)
// ============================================================

export type LaneDecision =
  | { action: "insert"; lane: SignupLane }
  | { action: "keep"; lane: SignupLane }
  | { action: "upgrade"; lane: SignupLane; reason: string }
  | { action: "conflict"; existing: SignupLane; incoming: SignupLane; detail: string };

/**
 * What happens when a lead arrives claiming a lane, given what we already know about
 * them. The dangerous direction (anything that would end in a free invite for someone
 * who pays, or strip partner status from a recruit) always refuses and files a conflict
 * for Hugo; only the one provably-safe upgrade is automatic.
 */
export function decideLane(
  existingLane: SignupLane | null,
  incomingLane: SignupLane,
  isPaidSkoolMember: boolean,
): LaneDecision {
  if (existingLane === null) {
    return { action: "insert", lane: incomingLane };
  }
  if (existingLane === incomingLane) {
    return { action: "keep", lane: existingLane };
  }
  // A paying customer must never become a free partner. This is Hugo's rule.
  if (existingLane === "customer" && incomingLane === "partner") {
    return {
      action: "conflict",
      existing: existingLane,
      incoming: incomingLane,
      detail: "A paying customer filled in the recruit form. Free invite refused.",
    };
  }
  // A recruit who buys something keeps their partner status and their rate.
  if (existingLane === "partner" && incomingLane === "customer") {
    return {
      action: "conflict",
      existing: existingLane,
      incoming: incomingLane,
      detail: "A partner arrived through a customer door. Partner status kept.",
    };
  }
  // The one safe automatic move: someone who found the site on their own and then filled
  // in the Facebook form is a genuine recruit, PROVIDED Skool does not already know them
  // as a paying member.
  if (existingLane === "organic" && incomingLane === "partner") {
    if (isPaidSkoolMember) {
      return {
        action: "conflict",
        existing: existingLane,
        incoming: incomingLane,
        detail: "Organic signup filled the recruit form but is already a paid member.",
      };
    }
    return {
      action: "upgrade",
      lane: "partner",
      reason: "system:fb_upgrade",
    };
  }
  // organic -> customer: they bought. Fine, and loses them nothing.
  if (existingLane === "organic" && incomingLane === "customer") {
    return { action: "upgrade", lane: "customer", reason: "system:purchase" };
  }
  // customer -> organic / partner -> organic: arriving through a weaker door changes
  // nothing.
  return { action: "keep", lane: existingLane };
}

/**
 * US numbers get email only: Meta has not delivered marketing templates to US numbers
 * since April 2025, and Twilio still reports success, so a WhatsApp nudge to a US lead is
 * a silent black hole. +1 also covers Canada and the NANP Caribbean; a small Canadian
 * area-code list keeps the common ones on WhatsApp, and over-routing the rest to email is
 * harmless.
 */
const CANADIAN_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "263", "289", "306", "343", "354", "365", "367",
  "368", "382", "403", "416", "418", "428", "431", "437", "438", "450", "460", "468",
  "474", "506", "514", "519", "548", "579", "581", "584", "587", "600", "604", "613",
  "639", "647", "672", "683", "705", "709", "742", "753", "778", "780", "782", "807",
  "819", "825", "867", "873", "879", "902", "905",
]);

export function whatsappMarketingAllowed(e164: string): boolean {
  const digits = e164.replace(/\D/g, "");
  if (!digits.startsWith("1") || digits.length !== 11) return true;
  return CANADIAN_AREA_CODES.has(digits.slice(1, 4));
}

// ============================================================
// The nurture plan: three WhatsApp touches over ~11 days, email in the middle
// ============================================================
// Longer would be self-defeating: Meta's per-user marketing cap tightens on
// non-responders, and block-driven quality damage lands on a sender shared with HeyElsie.

export interface NurtureStep {
  step: number;
  /** Hours after the PREVIOUS send (step 0 fires immediately on capture). */
  afterHours: number;
  channel: "whatsapp" | "email";
  templateKey: string;
  /** The send is skipped once the lead's stage index reaches this stage. */
  skipAtOrPast: SignupLead["status"];
}

export const NURTURE_PLAN: NurtureStep[] = [
  { step: 0, afterHours: 0, channel: "whatsapp", templateKey: "heypubli_welcome", skipAtOrPast: "connected" },
  { step: 1, afterHours: 24, channel: "whatsapp", templateKey: "heypubli_nudge_signup", skipAtOrPast: "started" },
  { step: 2, afterHours: 72, channel: "email", templateKey: "email_nudge_signup", skipAtOrPast: "connected" },
  { step: 3, afterHours: 168, channel: "whatsapp", templateKey: "heypubli_nudge_connect", skipAtOrPast: "connected" },
];

/**
 * 09:00 to 20:00 in the lead's timezone. A 3am WhatsApp is a block-button generator, and
 * blocks are exactly what the quality rating measures.
 */
export function withinSendingHours(now: Date, timezone: string): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
    return hour >= 9 && hour < 20;
  } catch {
    // Unknown timezone string: fail open on daytime UTC.
    const hour = now.getUTCHours();
    return hour >= 9 && hour < 20;
  }
}

// ============================================================
// I/O: resolve a lead into a lane (service-role, server routes only)
// ============================================================

export interface ResolveLaneInput {
  firstName: string;
  lastName: string;
  email: string;
  whatsapp: string;
  lane: SignupLane;
  source: SignupLeadSource;
  fb?: {
    leadgenId?: string;
    formId?: string;
    adId?: string;
    campaignId?: string;
  };
  consentAt?: string;
}

export interface ResolveLaneResult {
  ok: boolean;
  leadId?: string;
  lane?: SignupLane;
  outcome: "inserted" | "kept" | "upgraded" | "conflict" | "error";
}

export async function resolveLeadLane(
  input: ResolveLaneInput,
): Promise<ResolveLaneResult> {
  const admin = createAdminClient();
  const emailNorm = input.email.trim().toLowerCase();

  try {
    // Match on email first, then phone: either identifying the same human wins.
    let { data: existing } = await admin
      .from("signup_leads")
      .select("id, lane, email_normalized")
      .eq("email_normalized", emailNorm)
      .maybeSingle<Pick<SignupLead, "id" | "lane" | "email_normalized">>();
    if (!existing && input.whatsapp) {
      const byPhone = await admin
        .from("signup_leads")
        .select("id, lane, email_normalized")
        .eq("whatsapp_e164", input.whatsapp)
        .maybeSingle<Pick<SignupLead, "id" | "lane" | "email_normalized">>();
      existing = byPhone.data ?? null;
    }

    const { data: paidRow } = await admin
      .from("skool_members")
      .select("id")
      .eq("email_normalized", emailNorm)
      .eq("membership", "paid")
      .maybeSingle();

    const decision = decideLane(existing?.lane ?? null, input.lane, Boolean(paidRow));

    if (decision.action === "insert") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: inserted, error } = await (admin.from("signup_leads") as any)
        .insert({
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email.trim(),
          whatsapp: input.whatsapp,
          whatsapp_e164: input.whatsapp || null,
          lane: decision.lane,
          source: input.source,
          lane_locked_by: input.source,
          status: "captured",
          captured_at: new Date().toISOString(),
          consent_source: input.source,
          consent_at: input.consentAt ?? new Date().toISOString(),
          fb_leadgen_id: input.fb?.leadgenId ?? null,
          fb_form_id: input.fb?.formId ?? null,
          fb_ad_id: input.fb?.adId ?? null,
          fb_campaign_id: input.fb?.campaignId ?? null,
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) {
        // 23505: someone else inserted the same person between our select and insert.
        // Their row is the truth now; fold this call into a re-resolution against it.
        if (error.code === "23505") return resolveLeadLane(input);
        console.error("[lanes] insert failed", error);
        return { ok: false, outcome: "error" };
      }
      return { ok: true, leadId: inserted.id, lane: decision.lane, outcome: "inserted" };
    }

    if (!existing) return { ok: false, outcome: "error" };

    if (decision.action === "conflict") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin.from("lane_conflicts") as any).insert({
        lead_id: existing.id,
        existing_lane: decision.existing,
        incoming_lane: decision.incoming,
        incoming_source: input.source,
        detail: decision.detail,
      });
      return { ok: true, leadId: existing.id, lane: existing.lane, outcome: "conflict" };
    }

    if (decision.action === "upgrade") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from("signup_leads") as any)
        .update({
          lane: decision.lane,
          lane_locked_at: new Date().toISOString(),
          lane_locked_by: decision.reason,
          fb_leadgen_id: input.fb?.leadgenId ?? undefined,
          fb_form_id: input.fb?.formId ?? undefined,
          fb_ad_id: input.fb?.adId ?? undefined,
          fb_campaign_id: input.fb?.campaignId ?? undefined,
          whatsapp_e164: input.whatsapp || undefined,
          consent_source: input.source,
          consent_at: input.consentAt ?? new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) {
        console.error("[lanes] upgrade failed", error);
        return { ok: false, outcome: "error" };
      }
      return { ok: true, leadId: existing.id, lane: decision.lane, outcome: "upgraded" };
    }

    // keep
    return { ok: true, leadId: existing.id, lane: existing.lane, outcome: "kept" };
  } catch (e) {
    console.error("[lanes] resolveLeadLane threw", e);
    return { ok: false, outcome: "error" };
  }
}

/**
 * Queue the free Skool invite for a partner lead. The database CHECK re-enforces the lane
 * rule, so even a bug here cannot hand a customer a free membership. Idempotent on
 * 'invite:<lead_id>'.
 */
export async function queueSkoolInvite(leadId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("signup_leads")
    .select("id, lane, email, first_name, profile_id")
    .eq("id", leadId)
    .maybeSingle<
      Pick<SignupLead, "id" | "lane" | "email" | "first_name" | "profile_id">
    >();
  if (!lead) return false;
  if (lead.lane !== "partner") return false;
  if (lead.email.toLowerCase().endsWith("@instagram.heypubli.com")) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("skool_invites") as any).insert({
    lead_id: lead.id,
    profile_id: lead.profile_id,
    email: lead.email,
    first_name: lead.first_name,
    lane: lead.lane,
    idempotency_key: `invite:${lead.id}`,
  });
  if (error && error.code !== "23505") {
    console.error("[lanes] queueSkoolInvite failed", error);
    return false;
  }
  return true;
}
