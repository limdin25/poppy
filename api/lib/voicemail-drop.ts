// Voicemail-drop core for the CRM speed dialer (agent-pressed drop).
//
// The agent hears the voicemail greeting and taps "Drop VM": the contact
// (child) call leg gets its TwiML replaced with <Play>{recording}</Play>
// <Hangup/>, which pulls it out of the bridge, plays the campaign message
// into the voicemail box and hangs up. The agent leg is freed client-side.
//
// This module is the canonical, vitest-covered copy of the logic; the Deno
// edge function `supabase/functions/wk-voicemail-drop/index.ts` keeps a thin
// mirror (Deno deploy can't import from api/). If you change one, change the
// other — tests/voicemail-drop.test.ts pins the contract.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * TwiML that replaces the contact leg's executing document at drop time.
 * The url is XML-escaped — never interpolate it raw (ghost-dialer's bug).
 */
export function buildDropTwiml(recordingUrl: string): string {
  const url = recordingUrl.trim()
  if (!url) throw new Error('recordingUrl is required')
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`recordingUrl must be an http(s) URL: ${url}`)
  return `<Response><Play>${escapeXml(url)}</Play><Hangup/></Response>`
}

export interface DropEligibility {
  /** Dialer machine phase — a drop only makes sense mid-bridge. */
  phase: string
  /** Campaign's uploaded drop recording (public url), if any. */
  recordingUrl: string | null | undefined
  /** Campaign's voicemail_drop_enabled toggle. */
  dropEnabled: boolean
  /** True once this call already had a drop (voicemail_dropped). */
  alreadyDropped: boolean
}

/** Single source of truth for the Drop VM button state AND the server guard. */
export function canDropVoicemail(e: DropEligibility): boolean {
  return e.phase === 'connected' && Boolean(e.recordingUrl) && e.dropEnabled && !e.alreadyDropped
}

// ---------------------------------------------------------------------------
// Drop executor — the decision logic of the wk-voicemail-drop edge function.

const TERMINAL_STATUSES = new Set([
  'completed', 'canceled', 'failed', 'no_answer', 'busy', 'missed', 'voicemail',
])

interface CallRow {
  id: string
  agent_id: string | null
  campaign_id: string | null
  status: string
  twilio_call_sid: string | null
  contact_twilio_call_sid: string | null
  voicemail_dropped: boolean
}

interface CampaignRow {
  voicemail_recording_url: string | null
  voicemail_drop_enabled: boolean
}

export interface VoicemailDropDeps {
  /** Supabase client (service role) — only .from() chains are used. */
  supabase: { from(table: string): any }
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  twilioAccountSid: string
  twilioAuthToken: string
}

export interface VoicemailDropRequest {
  callId: string
  agentId: string
  isAdmin: boolean
}

export interface VoicemailDropResult {
  status: number
  body: Record<string, unknown>
}

/**
 * Play the campaign's voicemail recording into the contact leg of a live
 * dialer call, then mark wk_calls.voicemail_dropped. Targets the CHILD
 * (contact PSTN) leg: replacing its TwiML pulls it out of the bridge, so
 * Twilio runs the <Dial> action on the agent leg and frees the agent.
 * Contact-leg SID comes from the Option A statusCallback capture; if that
 * webhook hasn't landed yet we derive it via a ParentCallSid lookup.
 */
export async function executeVoicemailDrop(
  deps: VoicemailDropDeps,
  req: VoicemailDropRequest,
): Promise<VoicemailDropResult> {
  const { supabase, fetchFn, twilioAccountSid, twilioAuthToken } = deps
  const callId = req.callId.trim()
  if (!callId) return { status: 400, body: { error: 'call_id required' } }

  const { data: call, error: callErr } = await supabase
    .from('wk_calls')
    .select('id, agent_id, campaign_id, status, twilio_call_sid, contact_twilio_call_sid, voicemail_dropped')
    .eq('id', callId)
    .maybeSingle()
  if (callErr) return { status: 500, body: { error: callErr.message } }
  if (!call) return { status: 404, body: { error: 'Call not found' } }
  const row = call as CallRow

  if (row.agent_id && row.agent_id !== req.agentId && !req.isAdmin) {
    return { status: 403, body: { error: 'Not your call' } }
  }
  if (row.voicemail_dropped) {
    return { status: 200, body: { ok: true, already_dropped: true } }
  }
  if (TERMINAL_STATUSES.has(row.status)) {
    return { status: 409, body: { error: `Call already ended (${row.status})` } }
  }
  if (!row.campaign_id) return { status: 400, body: { error: 'Call has no campaign' } }

  const { data: campaign } = await supabase
    .from('wk_dialer_campaigns')
    .select('voicemail_recording_url, voicemail_drop_enabled')
    .eq('id', row.campaign_id)
    .maybeSingle()
  const camp = campaign as CampaignRow | null
  if (!camp?.voicemail_recording_url) {
    return { status: 400, body: { error: 'No voicemail recording uploaded for this campaign' } }
  }
  if (!camp.voicemail_drop_enabled) {
    return { status: 400, body: { error: 'Voicemail drop is disabled for this campaign' } }
  }

  const authHeader =
    'Basic ' + (typeof btoa !== 'undefined'
      ? btoa(`${twilioAccountSid}:${twilioAuthToken}`)
      : Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64'))

  // Resolve the contact (child) leg SID — Option A capture, else Option B derive.
  let contactSid = row.contact_twilio_call_sid
  if (!contactSid) {
    if (!row.twilio_call_sid) {
      return { status: 409, body: { error: 'Call has no Twilio SID yet' } }
    }
    const lookup = await fetchFn(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json?ParentCallSid=${row.twilio_call_sid}`,
      { headers: { Authorization: authHeader } },
    )
    if (lookup.ok) {
      const json = (await lookup.json()) as { calls?: Array<{ sid?: string }> }
      contactSid = json.calls?.[0]?.sid ?? null
    }
    if (!contactSid) {
      return { status: 409, body: { error: 'Contact leg not found — has the call connected?' } }
    }
  }

  const tw = await fetchFn(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls/${contactSid}.json`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Twiml: buildDropTwiml(camp.voicemail_recording_url) }).toString(),
    },
  )
  if (!tw.ok) {
    const detail = await tw.text().catch(() => '')
    return { status: 502, body: { error: 'Twilio rejected the drop', detail } }
  }

  const { error: updErr } = await supabase
    .from('wk_calls')
    .update({ voicemail_dropped: true, voicemail_dropped_at: new Date().toISOString() })
    .eq('id', callId)
  if (updErr) return { status: 500, body: { error: updErr.message, dropped: true } }

  return { status: 200, body: { ok: true, contact_call_sid: contactSid } }
}
