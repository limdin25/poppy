// Voicemail-drop callback attribution — "when a dropped contact comes
// back, flag it". If we voicemail-dropped a contact and they later call
// back OR text back — whether we answer or miss it — the CRM inbound
// webhooks tag them 'called-back' (permanent, wk_contact_tags) and move
// them to the Callback/Voicemail pipeline column.
//
// This module is the canonical, vitest-covered decision logic; the Deno
// webhooks (`wk-voice-twiml-incoming`, `wk-sms-incoming`) mirror it inline
// (Deno deploy can't import from api/). Change both together —
// tests/callback-attribution.test.ts pins the contract.
//
// Once-only rule (implemented in the mirrors): the TAG is idempotent, but
// the pipeline-column MOVE runs only when the tag upsert actually inserts
// (first callback). Later inbound touches within the window must not
// clobber manual pipeline moves.

export const CALLBACK_TAG = 'called-back'
export const CALLBACK_WINDOW_DAYS = 30

/**
 * Mirror of wk-sms-incoming's phoneVariants: the formats Twilio might send
 * vs what wk_contacts.phone might hold. Lookup matches any variant.
 */
export function phoneVariants(raw: string): { e164: string; digits: string; variants: string[] } {
  const trimmed = raw.replace(/^whatsapp:/, '').trim()
  const digits = trimmed.replace(/[^0-9]/g, '')
  const e164 = trimmed.startsWith('+') ? trimmed : `+${digits}`
  const variants = Array.from(new Set([trimmed, e164, digits].filter(Boolean)))
  return { e164, digits, variants }
}

export interface DroppedCallRow {
  direction: string | null
  voicemail_dropped: boolean | null
  started_at: string | null
}

/** Did any OUTBOUND call in `rows` have a voicemail drop within the window? */
export function hasRecentDrop(rows: DroppedCallRow[], now: Date, windowDays = CALLBACK_WINDOW_DAYS): boolean {
  const cutoff = now.getTime() - windowDays * 86_400_000
  return rows.some((r) => {
    if (r.direction !== 'outbound' || r.voicemail_dropped !== true || !r.started_at) return false
    const t = new Date(r.started_at).getTime()
    return Number.isFinite(t) && t >= cutoff
  })
}

export interface CallbackDecision {
  tag: typeof CALLBACK_TAG
}

/**
 * The decision both inbound webhooks apply the moment a call/text arrives —
 * BEFORE any routing, so a missed callback is flagged exactly like an
 * answered one. Null = not a dropped contact coming back; do nothing.
 */
export function attributeCallback(args: {
  contactId: string | null
  calls: DroppedCallRow[]
  now: Date
}): CallbackDecision | null {
  if (!args.contactId) return null
  if (!hasRecentDrop(args.calls, args.now)) return null
  return { tag: CALLBACK_TAG }
}
