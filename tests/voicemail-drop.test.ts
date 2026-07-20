import { describe, it, expect } from 'vitest'
import { buildDropTwiml, canDropVoicemail, executeVoicemailDrop } from '../api/lib/voicemail-drop.js'

// Behaviour 1 — drop TwiML builder. The <Play> URL is interpolated into XML;
// ghost-dialer's unescaped interpolation bug is the anti-pattern these pin.
describe('buildDropTwiml', () => {
  it('wraps the recording url in <Play> followed by <Hangup/>', () => {
    const xml = buildDropTwiml('https://x.supabase.co/storage/v1/object/public/crm-attachments/vm/drop.mp3')
    expect(xml).toBe(
      '<Response><Play>https://x.supabase.co/storage/v1/object/public/crm-attachments/vm/drop.mp3</Play><Hangup/></Response>',
    )
  })

  it('XML-escapes the url — & and quotes cannot break out of the element', () => {
    const xml = buildDropTwiml('https://cdn.example.com/drop.mp3?a=1&b="2"')
    expect(xml).toContain('<Play>https://cdn.example.com/drop.mp3?a=1&amp;b=&quot;2&quot;</Play>')
    expect(xml).not.toContain('&b=')
  })

  it('rejects an injected element in the url', () => {
    const xml = buildDropTwiml('https://cdn.example.com/a.mp3<Hangup/>')
    expect(xml).toContain('&lt;Hangup/&gt;</Play>')
  })

  it('throws on an empty url', () => {
    expect(() => buildDropTwiml('')).toThrow()
    expect(() => buildDropTwiml('   ')).toThrow()
  })

  it('throws on a non-http(s) url', () => {
    expect(() => buildDropTwiml('ftp://cdn.example.com/drop.mp3')).toThrow()
    expect(() => buildDropTwiml('javascript:alert(1)')).toThrow()
    expect(() => buildDropTwiml('not a url')).toThrow()
  })
})

// Behaviour 2 — eligibility. Drives both the Drop VM button's disabled state
// and the server-side guard in wk-voicemail-drop.
describe('canDropVoicemail', () => {
  const eligible = {
    phase: 'connected',
    recordingUrl: 'https://x.co/drop.mp3',
    dropEnabled: true,
    alreadyDropped: false,
  } as const

  it('true only when connected + recording + enabled + not already dropped', () => {
    expect(canDropVoicemail({ ...eligible })).toBe(true)
  })

  it('false when the call is not connected', () => {
    for (const phase of ['idle', 'dialing', 'ringing', 'wrap_up', 'paused']) {
      expect(canDropVoicemail({ ...eligible, phase })).toBe(false)
    }
  })

  it('false when the campaign has no recording', () => {
    expect(canDropVoicemail({ ...eligible, recordingUrl: null })).toBe(false)
    expect(canDropVoicemail({ ...eligible, recordingUrl: undefined })).toBe(false)
    expect(canDropVoicemail({ ...eligible, recordingUrl: '' })).toBe(false)
  })

  it('false when the campaign toggle is off', () => {
    expect(canDropVoicemail({ ...eligible, dropEnabled: false })).toBe(false)
  })

  it('false when this call already had a drop', () => {
    expect(canDropVoicemail({ ...eligible, alreadyDropped: true })).toBe(false)
  })
})

// Behaviour 3 — the drop executor. Canonical copy of the wk-voicemail-drop
// edge function's decision logic (the Deno index.ts mirrors this).
const SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const TOKEN = 'auth-token'

const CALL = {
  id: 'call-1',
  agent_id: 'agent-1',
  campaign_id: 'camp-1',
  status: 'in_progress',
  twilio_call_sid: 'CAparent000000000000000000000000000',
  contact_twilio_call_sid: 'CAchild0000000000000000000000000000',
  voicemail_dropped: false,
}
const CAMPAIGN = {
  voicemail_recording_url: 'https://x.supabase.co/storage/v1/object/public/crm-attachments/vm/drop.mp3',
  voicemail_drop_enabled: true,
}

function makeSupabase(cfg: {
  call?: Record<string, unknown> | null
  campaign?: Record<string, unknown> | null
  updateError?: { message: string } | null
}) {
  const updates: Array<{ table: string; payload: Record<string, unknown>; eq: [string, unknown] }> = []
  const from = (table: string) => {
    const row = () =>
      table === 'wk_calls' ? cfg.call ?? null : table === 'wk_dialer_campaigns' ? cfg.campaign ?? null : null
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) c[m] = () => c
    c.maybeSingle = () => Promise.resolve({ data: row(), error: null })
    c.update = (payload: Record<string, unknown>) => ({
      eq: (col: string, val: unknown) => {
        updates.push({ table, payload, eq: [col, val] })
        return Promise.resolve({ error: cfg.updateError ?? null })
      },
    })
    return c
  }
  return { supabase: { from }, updates }
}

