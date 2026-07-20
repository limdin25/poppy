import { describe, it, expect } from 'vitest'
import { buildDropTwiml } from '../api/lib/voicemail-drop.js'

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
