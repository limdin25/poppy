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
    const cases: Array<[string, RegExp, boolean]> = [
      // store → pipelines + contacts pages
      ['src/features/crm/hooks/useHydrateContacts.ts', /owner_agent_id', impId/, true],
      // calls list (Calls page + inbox calls filter)
      ['src/features/crm/hooks/useCalls.ts', /agent_id', impAgentId/, true],
      // dialer call history
      ['src/features/crm/dialer-pro/history/CallHistoryPro.tsx', /agent_id', impAgentId/, true],
      // reports / leaderboard data
      ['src/features/crm/hooks/useReports.ts', /agent_id', impId/, true],
      // dialer KPIs
      ['src/features/crm/caller-pad/hooks/useDialerKpis.ts', /agent_id', effectiveId/, true],
      // video funnel board — uses the STRICTER useVideoScope, not
      // useImpersonatedAgentId: an agent must see only videos THEY made, and
      // wk_vsl_pages RLS also permits any video on a lead they own, so an
      // agent would otherwise see Hugo's test videos on their own leads
      // (Hugo 2026-07-27: "marr should only see his videos, same for pedro").
      ['src/features/crm/pages/VideoFunnelPage.tsx', /agent_id', impId/, false],
      // dialer: scope the CAMPAIGN LIST (queue rows have no agent_id until dialed)
      // + column-opened leads by owner
      ['src/features/crm/dialer-pro/DialerProPage.tsx', /scopedToAgentId: impId \?\?/, true],
      ['src/features/crm/dialer-pro/DialerProPage.tsx', /owner_agent_id', impId/, true],
    ]
    for (const [file, re, needsHelper] of cases) {
      expect(read(file), `${file} :: ${re}`).toMatch(re)
      if (needsHelper) expect(read(file), `${file} imports the helper`).toMatch(/useImpersonatedAgentId/)
    }
    // …and the video board still takes its scope from the shared context, never
    // from a hand-rolled read of localStorage or auth.
    expect(read('src/features/crm/pages/VideoFunnelPage.tsx')).toMatch(/useVideoScope/)
    {
    }
  })
})
