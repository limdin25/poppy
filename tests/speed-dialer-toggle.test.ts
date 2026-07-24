import { describe, it, expect, beforeEach } from 'vitest'
// The suite runs in the node environment (no jsdom installed), so stand up a
// minimal localStorage before importing anything that reads it at module load.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
})

const { reducer, INITIAL, LS_KEY, readPauseAfterCall } = await import(
  '../src/features/crm/dialer-pro/reducer'
)
const { isSpeedDialerOn, SPEED_DIALER_LS_KEY } = await import(
  '../src/features/crm/lib/speedDialer'
)

// Hugo 2026-07-24: "sometimes even when the speed is off ... the dialer just
// starts on its own". Two defects behind it, both pinned here:
//   1. Every auto-advance path kept its own private copy of the toggle, so
//      Speed: OFF only ever reached dialer-pro's state machine.
//   2. STOP restored INITIAL, whose pauseAfterCall was a module-load snapshot
//      of localStorage — so Stop resurrected the old value.

describe('speed dialer toggle — one source of truth', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads ON when the key is absent (default)', () => {
    expect(isSpeedDialerOn()).toBe(true)
  })

  it('reads OFF when the status bar has paused the dialer', () => {
    localStorage.setItem(SPEED_DIALER_LS_KEY, 'true')
    expect(isSpeedDialerOn()).toBe(false)
  })

  it('reads ON again once the agent flips it back', () => {
    localStorage.setItem(SPEED_DIALER_LS_KEY, 'true')
    localStorage.setItem(SPEED_DIALER_LS_KEY, 'false')
    expect(isSpeedDialerOn()).toBe(true)
  })

  it('shares the exact key the dialer-pro reducer uses', () => {
    expect(SPEED_DIALER_LS_KEY).toBe(LS_KEY)
  })

  it('is the inverse of the reducer pause flag', () => {
    localStorage.setItem(SPEED_DIALER_LS_KEY, 'true')
    expect(readPauseAfterCall()).toBe(!isSpeedDialerOn())
    localStorage.setItem(SPEED_DIALER_LS_KEY, 'false')
    expect(readPauseAfterCall()).toBe(!isSpeedDialerOn())
  })
})

describe('dialer reducer — STOP re-reads the toggle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps Speed: OFF after Stop even though INITIAL was captured with it ON', () => {
    // INITIAL was evaluated at module load with no key set → pauseAfterCall false.
    expect(INITIAL.pauseAfterCall).toBe(false)

    // Agent flips Speed: OFF mid-session, then presses Stop.
    localStorage.setItem(LS_KEY, 'true')
    const paused = reducer({ ...INITIAL }, { type: 'PAUSE_AFTER_CALL', value: true })
    const stopped = reducer(paused, { type: 'STOP' })

    expect(stopped.pauseAfterCall).toBe(true)
    expect(stopped.phase).toBe('idle')
  })

  it('keeps Speed: ON after Stop', () => {
    localStorage.setItem(LS_KEY, 'false')
    const stopped = reducer({ ...INITIAL }, { type: 'STOP' })
    expect(stopped.pauseAfterCall).toBe(false)
  })

  it('still clears the rest of the session state on Stop', () => {
    localStorage.setItem(LS_KEY, 'true')
    const stopped = reducer(
      { ...INITIAL, phase: 'connected', currentCallId: 'call-1', sessionStarted: true },
      { type: 'STOP' },
    )
    expect(stopped.currentCallId).toBeNull()
    expect(stopped.sessionStarted).toBe(false)
  })
})
