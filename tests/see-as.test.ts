import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// "See as: <agent>" — admin views the CRM as one agent (Hugo 2026-07-26).
const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('See-as: admin impersonation', () => {
  it('the nav bar renders the selector, admin-gated', () => {
    const sel = read('src/features/crm/layout/ViewAsSelector.tsx')
    expect(sel).toMatch(/if \(loading \|\| !isAdmin\) return null/)
    expect(sel).toMatch(/See as:/)
    const layout = read('src/features/crm/layout/Smsv2Layout.tsx')
    expect(layout).toMatch(/<ViewAsSelector \/>/)
    expect(layout).toMatch(/<ViewAsProvider>/)
  })

  it('impersonation is persisted and reset for non-admins', () => {
    const ctx = read('src/features/crm/lib/ViewAsContext.tsx')
    expect(ctx).toMatch(/const KEY = 'crm_view_as'/)
    expect(ctx).toMatch(/localStorage\.setItem\(KEY/)
    expect(ctx).toMatch(/useResetViewAsForNonAdmin/)
    // effective scope: non-admin=self, admin+viewAs=that agent, admin alone=all
    expect(ctx).toMatch(/if \(!isAdmin\) return \{ scopeAgentId: uid/)
    expect(ctx).toMatch(/return \{ scopeAgentId: viewAsId/)
  })

  it('the inbox scopes to the impersonated agent', () => {
    const hook = read('src/features/crm/hooks/useInboxThreads.ts')
    expect(hook).toMatch(/const scopeId: string \| null = isAdmin \? viewAsId : uid/)
    // the participation set is built for scopeId, not hard-wired to uid
    expect(hook).toMatch(/if \(scopeId\) \{/)
    expect(hook).toMatch(/owner_agent_id', scopeId/)
    // re-loads when the impersonation target changes
    expect(hook).toMatch(/\}, \[isAdmin, viewAsId\]\)/)
  })

  it('a visible banner warns while impersonating', () => {
    const layout = read('src/features/crm/layout/Smsv2Layout.tsx')
    expect(layout).toMatch(/Viewing the CRM as/)
    expect(layout).toMatch(/Back to everyone/)
  })

  it('a central useImpersonatedAgentId helper drives every page', () => {
    const ctx = read('src/features/crm/lib/ViewAsContext.tsx')
    expect(ctx).toMatch(/export function useImpersonatedAgentId\(\): string \| null/)
    // null unless an admin is actively impersonating
    expect(ctx).toMatch(/if \(loading \|\| !isAdmin\) return null/)
  })

  it('every agent-scoped surface filters by the impersonated agent', () => {
    const cases: Array<[string, RegExp]> = [
      // store → pipelines + contacts pages
      ['src/features/crm/hooks/useHydrateContacts.ts', /owner_agent_id', impId/],
      // dialer queue
      ['src/features/crm/dialer-pro/useQueuePro.ts', /agent_id', impAgentId/],
      // calls list (Calls page + inbox calls filter)
      ['src/features/crm/hooks/useCalls.ts', /agent_id', impAgentId/],
      // dialer call history
      ['src/features/crm/dialer-pro/history/CallHistoryPro.tsx', /agent_id', impAgentId/],
      // reports / leaderboard data
      ['src/features/crm/hooks/useReports.ts', /agent_id', impId/],
      // dialer KPIs
      ['src/features/crm/caller-pad/hooks/useDialerKpis.ts', /agent_id', effectiveId/],
      // video funnel board
      ['src/features/crm/pages/VideoFunnelPage.tsx', /agent_id', impId/],
      // dialer column-opened leads
      ['src/features/crm/dialer-pro/DialerProPage.tsx', /owner_agent_id', impId/],
    ]
    for (const [file, re] of cases) {
      expect(read(file), file).toMatch(re)
      expect(read(file), `${file} imports the helper`).toMatch(/useImpersonatedAgentId/)
    }
  })
})
