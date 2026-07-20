import { describe, it, expect } from 'vitest'
import { reducer, INITIAL } from '../src/features/crm/dialer-pro/reducer'
import type { QueueLead } from '../src/features/crm/dialer-pro/types'

// Behaviour 4 — dialer machine wiring for the voicemail drop. The reducer is
// a pure function extracted from useDialerMachine so vitest can pin it
// (src/features/crm/** is excluded as a test *location*, not as an import).
const LEAD: QueueLead = {
  id: 'l1',
  contactId: 'c1',
  phone: '+15551230000',
  name: 'Test Lead',
  priority: 1,
  attempts: 0,
  scheduledFor: null,
  status: 'pending',
  campaignId: 'camp-1',
  pipelineColumnId: null,
  queueRowId: 'q1',
}

function connectedState() {
  const dialed = reducer({ ...INITIAL }, { type: 'DIAL_START', lead: LEAD, callId: 'call-1' })
  return reducer(dialed, { type: 'CONNECTED' })
}

describe('dialer reducer — VOICEMAIL_DROPPED', () => {
  it('starts with voicemailDropped=false', () => {
    expect(INITIAL.voicemailDropped).toBe(false)
  })

  it('marks the call dropped while connected', () => {
    const s = reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' })
    expect(s.voicemailDropped).toBe(true)
  })

  it('keeps the flag through CALL_ENDED so wrap-up can show it', () => {
    let s = reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' })
    s = reducer(s, { type: 'CALL_ENDED', reason: 'vm_drop' })
    expect(s.phase).toBe('wrap_up')
    expect(s.voicemailDropped).toBe(true)
  })

  it('resets on the next DIAL_START', () => {
    let s = reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' })
    s = reducer(s, { type: 'CALL_ENDED', reason: 'vm_drop' })
    s = reducer(s, { type: 'OUTCOME_DONE' })
    s = reducer(s, { type: 'DIAL_START', lead: LEAD, callId: 'call-2' })
    expect(s.voicemailDropped).toBe(false)
  })

  it('resets on STOP', () => {
    const s = reducer(reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' }), { type: 'STOP' })
    expect(s.voicemailDropped).toBe(false)
  })
})

describe('dialer reducer — sessionDrops tally (live session counter)', () => {
  it('increments per drop and survives DIAL_START (session-scoped, not per-call)', () => {
    let s = reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' })
    expect(s.sessionDrops).toBe(1)
    s = reducer(s, { type: 'CALL_ENDED', reason: 'vm_drop' })
    s = reducer(s, { type: 'OUTCOME_DONE' })
    s = reducer(s, { type: 'DIAL_START', lead: LEAD, callId: 'call-2' })
    expect(s.sessionDrops).toBe(1)
    s = reducer(reducer(s, { type: 'CONNECTED' }), { type: 'VOICEMAIL_DROPPED' })
    expect(s.sessionDrops).toBe(2)
  })

  it('resets on STOP (session over)', () => {
    const s = reducer(reducer(connectedState(), { type: 'VOICEMAIL_DROPPED' }), { type: 'STOP' })
    expect(s.sessionDrops).toBe(0)
  })
})
