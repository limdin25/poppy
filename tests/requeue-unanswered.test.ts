// An office that did not pick up comes round again, five times, from the back.
//
// Hugo, 2026-08-10: "the offices that didn't pick up, they should go to the end
// of the list, okay? About five times."
//
// The state before this existed: all 56 of Pedro's queue rows on his first day
// finished at attempts = 1. Not one branch was ever dialled twice, and 31
// offices that never reached a human were written off after a single ring,
// because wk_apply_outcome marked the row 'done' for every outcome alike.
//
// The behaviour itself was verified against the production database inside a
// rolled-back transaction (voicemail -> requeued and rested; fifth attempt ->
// lost; not interested -> done). These assertions guard the pieces that a later
// edit could quietly undo.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const SQL = read('supabase/migrations/20260810000007_requeue_unanswered_branches.sql')
const MACHINE = read('src/features/crm/dialer-pro/useDialerMachine.ts')
const QUEUE = read('src/features/crm/dialer-pro/useQueuePro.ts')

describe('what counts as "nobody answered"', () => {
  it('is decided by the outcome the agent pressed, not by Twilio', () => {
    // There is no answering-machine detection in our TwiML, so a branch's
    // voicemail picking up looks identical to a human: 52 of Pedro's 55 calls
    // came back `completed` with answered_by NULL. The button is the only
    // honest signal we have.
    expect(SQL).toMatch(/v_no_answer := lower\(coalesce\(v_column_name, ''\)\) IN \('voicemail', 'no pickup', 'no answer'\)/)
  })

  it('matches on the column NAME so a re-seeded pipeline still works', () => {
    expect(SQL).not.toMatch(/65af2905|98d2390d/) // no pinned uuids
    expect(SQL).toMatch(/SELECT is_terminal, name INTO v_is_terminal, v_column_name/)
  })

  it('leaves a real answer alone: Not interested must still bury the row', () => {
    expect(SQL).toMatch(/Somebody actually spoke to us\. Close it, exactly as before\./)
    expect(SQL).toMatch(/queue_marked_done/)
  })
})

describe('the back of the list, and a rest before it comes round', () => {
  it('drops the priority below everything still waiting', () => {
    // There is no position column. Order is priority DESC, scheduled_for ASC,
    // attempts ASC, created_at ASC, so "the back" means a lower priority.
    expect(SQL).toMatch(/SELECT COALESCE\(MIN\(priority\), 0\) INTO v_min_priority/)
    expect(SQL).toMatch(/priority\s+= LEAST\(COALESCE\(v_min_priority, 0\) - 1, COALESCE\(priority, 0\) - 1\)/)
  })

  it('rests the branch so we cannot ring the same office twice in an hour', () => {
    // This spacing used to live in the AI cron ("never ring the same office
    // twice within 30 minutes") and has protected nothing since that was
    // deleted with the robot in 173406c.
    expect(SQL).toMatch(/scheduled_for = now\(\) \+ make_interval\(mins => wk_requeue_gap_minutes\(\)\)/)
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION wk_requeue_gap_minutes[\s\S]*?SELECT 120/)
  })

  it('the queue actually honours that rest', () => {
    expect(QUEUE).toMatch(/scheduled_for\.is\.null,scheduled_for\.lte\./)
  })

  it('stops at five and marks it lost', () => {
    expect(SQL).toMatch(/IF COALESCE\(v_attempts, 0\) >= 5 THEN/)
    expect(SQL).toMatch(/SET status = 'lost'/)
    expect(SQL).toMatch(/queue_lost_after_5_attempts/)
  })

  it('does NOT need a new attempts counter: wk_claim_queue_row already increments', () => {
    const port = read('supabase/migrations/20260715000001_crm_port.sql')
    expect(port).toMatch(/attempts = q\.attempts \+ 1/)
    // And this migration never touches attempts itself, so the two cannot drift.
    const body = SQL.slice(SQL.indexOf('IF v_no_answer THEN'), SQL.indexOf('Any OTHER rows'))
    expect(body).not.toMatch(/SET[\s\S]{0,80}attempts\s*=/)
  })
})

describe('requeue by UPDATE, never INSERT', () => {
  it('reuses the existing row', () => {
    // wk_dialer_queue has NO unique constraint on (campaign_id, contact_id),
    // and QueueManagerPro's add-to-queue does a .maybeSingle() lookup that
    // throws the moment a contact holds two rows in one campaign. Requeue by
    // insert would manufacture exactly that collision.
    expect(SQL).toMatch(/UPDATE the existing row, never INSERT a second one/)
    const branch = SQL.slice(SQL.indexOf('IF v_no_answer THEN'), SQL.indexOf('ELSE\n      -- Somebody actually spoke'))
    expect(branch).not.toMatch(/INSERT INTO wk_dialer_queue/)
  })

  it('closes any duplicate rows so a branch cannot resurrect twice', () => {
    expect(SQL).toMatch(/id IS DISTINCT FROM v_queue_id/)
  })
})

describe('the requeue is not defeated by the dialer session', () => {
  it('forgets a row the server has deliberately scheduled for later', () => {
    // dialedRef is a session-local Set keyed on the queue ROW id, and the
    // requeue keeps the same row id. Without this the set would refuse to dial
    // it ever again and the whole feature would do nothing until Pedro
    // restarted the dialer.
    expect(MACHINE).toMatch(/if \(!lead\.scheduledFor\) continue;/)
    expect(MACHINE).toMatch(/dialedRef\.current\.delete\(lead\.queueRowId\)/)
  })

  it('still refuses to walk back over a lead rung in this sitting', () => {
    // The guard has to keep doing its original job: only a row carrying a
    // server-set scheduled_for is let through.
    expect(MACHINE).toMatch(/if \(dialedRef\.current\.has\(lead\.queueRowId\)\) \{/)
  })
})
