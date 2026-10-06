// A contact Pedro has already worked is not served again by the dialler
// unless a call follow-up is due.
//
// 6 Oct 2026: Ace Homes went to Report sent at 12:15 on 5 Oct with a call
// follow-up booked for 6 Oct 17:00. Its queue row from an earlier voicemail
// was still pending, so the dialler served it at 11:44 on 6 Oct, five hours
// early. Nothing in the queue looked at the stage or the follow-ups.
//
// The behaviour was verified against production inside a rolled-back
// transaction (Ace Homes and Camilla not servable, a due follow-up makes
// Camilla servable, the picker never returns a worked contact, a voicemail
// outcome on Report sent keeps Report sent). These assertions guard the pieces
// a later edit could quietly undo.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const SQL = read('supabase/migrations/20261006000001_dialler_skips_worked_stages.sql')
const QUEUE = read('src/features/crm/dialer-pro/useQueuePro.ts')
const MACHINE = read('src/features/crm/dialer-pro/useDialerMachine.ts')
const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')
const REPORT = read('api/crm/sa-report.ts')

const fn = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const end = SQL.indexOf('$function$;', start)
  const endSql = SQL.indexOf('$$;', start)
  const stop = [end, endSql].filter((n) => n > start).sort((a, b) => a - b)[0]
  return SQL.slice(start, stop)
}

describe('which stages count as worked', () => {
  it('adds dialer_closed additively, default false', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS dialer_closed boolean NOT NULL DEFAULT false/)
  })

  it('closes exactly the eight Hostunico worked stages and nothing else', () => {
    const updates = SQL.match(/UPDATE public\.wk_pipeline_columns[\s\S]*?;/g) ?? []
    expect(updates).toHaveLength(1)
    const u = updates[0]
    expect(u).toMatch(/pipeline_id = 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0'/)
    const names = [...u.matchAll(/'([A-Za-z ]+)'/g)].map((m) => m[1]).sort()
    expect(names).toEqual([
      'Cold', 'Do not contact', 'Not interested', 'Onboarded', 'Preparing to onboard',
      'Report requested', 'Report sent', 'Review call booked',
    ])
    // New lead, Voicemail and No pickup stay servable.
    expect(u).not.toMatch(/New lead|Voicemail|No pickup/)
  })
})

describe('the single source of truth', () => {
  const body = fn('wk_contact_dialer_servable')

  it('a worked contact is servable only while a pending call follow-up is due', () => {
    expect(body).toMatch(/FROM wk_contact_followups f/)
    expect(body).toMatch(/f\.status = 'pending'/)
    expect(body).toMatch(/f\.due_at <= p_at/)
    expect(body).toMatch(/pc\.dialer_closed/)
  })

  it('does not use the automated report SMS sequence as a call follow-up', () => {
    expect(body).not.toMatch(/sa_report_followups/)
  })

  it('anon cannot execute the new functions', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.wk_contact_dialer_servable\(uuid, timestamptz\) FROM PUBLIC, anon;/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.wk_dialer_servable_contacts\(uuid\[\]\) FROM PUBLIC, anon;/)
    expect(fn('wk_dialer_servable_contacts')).toMatch(/wk_is_agent_or_admin\(\)/)
  })
})

describe('both server pickers ask it', () => {
  it('wk_pick_next_lead keeps every old guard and adds the check', () => {
    const p = fn('wk_pick_next_lead')
    expect(p).toMatch(/AND wk_contact_dialer_servable\(q\.contact_id\)/)
    expect(p).toMatch(/q\.status = 'pending'/)
    expect(p).toMatch(/q\.scheduled_for IS NULL OR q\.scheduled_for <= now\(\)/)
    expect(p).toMatch(/FOR UPDATE SKIP LOCKED/)
    expect(p).toMatch(/ORDER BY q\.priority DESC NULLS LAST,\s+q\.scheduled_for ASC NULLS FIRST,\s+q\.attempts ASC,\s+q\.created_at ASC/)
    expect(p).toMatch(/RAISE EXCEPTION 'forbidden'/)
  })

  it('wk_claim_queue_row refuses a worked contact unless Pedro picked that one contact', () => {
    const c = fn('wk_claim_queue_row')
    expect(c).toMatch(/AND q\.status = 'pending'/)
    expect(c).toMatch(/AND \(q\.priority >= 9999 OR wk_contact_dialer_servable\(q\.contact_id\)\)/)
    expect(c).toMatch(/attempts = q\.attempts \+ 1/)
    // 9999 is only ever set by the deliberate "ring this contact" paths.
    expect(PAGE).toMatch(/priority: 9999/)
  })
})

describe('a follow-up call that goes to voicemail does not demote a worked contact', () => {
  const a = fn('wk_apply_outcome')

  it('keeps the stage when the outcome is no-answer and the stage is dialer_closed', () => {
    expect(a).toMatch(/SELECT COALESCE\(pc\.dialer_closed, false\) INTO v_current_closed/)
    expect(a).toMatch(/CASE WHEN v_no_answer AND COALESCE\(v_current_closed, false\)\s+THEN pipeline_column_id ELSE p_column_id END/)
  })

  it('still records the disposition on the call', () => {
    expect(a).toMatch(/SET disposition_column_id = p_column_id/)
  })

  it('keeps the requeue and the five-attempt rule untouched', () => {
    expect(a).toMatch(/v_no_answer := lower\(coalesce\(v_column_name, ''\)\) IN \('voicemail', 'no pickup', 'no answer'\)/)
    expect(a).toMatch(/IF COALESCE\(v_attempts, 0\) >= 5 THEN/)
    expect(a).toMatch(/scheduled_for = now\(\) \+ make_interval\(mins => wk_requeue_gap_minutes\(\)\)/)
    expect(a).toMatch(/Somebody actually spoke to us\. Close it, exactly as before\./)
  })
})

describe('the client list matches the server', () => {
  it('useQueuePro filters through the RPC and keeps its old guards', () => {
    expect(QUEUE).toMatch(/rpc\('wk_dialer_servable_contacts'/)
    expect(QUEUE).toMatch(/return keepServable\(leads\)/)
    expect(QUEUE).toMatch(/\.eq\('wk_contacts\.do_not_call', false\)/)
    expect(QUEUE).toMatch(/scheduled_for\.is\.null,scheduled_for\.lte\./)
    // Fails open on the list: the claim still refuses.
    expect(QUEUE).toMatch(/console\.warn\('\[dialer-pro\] servable check failed/)
  })

  it('a refused claim leaves a pending row pending and the dialler moves on', () => {
    expect(MACHINE).toMatch(/if \(row\?\.status !== 'pending'\) void updateQueueStatus\(lead\.queueRowId, 'missed'\);/)
    expect(MACHINE).toMatch(/return 'refused';/)
    expect(MACHINE).toMatch(/const dialNext = useCallback/)
    expect(PAGE).toMatch(/machine\.dialNext\(queue\)/)
    expect(PAGE).not.toMatch(/const next = await machine\.pickNextLead\(queue\);\s+if \(next\) void machine\.dialLead\(next\);/)
  })

  it('report prep skips contacts the dialler would not serve', () => {
    expect(REPORT).toMatch(/rpc\('wk_dialer_servable_contacts'/)
  })
})
