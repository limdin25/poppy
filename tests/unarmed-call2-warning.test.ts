// A call 2 script with no armed figures must say so above the fold.
//
// Found 2026-08-18 on Friars Close, Wirral: the disposition had moved the
// branch to "Ready for call 2", which arms the OFFER script (callModeForCard,
// promote-only), but nobody had pressed apply on the ballpark, so every money
// slot rendered as a raw empty bracket. The offer strip's own "no offer band"
// warning exists but the strip starts folded in the dialer, so nothing visible
// said stop. Hugo, same day: "It doesn't say how much to open at ... our CRM
// is proper broke." It was not broke, it was silent, which reads the same.
//
// Source-reading pin, same style as inbound-property-room.test.ts: the banner
// is a render branch, and this wiring is only otherwise provable by opening a
// real unarmed card.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const ROOM = readFileSync(
  resolve(root, 'src/features/crm/components/live-call/PropertyCallRoom.tsx'), 'utf8')

describe('the unarmed call 2 warning', () => {
  it('exists in the room', () => {
    expect(ROOM).toContain('data-testid="unarmed-call2-warning"')
  })

  it('is keyed to the offer mode AND the same token the script fills from', () => {
    // The banner must show exactly when the slots are empty: same source of
    // truth as DialerScriptPane's extraTokens (openerTokens), not a separate
    // read that can drift.
    expect(ROOM).toMatch(
      /callMode === 'offer' && !\(openerTokens\.offer_open \?\? ''\)\.trim\(\)/)
  })

  it('sits above the script pane, not inside a fold', () => {
    const banner = ROOM.indexOf('unarmed-call2-warning')
    const script = ROOM.indexOf('<DialerScriptPane')
    expect(banner).toBeGreaterThan(-1)
    expect(script).toBeGreaterThan(banner)
  })

  it('tells him what to do, not just what is wrong', () => {
    expect(ROOM).toContain('Do not invent a number')
  })

  // 18 Aug, second round, Hugo: "still not fetching and not even know
  // comparables, cant see." The audit: the preview was correct and the
  // endpoint fast, but the only fetch/apply button lived on the pipeline
  // board. The banner is now the button.
  it('carries the arm button and mounts the SAME modal the board uses', () => {
    expect(ROOM).toContain('data-testid="arm-ballpark-button"')
    expect(ROOM).toContain("from '../deals/BallparkModal'")
    expect(ROOM).toContain('<BallparkModal')
  })

  it('labels the press by whether the homework is ready', () => {
    expect(ROOM).toContain('Review and arm the figures')
    expect(ROOM).toContain('Fetch the ballpark')
    expect(ROOM).toContain('ballparkReady')
  })

  it('applying from the room refreshes the room, not just the board', () => {
    const modal = readFileSync(
      resolve(root, 'src/features/crm/components/deals/BallparkModal.tsx'), 'utf8')
    expect(modal).toContain("queryKey: ['property-listings']")
  })
})
