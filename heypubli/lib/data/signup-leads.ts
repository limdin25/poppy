import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SignupLead, SignupLeadStage } from "@/types/database";

// How far along the funnel a lead is. Order matters: this array IS the ranking.
// captured/contacted/engaged arrive with the Facebook funnel (migration 021).
//
// "invited" sits EARLY, not at the top. It used to be last, from the old flow
// where the Skool invite came after Instagram connect. Then community-first
// arrived: sheet-sync queues the invite AT IMPORT, so every fresh lead is
// stamped "invited" within seconds of existing. With "invited" ranked above
// "connected", the drip read stageIndex(invited) >= stageIndex(connected) and
// skipped the welcome as "converted" for EVERY imported lead, and advanceStage
// refused to ever move them forward because nothing outranked the top. Thirteen
// real leads were silently stopped in the first evening. The ladder must rank
// what the LEAD has done; the invite is something WE did.
export const LEAD_STAGES: SignupLeadStage[] = [
  "captured",
  "contacted",
  "engaged",
  "invited",
  "started",
  "sent_to_instagram",
  "connected",
];

/**
 * Stages only ever move forward. Someone who connects and later re-opens /signup must not
 * be knocked back to "started", or the admin list would show a real, connected influencer
 * as an abandoned lead.
 */
export function advanceStage(
  current: SignupLeadStage | null | undefined,
  incoming: SignupLeadStage,
): SignupLeadStage {
  const now = LEAD_STAGES.indexOf(incoming);
  const before = current ? LEAD_STAGES.indexOf(current) : -1;
  return now > before ? incoming : (current as SignupLeadStage);
}

/** The timestamp column a stage stamps, or null for the stage that is just the insert. */
export function stageStampColumn(
  stage: SignupLeadStage,
):
  | "captured_at"
  | "contacted_at"
  | "engaged_at"
  | "sent_to_instagram_at"
  | "connected_at"
  | "invited_at"
  | null {
  if (stage === "captured") return "captured_at";
  if (stage === "contacted") return "contacted_at";
  if (stage === "engaged") return "engaged_at";
  if (stage === "sent_to_instagram") return "sent_to_instagram_at";
  if (stage === "connected") return "connected_at";
  if (stage === "invited") return "invited_at";
  return null;
}

export interface RecordLeadInput {
  first_name: string;
  last_name: string;
  email: string;
  whatsapp: string;
  stage: SignupLeadStage;
  profileId?: string | null;
}

/**
 * Write down a signup, or move an existing one forward. Deduped on the lower-cased email.
 *
 * Never throws. This runs on the path between "answered the questions" and "sent to
 * Instagram", and a bookkeeping failure must never cost a real signup, so every error is
 * swallowed and reported as false for the caller to log.
 */
export async function recordSignupLead(input: RecordLeadInput): Promise<boolean> {
  const email = input.email.trim();
  if (!email) return false;

  try {
    const admin = createAdminClient();
    const stamp = stageStampColumn(input.stage);
    const nowIso = new Date().toISOString();

    const { data: existing } = await admin
      .from("signup_leads")
      .select(
        "id, status, attempts, captured_at, contacted_at, engaged_at, sent_to_instagram_at, connected_at, invited_at",
      )
      .eq("email_normalized", email.toLowerCase())
      .maybeSingle<
        Pick<
          SignupLead,
          | "id"
          | "status"
          | "attempts"
          | "captured_at"
          | "contacted_at"
          | "engaged_at"
          | "sent_to_instagram_at"
          | "connected_at"
          | "invited_at"
        >
      >();

    if (existing) {
      const patch: Record<string, unknown> = {
        first_name: input.first_name,
        last_name: input.last_name,
        whatsapp: input.whatsapp,
        status: advanceStage(existing.status, input.stage),
        attempts: existing.attempts + 1,
        last_seen_at: nowIso,
      };
      // First time through a stage only. Keep the original stamp on a repeat so the
      // record still says when they actually first got there.
      if (stamp && !existing[stamp]) patch[stamp] = nowIso;
      if (input.profileId) patch.profile_id = input.profileId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from("signup_leads") as any)
        .update(patch)
        .eq("id", existing.id);
      if (error) {
        console.error("[signup-leads] update failed", error);
        return false;
      }
      return true;
    }

    const row: Record<string, unknown> = {
      first_name: input.first_name,
      last_name: input.last_name,
      email,
      whatsapp: input.whatsapp,
      status: input.stage,
      last_seen_at: nowIso,
      // A row born here came through the public signup wizard, which makes it lane
      // organic (the DB default) and puts it in Hugo's approval queue for the community.
      approval_state: "pending",
    };
    if (stamp) row[stamp] = nowIso;
    if (input.profileId) row.profile_id = input.profileId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("signup_leads") as any).insert(row);
    if (!error) return true;

    // 23505 = someone else inserted the same email between the select and the insert.
    // Their row is the one that exists now, so fold this call into an update of it.
    if (error.code === "23505") {
      return recordSignupLead(input);
    }
    console.error("[signup-leads] insert failed", error);
    return false;
  } catch (e) {
    console.error("[signup-leads] unexpected failure", e);
    return false;
  }
}

/**
 * Link a signup to the EXACT lead the ?u= code names. Hugo, 08 Aug 2026:
 * "track the person's exact sign up." This is what survives a creator signing
 * up with a different email than their form: the email matcher below misses,
 * the code does not. Resolution runs through lead_id_by_code (service-role
 * only); anything unresolvable is silently nothing, attribution never breaks
 * a signup.
 */
export async function linkSignupLeadByCode(code: string, profileId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: leadId } = await (admin.rpc as any)("lead_id_by_code", { code });
    if (!leadId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("signup_leads") as any)
      .update({
        status: "connected",
        profile_id: profileId,
        connected_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .is("connected_at", null);
    if (error) console.error("[signup-leads] code link failed", error);
  } catch (e) {
    console.error("[signup-leads] code link threw", e);
  }
}

/** Called from the Instagram callback once the account really exists. */
export async function markSignupLeadConnected(
  email: string,
  profileId: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from("signup_leads") as any)
      .update({
        status: "connected",
        profile_id: profileId,
        connected_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("email_normalized", email.trim().toLowerCase())
      .is("connected_at", null);
    if (error) console.error("[signup-leads] connect stamp failed", error);
  } catch (e) {
    console.error("[signup-leads] connect stamp threw", e);
  }
}

/** Admin list, newest first. Reads under the caller's session, so RLS gates it. */
export async function getSignupLeads(): Promise<SignupLead[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signup_leads")
    .select("*")
    .order("first_seen_at", { ascending: false });
  return (data as SignupLead[] | null) ?? [];
}

export interface SignupLeadStats {
  total: number;
  started: number;
  sentToInstagram: number;
  connected: number;
  /** Answered the questions but never came back from Instagram. The whole point. */
  lost: number;
}

/**
 * Counts read off the stage STAMPS, never off `status`. A connected lead also started, and
 * counting it only in "connected" would make the funnel lie about how many people ever
 * reached each step.
 */
export function summariseLeads(leads: SignupLead[]): SignupLeadStats {
  const sentToInstagram = leads.filter((l) => l.sent_to_instagram_at).length;
  const connected = leads.filter((l) => l.connected_at).length;
  return {
    total: leads.length,
    started: leads.length,
    sentToInstagram,
    connected,
    lost: leads.length - connected,
  };
}
