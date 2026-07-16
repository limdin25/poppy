import { supabaseAdmin } from '../../src/integrations/supabase/client.js'
import { requireAdmin } from '../lib/require-admin.js'

export const config = { runtime: 'edge' };

/**
 * CRM AI agent (Maya) ↔ Retell bridge for /admin/crm/agent.
 *
 * GET  → Maya's live Retell state (agent + LLM), used to seed the UI the first
 *        time (before any wk_agent_channel_settings voice row has been saved).
 * POST → read the saved voice row from wk_agent_channel_settings and push it
 *        to Retell: PATCH the LLM (prompt/greeting/model — general_tools are
 *        NEVER sent, so the book_appointment tool survives), PATCH the agent
 *        (voice/call-feel params), then publish.
 *
 * Maya deliberately has no agents-table row (the nightly sync-prompts cron
 * would rebuild her pitch from heyelsie business data) — this endpoint is her
 * ONLY write path. Auth = admin_users allow-list, same as the CRM admin pages.
 */

const RETELL = 'https://api.retellai.com'
const MAYA_AGENT_ID = process.env.CRM_WARMUP_AGENT_ID || 'agent_6ee23884400896ee15e314ca91'

const RETELL_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-6': 'claude-4.6-sonnet',
  'claude-sonnet-4-5': 'claude-4.5-sonnet',
  'claude-haiku-4-5': 'claude-4.5-haiku',
}
const toRetellModel = (m: string | null | undefined) => (m ? RETELL_MODEL_MAP[m] || m : 'claude-4.6-sonnet')
const fromRetellModel = (m: string | null | undefined) => {
  const rev = Object.entries(RETELL_MODEL_MAP).find(([, v]) => v === m)
  return rev ? rev[0] : m || 'claude-sonnet-4-6'
}

