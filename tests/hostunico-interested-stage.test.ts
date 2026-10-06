// Interested on the Hostunico owners board (Hugo, 6 Oct 2026): a warm lead who
// is not onboarded yet. Not a final stage, needs a callback, open for the
// dialler, and it sits after Report sent and before Onboarded.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.SUPABASE_URL ||= 'http://localhost:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
})
import { OUTCOMES, BOARD_COLUMN_FOR, STEP_FOR_OUTCOME } from '../api/crm/sa-outcome'
import { SA_OUTCOMES } from '../src/features/crm/components/live-call/SaListingPane'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const MIG = read('supabase/migrations/20261006000002_hostunico_interested_stage.sql')
const PANE = read('src/features/crm/components/live-call/SaListingPane.tsx')

describe('the Interested stage', () => {
  it('is added to the Hostunico owners board straight after Report sent', () => {
    expect(MIG).toContain("v_pipeline uuid := 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0'")
    expect(MIG).toMatch(/WHERE pipeline_id = v_pipeline AND name = 'Report sent'/)
    expect(MIG).toMatch(/\(v_pipeline, 'Interested', '#[0-9A-F]{6}', v_after \+ 1, v_after \+ 1, false, true, false, false\)/)
  })
  it('is not final, needs a follow-up and is open for the dialler', () => {
    expect(MIG).toMatch(/is_terminal = false, requires_followup = true/)
    expect(MIG).toMatch(/SET dialer_closed = false WHERE pipeline_id = \$1 AND name = ''Interested''/)
  })
  it('keeps (pipeline_id, position) unique while making room', () => {
    expect(MIG).toMatch(/position = position \+ 1000/)
    expect(MIG).toMatch(/position = position - 999/)
  })
  it('is an outcome button that asks for a callback, and the API files it under Interested', () => {
    expect(SA_OUTCOMES.map((o) => o.key)).toContain('interested')
    expect(OUTCOMES).toContain('interested')
    expect(BOARD_COLUMN_FOR.interested).toBe('Interested')
    expect(STEP_FOR_OUTCOME.interested).toBeTruthy()
    expect(PANE).toMatch(/columns\.find\(\(c\) => c\.name === 'Interested'\)/)
    expect(PANE).toMatch(/o\.key === 'interested'[\s\S]*setInterestedOpen\(true\)/)
    expect(PANE).toMatch(/columnName="Interested"[\s\S]*void save\('interested'\)/)
  })
})
