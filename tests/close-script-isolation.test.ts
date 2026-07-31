// The two sales scripts must never be able to overwrite each other.
//
// Hugo, 2026-07-31, asking for the video-funnel close call: "the script is
// different and cannot affect the other scripts, you understand?" Pedro and
// Marr read the cold-call script on every dial; a bug that let the close script
// save over it would break every call they make and nobody would notice until
// an agent read the wrong opener down the phone.
//
// The isolation is structural (separate tables, separate bundled files,
// separate hooks) and this is what stops someone "simplifying" it back into one
// shared hook with a key argument, which is one wrong argument away from the
// exact accident above.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const COLD_HOOK = 'src/features/crm/hooks/useSalesScript.ts'
const CLOSE_HOOK = 'src/features/crm/hooks/useVslCloseScript.ts'
const PANE = 'src/features/crm/components/live-call/DialerScriptPane.tsx'
const CLOSE_HTML = 'src/core/content/vsl-close-script.html'
const MIGRATION = 'supabase/migrations/20260731000001_vsl_close_script.sql'

describe('the close script cannot touch the cold-call script', () => {
  it('each hook reads and writes its OWN table and never the other one', () => {
    const cold = read(COLD_HOOK)
    expect(cold).toMatch(/wk_sales_script/)
    expect(cold).not.toMatch(/wk_vsl_close_script/)

    const close = read(CLOSE_HOOK)
    expect(close).toMatch(/wk_vsl_close_script/)
    // The close hook naming the cold table at all would mean a shared write path.
    expect(close.replace(/wk_vsl_close_script/g, '')).not.toMatch(/wk_sales_script/)
  })

  it('the close script has its own table, not a second row in the cold one', () => {
    // wk_sales_script is CHECK (id = 1) — a second row there is impossible, and
    // dropping that constraint would put both scripts one UPDATE apart.
    const sql = read(MIGRATION)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS wk_vsl_close_script/)
    expect(sql).toMatch(/CHECK \(id = 1\)/)
    expect(sql).not.toMatch(/ALTER TABLE wk_sales_script/)
    expect(sql).not.toMatch(/DROP CONSTRAINT/)
    // Same RLS as the script it sits beside: agents read, admins write.
    expect(sql).toMatch(/USING \(wk_is_agent_or_admin\(\)\)/)
    expect(sql).toMatch(/USING \(wk_is_admin\(\)\) WITH CHECK \(wk_is_admin\(\)\)/)
  })

  it('the pane defaults to the cold script, so every existing caller is unchanged', () => {
    const pane = read(PANE)
    expect(pane).toMatch(/scriptKey = 'cold_call'/)
    // Both hooks are called unconditionally (Rules of Hooks) and the CHOICE is
    // made on the result, never by calling one of them conditionally.
    expect(pane).toMatch(/const cold = useSalesScript\(\)/)
    expect(pane).toMatch(/const vslClose = useVslCloseScript\(\)/)
  })

  it('the close script is not a second copy of the pricing canon', () => {
    // api/lib/review-plans.ts owns the tiers, and the lead has just watched a
    // video that already quoted them. Restating them here is a copy that goes
    // stale silently (see tests/pricing-consistency.test.ts for the four-copy
    // mess this rule came out of).
    expect(read(CLOSE_HTML)).not.toMatch(/£(99|179|279)\b/)
  })

  it('the close script carries no long dashes, curly quotes or ellipsis characters', () => {
    // Standing rule, and this file is read aloud AND its lines get pasted into
    // texts, where one long dash drops an SMS segment from 160 chars to 70.
    expect(read(CLOSE_HTML)).not.toMatch(/[–—‘’“”…]/)
  })
})
