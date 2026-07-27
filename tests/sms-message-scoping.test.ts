import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo, 2026-07-27, admin-impersonating Pedro and reading texts a different
// agent had sent minutes earlier: "I am inside pedro and I can see Marias
// text, the app needs indviduality."
//
// The audit found ONE hole. wk_calls, wk_contacts, wk_vsl_pages and
// wk_notifications all restrict by agent. wk_sms_messages' SELECT policy was
// `wk_is_agent_or_admin()` — it asked "are you staff", never "is this yours".
// Measured live: 511 messages in the workspace, and BOTH agents could read all
// 511, including all 56 texts a third agent had just sent to leads that were
// nothing to do with them.

const root = resolve(__dirname, '..')
const migDir = resolve(root, 'supabase/migrations')
const mig = readFileSync(
  resolve(migDir, '20260727000020_sms_messages_participation_rls.sql'),
  'utf8',
)

describe('wk_sms_messages is scoped to the agent, not to "is staff"', () => {
  it('replaces the blanket staff check on the read policy', () => {
    expect(mig).toMatch(/drop policy if exists wk_sms_messages_read on wk_sms_messages/i)
    expect(mig).toMatch(/create policy wk_sms_messages_read/i)
    // The whole point: the new policy must NOT be the old blanket check.
    const policy = mig.split('create policy wk_sms_messages_read')[1] ?? ''
    expect(policy).not.toMatch(/wk_is_agent_or_admin\(\)/)
  })

  it('lets an agent read their own sends and the leads they work, nothing else', () => {
    const policy = mig.split('create policy wk_sms_messages_read')[1] ?? ''
    expect(policy).toMatch(/wk_is_admin\(\)/)
    expect(policy).toMatch(/created_by = auth\.uid\(\)/)
    expect(policy).toMatch(/wk_agent_participates\(contact_id\)/)
  })

  it('answers only about the caller, never about an arbitrary agent', () => {
    // The helper takes a contact and reads auth.uid() itself. If it took an
    // agent id, any authenticated user could ask about anyone.
    expect(mig).toMatch(/function wk_agent_participates\(p_contact uuid\)/)
    expect(mig).toMatch(/auth\.uid\(\)/)
    expect(mig).not.toMatch(/function wk_agent_participates\([^)]*agent[^)]*\)/i)
  })

  it('keeps the SECURITY DEFINER helper away from anon', () => {
    // It bypasses RLS by design, to break the wk_contacts <-> wk_sms_messages
    // policy cycle. Reachable by anon, that is the hole reopened wider.
    expect(mig).toMatch(/security definer/i)
    expect(mig).toMatch(/set search_path = public/i)
    expect(mig).toMatch(/revoke all on function wk_agent_participates\(uuid\) from public, anon/i)
  })

  it('indexes what the policy filters on, or every inbox read scans', () => {
    expect(mig).toMatch(/wk_calls \(contact_id, agent_id\)/)
    expect(mig).toMatch(/wk_sms_messages \(contact_id, created_by\)/)
    expect(mig).toMatch(/wk_lead_assignments \(contact_id, agent_id\)/)
  })

  it('is the LAST word on that policy — no later migration reopens it', () => {
    // A later migration re-creating wk_sms_messages_read with the blanket check
    // would silently undo this, and nothing else in the suite would notice.
    const SELF = '20260727000020_sms_messages_participation_rls.sql'
    const later = readdirSync(migDir)
      .filter((f) => f.endsWith('.sql') && f > SELF)
      .filter((f) => {
        const sql = readFileSync(resolve(migDir, f), 'utf8')
        return /create policy wk_sms_messages_read/i.test(sql)
          && /wk_is_agent_or_admin\(\)/.test(sql)
      })
    expect(later, `these migrations reopen the leak: ${later.join(', ')}`).toEqual([])
  })
})