function makeFetch(cfg: { children?: Array<{ sid: string }>; lookupFails?: boolean; dropFails?: boolean } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init })
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      if (cfg.lookupFails) return new Response('boom', { status: 500 })
      return new Response(JSON.stringify({ calls: cfg.children ?? [] }), { status: 200 })
    }
    if (cfg.dropFails) return new Response('{"message":"no such call"}', { status: 404 })
    return new Response('{}', { status: 200 })
  }
  return { fetchFn, requests }
}

function deps(supa: ReturnType<typeof makeSupabase>, f: ReturnType<typeof makeFetch>) {
  return { supabase: supa.supabase, fetchFn: f.fetchFn, twilioAccountSid: SID, twilioAuthToken: TOKEN }
}

describe('executeVoicemailDrop', () => {
  it('404s when the call row does not exist', async () => {
    const supa = makeSupabase({ call: null })
    const res = await executeVoicemailDrop(deps(supa, makeFetch()), {
      callId: 'nope', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(404)
  })

  it("403s when the call belongs to another agent (and caller isn't admin)", async () => {
    const supa = makeSupabase({ call: CALL, campaign: CAMPAIGN })
    const f = makeFetch()
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'someone-else', isAdmin: false,
    })
    expect(res.status).toBe(403)
    expect(f.requests).toHaveLength(0)
  })

  it('lets an admin drop on any call', async () => {
    const supa = makeSupabase({ call: CALL, campaign: CAMPAIGN })
    const res = await executeVoicemailDrop(deps(supa, makeFetch()), {
      callId: 'call-1', agentId: 'someone-else', isAdmin: true,
    })
    expect(res.status).toBe(200)
  })

  it('400s when the campaign has no recording', async () => {
    const supa = makeSupabase({ call: CALL, campaign: { ...CAMPAIGN, voicemail_recording_url: null } })
    const f = makeFetch()
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(400)
    expect(f.requests).toHaveLength(0)
  })

  it('400s when the campaign drop toggle is off', async () => {
    const supa = makeSupabase({ call: CALL, campaign: { ...CAMPAIGN, voicemail_drop_enabled: false } })
    const res = await executeVoicemailDrop(deps(supa, makeFetch()), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(400)
  })

  it('409s when the call is already terminal', async () => {
    const supa = makeSupabase({ call: { ...CALL, status: 'completed' }, campaign: CAMPAIGN })
    const res = await executeVoicemailDrop(deps(supa, makeFetch()), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(409)
  })

  it('no-ops (200, no Twilio call) when the call already had a drop', async () => {
    const supa = makeSupabase({ call: { ...CALL, voicemail_dropped: true }, campaign: CAMPAIGN })
    const f = makeFetch()
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(200)
    expect(res.body.already_dropped).toBe(true)
    expect(f.requests).toHaveLength(0)
  })

  it('happy path: POSTs the drop TwiML at the contact leg and marks the call dropped', async () => {
    const supa = makeSupabase({ call: CALL, campaign: CAMPAIGN })
    const f = makeFetch()
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(200)
    expect(f.requests).toHaveLength(1)
    const drop = f.requests[0]
    expect(drop.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls/${CALL.contact_twilio_call_sid}.json`)
    expect(drop.init?.method).toBe('POST')
    const body = String(drop.init?.body)
    expect(decodeURIComponent(body.replace(/\+/g, ' '))).toContain(
      `Twiml=<Response><Play>${CAMPAIGN.voicemail_recording_url}</Play><Hangup/></Response>`,
    )
    const marked = supa.updates.find((u) => u.table === 'wk_calls')
    expect(marked?.payload.voicemail_dropped).toBe(true)
    expect(typeof marked?.payload.voicemail_dropped_at).toBe('string')
    expect(marked?.eq).toEqual(['id', 'call-1'])
  })

  it('falls back to a ParentCallSid lookup when the contact leg SID was not captured', async () => {
    const supa = makeSupabase({ call: { ...CALL, contact_twilio_call_sid: null }, campaign: CAMPAIGN })
    const f = makeFetch({ children: [{ sid: 'CAderived00000000000000000000000000' }] })
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(200)
    expect(f.requests).toHaveLength(2)
    expect(f.requests[0].url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json?ParentCallSid=${CALL.twilio_call_sid}`,
    )
    expect(f.requests[1].url).toContain('CAderived00000000000000000000000000')
  })

  it('409s when no contact leg can be resolved', async () => {
    const supa = makeSupabase({ call: { ...CALL, contact_twilio_call_sid: null }, campaign: CAMPAIGN })
    const f = makeFetch({ children: [] })
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(409)
    const marked = supa.updates.find((u) => u.table === 'wk_calls')
    expect(marked).toBeUndefined()
  })

  it('502s (and does not mark dropped) when Twilio rejects the drop', async () => {
    const supa = makeSupabase({ call: CALL, campaign: CAMPAIGN })
    const f = makeFetch({ dropFails: true })
    const res = await executeVoicemailDrop(deps(supa, f), {
      callId: 'call-1', agentId: 'agent-1', isAdmin: false,
    })
    expect(res.status).toBe(502)
    const marked = supa.updates.find((u) => u.table === 'wk_calls')
    expect(marked).toBeUndefined()
  })
})
