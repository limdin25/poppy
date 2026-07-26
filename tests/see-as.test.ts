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
})
