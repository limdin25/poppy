import { describe, it, expect } from 'vitest'
import { countVoicemailDrops, voicemailDropsByAgent } from '../src/features/crm/lib/callStats'

// Behaviour 7 — drop-count aggregation shared by reports + dashboard.
const rows = [
  { agent_id: 'a1', voicemail_dropped: true },
  { agent_id: 'a1', voicemail_dropped: false },
  { agent_id: 'a2', voicemail_dropped: true },
  { agent_id: 'a1', voicemail_dropped: true },
  { agent_id: null, voicemail_dropped: true },
  { agent_id: 'a3', voicemail_dropped: false },
]

describe('countVoicemailDrops', () => {
  it('counts only rows with voicemail_dropped=true', () => {
    expect(countVoicemailDrops(rows)).toBe(4)
  })

  it('is 0 for empty input and tolerant of a missing column', () => {
    expect(countVoicemailDrops([])).toBe(0)
    expect(countVoicemailDrops([{ agent_id: 'a1' }, { agent_id: 'a2', voicemail_dropped: null }])).toBe(0)
  })
})

describe('voicemailDropsByAgent', () => {
  it('groups drop counts per agent (null agent under "unknown")', () => {
    const m = voicemailDropsByAgent(rows)
    expect(m.get('a1')).toBe(2)
    expect(m.get('a2')).toBe(1)
    expect(m.get('unknown')).toBe(1)
    expect(m.get('a3')).toBeUndefined()
  })
})
