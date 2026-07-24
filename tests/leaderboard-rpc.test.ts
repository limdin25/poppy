import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-24: "make sure it shows who's calling more between them two …
// sometimes we have other agents, they don't show."
//
// Root cause: the board was aggregated in the browser from wk_calls, whose RLS
// is `wk_is_admin() OR agent_id = auth.uid()`. Verified against production —
// agent Marr's own session could read 224 call rows spanning exactly ONE
// agent_id (his). Every agent therefore saw a leaderboard of one.
//
// These pin the fix so a later refactor can't quietly put the board back on a
// RLS-clipped table, or drop the staff gate on a SECURITY DEFINER function.

const sql = readFileSync(
  resolve(__dirname, '../supabase/migrations/20260724000001_leaderboard_rpc.sql'),
  'utf8',
)
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('wk_leaderboard RPC — migration contract', () => {
  it('runs as SECURITY DEFINER so it can see every agent', () => {
    expect(sql).toMatch(/security\s+definer/i)
  })

  it('pins search_path (SECURITY DEFINER hardening)', () => {
    expect(sql).toMatch(/set\s+search_path\s*=\s*public/i)
  })

  it('is gated on staff — reviews clients and owners must get nothing', () => {
    expect(sql).toMatch(/where\s+public\.wk_is_agent_or_admin\(\)/i)
  })

  it('honours the per-agent compete toggle', () => {
    expect(sql).toMatch(/coalesce\(l\.show_on_leaderboard,\s*true\)/i)
  })

  it('defaults a missing toggle to competing, not hidden', () => {
    expect(sql).not.toMatch(/coalesce\(l\.show_on_leaderboard,\s*false\)/i)
  })

  it('LEFT JOINs the stats so agents with no calls yet still appear', () => {
    expect(sql).toMatch(/from\s+roster\s+r\s+left\s+join\s+call_stats/i)
    expect(sql).toMatch(/left\s+join\s+message_stats/i)
    expect(sql).toMatch(/left\s+join\s+spend_stats/i)
  })

  it('exposes aggregates only — no call rows, transcripts or numbers', () => {
    expect(sql).not.toMatch(/to_e164|from_e164|twilio_call_sid|agent_note/i)
  })

  it('grants execute to authenticated and revokes it from public', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.wk_leaderboard\(timestamptz\)\s+from\s+public/i)
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.wk_leaderboard\(timestamptz\)\s+to\s+authenticated/i)
  })
})

describe('leaderboard surfaces read the RPC, not RLS-clipped call rows', () => {
  it('the full board page uses useLeaderboard', () => {
    const page = read('src/features/crm/pages/LeaderboardPage.tsx')
    expect(page).toMatch(/import \{ useLeaderboard \} from '\.\.\/hooks\/useLeaderboard'/)
    expect(page).not.toMatch(/import .*from '\.\.\/hooks\/useReports'/)
  })

  it('the nav-bar trophy popover uses useLeaderboard', () => {
    const bar = read('src/features/crm/layout/Smsv2StatusBar.tsx')
    expect(bar).toMatch(/import \{ useLeaderboard \} from '\.\.\/hooks\/useLeaderboard'/)
    expect(bar).not.toMatch(/import .*from '\.\.\/hooks\/useReports'/)
  })

  it('both rank by calls MADE — "who is calling more"', () => {
    const page = read('src/features/crm/pages/LeaderboardPage.tsx')
    const bar = read('src/features/crm/layout/Smsv2StatusBar.tsx')
    expect(page).toMatch(/b\.calls\s*-\s*a\.calls/)
    expect(bar).toMatch(/b\.calls\s*-\s*a\.calls/)
  })

  it('the hook calls the RPC by name', () => {
    const hook = read('src/features/crm/hooks/useLeaderboard.ts')
    expect(hook).toMatch(/rpc\(['"]wk_leaderboard['"]/)
  })
})

describe('every competitor can be toggled off', () => {
  it('the Settings agent list covers accounts with a limits row, not just roles', () => {
    const hook = read('src/features/crm/hooks/useAgentsToday.ts')
    // Roster parity with the RPC: workspace_role OR a wk_voice_agent_limits row.
    expect(hook).toMatch(/limitAgentIds/)
    expect(hook).toMatch(/id\.in\./)
  })

  it('Settings still writes the toggle through to wk_voice_agent_limits', () => {
    const settings = read('src/features/crm/pages/SettingsPage.tsx')
    expect(settings).toMatch(/show_on_leaderboard:\s*show/)
    expect(settings).toMatch(/onConflict:\s*'agent_id'/)
  })
})
