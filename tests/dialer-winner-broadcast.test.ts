import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-24: "I was on the leaderboard page and my agent started calling
// on his browser — on my browser it opened the room. If they start calling, on
// my end should not open nothing."
//
// wk-dialer-answer / wk-voice-status broadcast the winner on
// `dialer:<agent_id>`, so EVERY browser and tab signed in as that agent gets
// it — not only the one on the call. The handler used to take over all of them
// with a full-screen call room for a conversation they weren't part of, and
// that room's End call button fires wk-dialer-hangup-leg SERVER-SIDE: one
// click on a bystander screen would have hung up the agent's live call.
//
// These pin the guard. src/features/crm/** is excluded as a test *location*
// (no jsdom in this suite), so this is a source contract, same style as
// wk-voice-transcription.contract.test.ts.

const src = readFileSync(
  resolve(__dirname, '../src/features/crm/components/live-call/ActiveCallContext.tsx'),
  'utf8',
)

// The winner handler: from the broadcast registration to the end of its body.
const handler = (() => {
  const start = src.indexOf("{ event: 'winner' }")
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('.subscribe()', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
})()

describe('dialer winner broadcast — only the browser on the call takes the screen', () => {
  it('checks this browser actually holds a Twilio call', () => {
    expect(handler).toMatch(/getDeviceCalls\(\)\.length\s*>\s*0/)
  })

  it('also accepts the browser that pressed Start and is waiting in placing', () => {
    // The Device leg can land a beat after the broadcast on the real dialer
    // browser — without this it would ignore its own winner and never morph.
    expect(handler).toMatch(/phaseRef\.current\s*===\s*'placing'/)
  })

  it('bails out BEFORE touching call state', () => {
    const guard = handler.search(/if\s*\(!onThisBrowser\)/)
    expect(guard).toBeGreaterThan(-1)
    for (const takeover of ["setPhase('in_call')", 'setFullScreen(true)', 'setCall({']) {
      expect(handler.indexOf(takeover)).toBeGreaterThan(guard)
    }
  })

  it('reads the phase through a ref, not a stale closure', () => {
    // The subscribe effect deps are [store] — it does not re-run per phase
    // change, so reading `phase` directly would be frozen at 'idle' forever.
    expect(src).toMatch(/const phaseRef = useRef<CallPhase>\(phase\)/)
    expect(src).toMatch(/phaseRef\.current = phase/)
    expect(handler).not.toMatch(/[^.]\bphase\s*===\s*'placing'/)
  })
})

describe('why the guard matters — End call is not cosmetic', () => {
  it('endCall hangs the far leg up server-side', () => {
    expect(src).toMatch(/invoke\('wk-dialer-hangup-leg'/)
  })
})