function headers() {
  return { Authorization: `Bearer ${process.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' }
}

async function getMaya(): Promise<{ agent: Record<string, unknown>; llm: Record<string, unknown> } | Response> {
  const agentRes = await fetch(`${RETELL}/get-agent/${MAYA_AGENT_ID}`, { headers: headers() })
  if (!agentRes.ok) return Response.json({ error: `Retell get-agent failed: ${await agentRes.text()}` }, { status: 502 })
  const agent = (await agentRes.json()) as Record<string, unknown>
  const llmId = (agent.response_engine as { llm_id?: string } | undefined)?.llm_id
  if (!llmId) return Response.json({ error: 'Agent has no retell-llm response engine' }, { status: 502 })
  const llmRes = await fetch(`${RETELL}/get-retell-llm/${llmId}`, { headers: headers() })
  if (!llmRes.ok) return Response.json({ error: `Retell get-retell-llm failed: ${await llmRes.text()}` }, { status: 502 })
  return { agent, llm: (await llmRes.json()) as Record<string, unknown> }
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate

  if (req.method === 'GET') {
    const live = await getMaya()
    if (live instanceof Response) return live
    const { agent, llm } = live
    return Response.json({
      agent_id: MAYA_AGENT_ID,
      llm_id: llm.llm_id,
      prompt: llm.general_prompt || '',
      greeting: llm.begin_message || '',
      model: fromRetellModel(llm.model as string),
      start_speaker: llm.start_speaker || 'agent',
      voice: {
        voice_id: agent.voice_id || 'cartesia-Willa',
        voice_speed: agent.voice_speed ?? 1,
        enable_dynamic_voice_speed: agent.enable_dynamic_voice_speed === true,
        voice_emotion: agent.voice_emotion || null,
        volume: agent.volume ?? 1,
        interruption_sensitivity: agent.interruption_sensitivity ?? 0.7,
        responsiveness: agent.responsiveness ?? 0.7,
        reminder_trigger_seconds: agent.reminder_trigger_ms != null ? Math.round((agent.reminder_trigger_ms as number) / 1000) : null,
        reminder_max_count: agent.reminder_max_count ?? null,
        ambient_sound: agent.ambient_sound || null,
        max_call_duration_seconds: agent.max_call_duration_ms != null ? Math.round((agent.max_call_duration_ms as number) / 1000) : 3600,
        backchannel_enabled: agent.enable_backchannel === true,
        backchannel_frequency: agent.backchannel_frequency ?? 0.8,
        begin_delay_ms: agent.begin_message_delay_ms ?? 0,
        end_silence_seconds: agent.end_call_after_silence_ms != null ? Math.round((agent.end_call_after_silence_ms as number) / 1000) : null,
        voicemail_hangup: (agent.voicemail_option as { action?: { type?: string } } | null)?.action?.type === 'hang_up',
        allow_keypad: agent.allow_user_dtmf !== false,
      },
    })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  // Load the saved voice settings — the single source of truth after first save.
  const { data: row, error } = await supabaseAdmin
    .from('wk_agent_channel_settings')
    .select('greeting, system_prompt, model, voice_config')
    .eq('channel', 'voice')
    .maybeSingle()
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!row || !row.system_prompt) return Response.json({ error: 'No saved voice settings to sync' }, { status: 400 })

  const vc = (row.voice_config || {}) as Record<string, unknown>

  // {{current_date}} in a hand-written prompt always resolves to today.
  const todayStr = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: (vc.timezone as string) || 'Europe/London',
  }).format(new Date())
  let prompt = (row.system_prompt as string).replace(/\{\{\s*current_date\s*\}\}/gi, todayStr)

  const pron = (vc.pronunciation_notes as string | undefined)?.trim()
  if (pron) prompt += `\n\n## Pronunciation\nPronounce these the way the caller expects:\n${pron}`

  const live = await getMaya()
  if (live instanceof Response) return live
  const llmId = live.llm.llm_id as string

  // 1. LLM: prompt + greeting + model. general_tools deliberately omitted.
  const llmRes = await fetch(`${RETELL}/update-retell-llm/${llmId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({
      general_prompt: prompt,
      begin_message: row.greeting || null,
      start_speaker: (vc.start_speaker as string) || (row.greeting ? 'agent' : 'user'),
      model: toRetellModel(row.model as string),
    }),
  })
  if (!llmRes.ok) return Response.json({ error: `Retell LLM update failed: ${await llmRes.text()}` }, { status: 502 })

  // 2. Agent: voice + call-feel params (same mapping as api/agent/sync-prompt).
  const voiceId = (vc.voice_id as string) || ''
  const supportsEmotion = /^(cartesia|minimax)-/i.test(voiceId)
  const reminderSec = vc.reminder_trigger_seconds as number | null | undefined
  const endSilenceSec = vc.end_silence_seconds as number | null | undefined
  const voicemailHangup = vc.voicemail_hangup as boolean | null | undefined
  const agentPayload: Record<string, unknown> = {
    voice_id: voiceId || undefined,
    voice_speed: (vc.voice_speed as number) || undefined,
    voice_model: supportsEmotion ? 'sonic-3.5' : undefined,
    voice_emotion: supportsEmotion ? ((vc.voice_emotion as string | null | undefined) ?? undefined) : undefined,
    volume: (vc.volume as number | null | undefined) ?? undefined,
    enable_dynamic_voice_speed: (vc.enable_dynamic_voice_speed as boolean | null | undefined) ?? undefined,
    interruption_sensitivity: (vc.interruption_sensitivity as number | null | undefined) ?? undefined,
    responsiveness: (vc.responsiveness as number | null | undefined) ?? undefined,
    reminder_trigger_ms: reminderSec != null ? reminderSec * 1000 : undefined,
    reminder_max_count: (vc.reminder_max_count as number | null | undefined) ?? undefined,
    ambient_sound: (vc.ambient_sound as string | null | undefined),
    max_call_duration_ms: vc.max_call_duration_seconds != null ? Math.max(60, vc.max_call_duration_seconds as number) * 1000 : undefined,
    enable_backchannel: (vc.backchannel_enabled as boolean | null | undefined) ?? undefined,
    backchannel_frequency: (vc.backchannel_frequency as number | null | undefined) ?? undefined,
    begin_message_delay_ms: (vc.begin_delay_ms as number | null | undefined) ?? undefined,
    end_call_after_silence_ms: endSilenceSec != null ? Math.max(10000, endSilenceSec * 1000) : undefined,
    allow_user_dtmf: (vc.allow_keypad as boolean | null | undefined) ?? undefined,
    voicemail_option: voicemailHangup == null ? undefined : (voicemailHangup ? { action: { type: 'hang_up' } } : null),
  }
  Object.keys(agentPayload).forEach((k) => { if (agentPayload[k] === undefined) delete agentPayload[k] })

  const agentRes = await fetch(`${RETELL}/update-agent/${MAYA_AGENT_ID}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(agentPayload),
  })
  if (!agentRes.ok) return Response.json({ error: `Retell agent update failed: ${await agentRes.text()}` }, { status: 502 })
  const updatedAgent = (await agentRes.json().catch(() => ({}))) as { version?: number }

  // 3. Publish that exact draft version so inbound calls on 833 pick it up
  //    (same sequence as api/agent/sync-prompt).
  const pubRes = await fetch(`${RETELL}/publish-agent/${MAYA_AGENT_ID}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(updatedAgent.version != null ? { version: updatedAgent.version } : {}),
  })
  if (!pubRes.ok) return Response.json({ error: `Retell publish failed: ${await pubRes.text()}` }, { status: 502 })

  return Response.json({ ok: true, version: updatedAgent.version ?? null })
}
