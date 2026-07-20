import { describe, it, expect } from 'vitest'
import { buildDropTwiml, canDropVoicemail } from '../api/lib/voicemail-drop.js'

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
