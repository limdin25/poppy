import { ensureContact, getContactState, type ContactState } from "@/lib/integrations/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";

// ONE way to start the machine for a fresh partner lead, shared by the fb-leads webhook
// and the sheet-sync cron so the two intake doors cannot disagree. Until 07 Aug 2026 the
// webhook armed at NOW with no checks while sheet-sync armed at +10min with them, and
// whichever path won the race decided whether the safety layer existed at all.
//
// NO GRACE. Hugo, 07 Aug 2026: "as soon as they come we message them. That's it. Why
// are you gonna wait for? We are not sending them to any landing page or anything."
// The rule replaced a 10 minute wait-and-see the same afternoon it was built. What
// remains of the old design is the part that still matters:
//   1. ensureContact stamps the CRM contact product=heypubli at import time, so a reply
//      is relayed to the inbound webhook, which stops the drip and hands the thread to
//      the reply brain.
//   2. decideArm hands anyone ALREADY in a live conversation (inbound inside 24h, the
//      WhatsApp window) to the reply brain instead of the template drip.
//   3. The tick re-checks the thread right before sending, as the last line of defence.

export const NO_CONTACT_GRACE_MS = 0;
export const LIVE_THREAD_WINDOW_MS = 24 * 3600 * 1000;

export type ArmDecision =
  | { action: "block" }
  | { action: "engage"; lastInboundAt: string }
  | { action: "arm"; nextAt: Date; degraded?: boolean };

/** Pure decision: what does the CRM's knowledge of this phone mean for the drip? */
export function decideArm(state: ContactState, now: Date): ArmDecision {
  if (!state.ok) {
    // Fail OPEN into the grace path: worst case one polite welcome lands on a thread,
    // and the tick's own pre-send check gets a second look. Failing closed would mean
    // a CRM hiccup silently stops all new leads from ever being contacted.
    return { action: "arm", nextAt: new Date(now.getTime() + NO_CONTACT_GRACE_MS), degraded: true };
  }
  if (state.do_not_text) return { action: "block" };
  if (
    state.last_inbound_at &&
    now.getTime() - Date.parse(state.last_inbound_at) < LIVE_THREAD_WINDOW_MS
  ) {
    return { action: "engage", lastInboundAt: state.last_inbound_at };
  }
  return { action: "arm", nextAt: new Date(now.getTime() + NO_CONTACT_GRACE_MS) };
}

export interface ArmResult {
  outcome: "armed" | "engaged" | "blocked" | "skipped";
  degraded?: boolean;
}

/**
 * Apply the decision to a lead row. Every write is guarded on nurture_state='idle', so
 * whichever of the two intake paths runs second is a no-op, and a reply processed in
 * between (which sets 'stopped') can never be overwritten back to active.
 */
export async function armFreshPartnerLead(
  admin: ReturnType<typeof createAdminClient>,
  lead: { id: string; phone: string; firstName: string },
): Promise<ArmResult> {
  await ensureContact(lead.phone, lead.firstName);
  const state = await getContactState(lead.phone);
  const decision = decideArm(state, new Date());
  const nowIso = new Date().toISOString();

  if (decision.action === "block") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({
        nurture_state: "blocked",
        nurture_stop_reason: "do-not-text",
        whatsapp_opted_out_at: nowIso,
      })
      .eq("id", lead.id)
      .eq("nurture_state", "idle");
    return { outcome: "blocked" };
  }

  if (decision.action === "engage") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("signup_leads") as any)
      .update({
        engaged_at: decision.lastInboundAt,
        status: "engaged",
        nurture_state: "stopped",
        nurture_stop_reason: "was already in conversation before import",
        last_seen_at: nowIso,
      })
      .eq("id", lead.id)
      .eq("nurture_state", "idle")
      .in("status", ["captured", "contacted"]);
    return { outcome: "engaged" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: armed } = await (admin.from("signup_leads") as any)
    .update({
      nurture_state: "active",
      nurture_next_at: decision.nextAt.toISOString(),
    })
    .eq("id", lead.id)
    .eq("nurture_state", "idle")
    .select("id");
  return {
    outcome: armed?.length ? "armed" : "skipped",
    degraded: decision.degraded,
  };
}
