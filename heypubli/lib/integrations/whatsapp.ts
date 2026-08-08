// heypubli's entire coupling to the WhatsApp brain. The brain (Twilio sender, templates,
// 24h-window logic, kill switches, message history) lives in the HeyElsie Supabase
// project and is reached through ONE bearer-authed edge function, wk-partner-api.
//
// Why it is not ported here: a Twilio WhatsApp sender can only point its inbound webhook
// at one URL, and it points at HeyElsie. Re-pointing it takes HeyElsie's inbox dark the
// same second. One number, one blast radius, one control room.

export interface PartnerSendInput {
  /** E.164, the lead's number. */
  to: string;
  /** The lead's first name, for template variable {{1}}. */
  firstName: string;
  /** Twilio Content SID (HX...) for a template send, or omit for free-form. */
  contentSid?: string;
  /** Free-form body (only lands inside an open 24h window). */
  body?: string;
  /** Public https image/video URLs, free-form only, at most 3. WhatsApp delivers
   *  media worldwide (unlike MMS, which is US/Canada only). */
  mediaUrls?: string[];
  /** Our idempotency key, stored as external_id on the message row. */
  externalId: string;
}

export type PartnerSendBlocked =
  | "do_not_text"
  | "daily_cap"
  | "window_closed"
  | "template_unapproved"
  | "kill_switch"
  | "bad_number";

export interface PartnerSendResult {
  ok: boolean;
  queued?: boolean;
  wk_contact_id?: string;
  wk_message_id?: string;
  twilio_sid?: string;
  blocked?: PartnerSendBlocked;
  error?: string;
}

function baseUrl(): string | null {
  return process.env.WK_CRM_BASE_URL ?? null;
}

async function call(action: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const base = baseUrl();
  const key = process.env.WK_PARTNER_API_KEY;
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/functions/v1/wk-partner-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ action, ...payload }),
      // A hung edge function must never eat a whole cron run: the tick and the
      // sheet-sync both loop over leads, and one stuck fetch used to strand every
      // lead behind it in the batch.
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok && !json.blocked) {
      return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    }
    return json;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

/** Send a WhatsApp message (template or free-form) through the HeyElsie brain. */
export async function sendPartnerWhatsApp(
  input: PartnerSendInput,
): Promise<PartnerSendResult> {
  const result = await call("send", {
    to: input.to,
    first_name: input.firstName,
    content_sid: input.contentSid,
    body: input.body,
    media_urls: input.mediaUrls,
    external_id: input.externalId,
    product: "heypubli",
  });
  if (!result) return { ok: false, error: "not configured" };
  return result as unknown as PartnerSendResult;
}

/**
 * The picture a creator sent, as base64, fetched through the CRM because
 * inbound WhatsApp media lives behind Twilio's own basic auth and only that
 * side holds the credentials. Still images only; anything else answers
 * ok:false and the caller hands the thread to a human, as before.
 */
export async function getInboundMedia(
  messageId: string,
): Promise<{ ok: boolean; mediaType?: string; base64?: string; error?: string }> {
  const result = await call("message_media", { message_id: messageId });
  if (!result) return { ok: false, error: "not configured" };
  const r = result as { ok?: boolean; media_type?: string; base64?: string; error?: string };
  return { ok: Boolean(r.ok), mediaType: r.media_type, base64: r.base64, error: r.error };
}

/** Delivery status of an earlier send, polled by the funnel tick. */
export async function getPartnerMessageStatus(
  externalId: string,
): Promise<{ ok: boolean; status?: string; error_code?: string | null }> {
  const result = await call("message_status", { external_id: externalId });
  if (!result) return { ok: false };
  return result as unknown as { ok: boolean; status?: string; error_code?: string | null };
}

/**
 * How many WhatsApp messages left the shared sender in the last 24 hours, both
 * businesses combined. The Meta tier (250/24h to start) is per NUMBER, so heypubli's cap
 * has to count HeyElsie's sends too.
 */
export async function getSharedSenderLoad(): Promise<{ ok: boolean; sent24h?: number }> {
  const result = await call("sender_load", {});
  if (!result) return { ok: false };
  return result as unknown as { ok: boolean; sent24h?: number };
}

export interface ContactState {
  ok: boolean;
  exists?: boolean;
  do_not_text?: boolean;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  error?: string;
}

/**
 * Has this phone number ever written to us on WhatsApp? The sheet-sync asks this before
 * arming a nudge, because a form lead who already opened a conversation must be handed
 * to the inbox, never cold-templated on top of a live thread.
 */
export async function getContactState(phone: string): Promise<ContactState> {
  const result = await call("contact_state", { phone });
  if (!result) return { ok: false, error: "not configured" };
  return result as unknown as ContactState;
}

/**
 * Find-or-create the CRM contact and stamp it product=heypubli, sending nothing.
 * Called at import time so the inbound relay can match a reply that arrives BEFORE our
 * first outbound; without the stamp such a reply never reaches the funnel and the drip
 * cold-templates a live thread.
 */
export async function ensureContact(
  phone: string,
  firstName: string,
): Promise<{ ok: boolean; wk_contact_id?: string; created?: boolean }> {
  const result = await call("ensure_contact", { phone, first_name: firstName });
  if (!result) return { ok: false };
  return result as unknown as { ok: boolean; wk_contact_id?: string; created?: boolean };
}

export interface WaitingThread {
  name: string;
  phone: string;
  last_inbound_at: string | null;
  drafts_pending: number;
  waiting_minutes: number | null;
}

/** heypubli threads whose LAST message is inbound: the people waiting on us right now. */
export async function getInboxSummary(): Promise<{ ok: boolean; waiting?: WaitingThread[] }> {
  const result = await call("inbox_summary", {});
  if (!result) return { ok: false };
  return result as unknown as { ok: boolean; waiting?: WaitingThread[] };
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  status: string;
  created_at: string;
  /** Pictures/clips attached. A photo with no caption must never read as silence. */
  media_count?: number;
}

/** The conversation, oldest first, so the reply brain can read what was said. */
export async function getThreadMessages(
  phone: string,
  limit = 30,
): Promise<{ ok: boolean; exists?: boolean; do_not_text?: boolean; messages?: ThreadMessage[] }> {
  const result = await call("thread_messages", { phone, limit });
  if (!result) return { ok: false };
  return result as unknown as {
    ok: boolean;
    exists?: boolean;
    do_not_text?: boolean;
    messages?: ThreadMessage[];
  };
}

export interface TemplateStatus {
  sid: string;
  name: string;
  status: string;
  rejection_reason: string;
}

/** Live Meta approval status per Content sid, straight from Twilio. */
export async function getTemplateStatuses(
  sids: string[],
): Promise<{ ok: boolean; templates?: TemplateStatus[] }> {
  const result = await call("template_status", { sids });
  if (!result) return { ok: false };
  return result as unknown as { ok: boolean; templates?: TemplateStatus[] };
}
