import { describe, it, expect } from 'vitest'
import { buildOutgoingTwiml } from '../src/features/crm/lib/buildOutgoingTwiml'

// Voicemail drop, Option A: the <Number> child leg must announce itself to
// wk-voice-status the moment it answers, so contact_twilio_call_sid is
// captured and the drop can target the contact leg without a REST lookup.
// (Without this, the child leg never posts a status webhook and the SID
// stays NULL — the pre-build audit's one gotcha.)
const BASE = {
  to: '+447863992555',
  callerIdE164: '+447380308316',
  statusUrl: 'https://x.supabase.co/functions/v1/wk-voice-status',
  recordingUrl: 'https://x.supabase.co/functions/v1/wk-voice-recording',
  transcriptionCallbackUrl: null,
}

describe('buildOutgoingTwiml — contact-leg statusCallback (VM drop Option A)', () => {
  it('gives <Number> a statusCallback pointing at wk-voice-status', () => {
    const out = buildOutgoingTwiml(BASE)
    expect(out).toContain('<Number statusCallback="https://x.supabase.co/functions/v1/wk-voice-status"')
    expect(out).toContain('statusCallbackEvent="answered"')
    expect(out).toContain('>+447863992555</Number>')
  })

  it('XML-escapes the statusCallback url', () => {
    const out = buildOutgoingTwiml({ ...BASE, statusUrl: 'https://x.test/cb?a=1&b=2' })
    expect(out).toContain('<Number statusCallback="https://x.test/cb?a=1&amp;b=2"')
  })

  it('keeps the <Dial> action + recording attributes unchanged', () => {
    const out = buildOutgoingTwiml(BASE)
    expect(out).toContain('record="record-from-answer-dual"')
    expect(out).toContain('action="https://x.supabase.co/functions/v1/wk-voice-status"')
    expect(out).toContain('answerOnBridge="true"')
  })
})
