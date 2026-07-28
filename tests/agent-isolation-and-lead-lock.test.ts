import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo, 2026-07-28, after the SMS RLS fix: Pedro/Marr could still see a text
// Maria sent on a lead one of them had personally called (the participation
// carve-out he'd accepted the day before). He reversed that for Maria and
// asked that no two agents ever contact the same lead at all, going forward.

const root = resolve(__dirname, '..')
const migDir = resolve(root, 'supabase/migrations')
const mig = readFileSync(
  resolve(migDir, '20260728000001_agent_isolation_and_lead_lock.sql'),
  'utf8',
)

describe('isolated agents are invisible to other agents even on a shared lead', () => {
  it('adds the flag and a definer helper that reads it', () => {
    expect(mig).toMatch(/add column if not exists is_isolated_agent boolean not null default false/i)
    expect(mig).toMatch(/function wk_is_isolated_sender\(p_agent uuid\)/i)
    expect(mig).toMatch(/security definer/i)
    expect(mig).toMatch(/revoke all on function wk_is_isolated_sender\(uuid\) from public, anon/i)
  })

  it('flags Maria specifically, not every agent', () => {
    expect(mig).toMatch(/update profiles set is_isolated_agent = true/i)
    expect(mig).toMatch(/where email = 'plumberstexttest@heyelsie\.com'/i)
  })

  it('the SMS read policy still uses participation, but drops it for isolated senders', () => {
    const policy = mig.split('create policy wk_sms_messages_read')[1] ?? ''
    expect(policy).toMatch(/wk_is_admin\(\)/)
    expect(policy).toMatch(/created_by = auth\.uid\(\)/)
    expect(policy).toMatch(/wk_agent_participates\(contact_id\)/)
    expect(policy).toMatch(/not wk_is_isolated_sender\(created_by\)/i)
  })
})

describe('no lead is worked by two different agents', () => {
  it('defines a lock lookup covering both texts and calls', () => {
    expect(mig).toMatch(/function wk_contact_locked_agent\(p_contact uuid\)/i)
    expect(mig).toMatch(/from wk_sms_messages/i)
    expect(mig).toMatch(/from wk_calls/i)
  })

  it('only counts real workspace agents, so admin sends never set or break the lock', () => {
    const fn = mig.split('function wk_contact_locked_agent')[1] ?? ''
    // Appears twice — once per branch of the union (sms + calls).
    expect(fn.match(/workspace_role = 'agent'/g)?.length).toBe(2)
  })

  it('keeps the SECURITY DEFINER helper away from anon', () => {
    const fn = mig.split('function wk_contact_locked_agent')[1] ?? ''
    expect(fn).toMatch(/security definer/i)
  })
})
