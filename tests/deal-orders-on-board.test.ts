// THE PIPELINE CARD CARRIES THE BRAIN'S CURRENT ORDER.
//
// Hugo, 2026-08-17, two screenshots of one deal: the cockpit said "Reply
// holding at 96,375, ask for the video walkthrough" while the DDM pipeline
// card said "Renegotiate" (a tag the inbound classifier wrote when the counter
// arrived) and "Pedro today: Ring Doug" (a pinned note written before the
// branch replied). "DDM are contradicting on pipeline against cockpit. It's
// not informing what to do on the pipeline."
//
// The card's instruction sources all stop updating once the brain takes over;
// the brain's current order lives in wk_deal_manager_log assessment rows and
// nothing on the board read them. The fix is newest-wins on the card, through
// a SECURITY DEFINER RPC, because a raw select on the log would hit the RLS
// row filter and silently serve an agent an OLDER instruction, which is the
// exact Zest "Hold, nothing today" bug reborn on the board.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { orderedStep } from '../src/features/crm/lib/dealOrder'
import type { NextStepBrief } from '../api/lib/next-step-brief'

const brief = (written_at: string, step: string): NextStepBrief => ({
  version: 1, written_at, verdict: 'KEEP', headline: 'KEEP: DDM, Orion Way',
  step: 'Chase the agent', who: 'PEDRO', asking: 110000, offer: 96375,
  ceiling: 102800, ladder: '', why: [], do_now: [step], blockers: [],
  board: 'Offer sent', confidence: { level: 'high', why: 'x', raise: null },
})

const order = (at: string, instruction: string | null, blockedOnHugo = false) => ({
  instruction, at, who: 'PEDRO', confidence: 'high' as string | null,
  action: 'draft_counter_reply' as string | null, blockedOnHugo,
})

describe('newest wins between the brain and the call-outcome brief', () => {
  it('DDM: the brain judged after the reply, so its order is the line', () => {
    const r = orderedStep(
      brief('2026-08-15T10:00:00Z', 'Ring Doug. Chase the answer.'),
      order('2026-08-17T09:36:00Z', 'Reply holding at 96,375, and ask for the video walkthrough in the same email.'),
    )
    expect(r?.kind).toBe('order')
    expect(r?.text).toContain('holding at 96,375')
  })

  it('a brief written after the last judgement wins instead', () => {
    // A call outcome pressed a minute ago knows more than a sweep from
    // last night. Freshest information wins in either direction.
    const r = orderedStep(
      brief('2026-08-17T12:00:00Z', 'Price it against what the agent said.'),
      order('2026-08-17T09:36:00Z', 'Hold and chase.'),
    )
    expect(r?.kind).toBe('brief')
    expect(r?.text).toContain('Price it against')
  })

  it('no order at all falls back to the brief, exactly as today', () => {
    const r = orderedStep(brief('2026-08-15T10:00:00Z', 'Ring Doug.'), null)
    expect(r?.kind).toBe('brief')
  })

  it('an order with nothing behind it renders nothing, not an empty chip', () => {
    expect(orderedStep(null, null)).toBeNull()
    expect(orderedStep(null, order('2026-08-17T09:00:00Z', null))).toBeNull()
  })

  it('blocked on Hugo never shows a stale line, it says whose move it is', () => {
    // The RPC masks the instruction for an agent when the newest judgement is
    // Hugo's private lane. Falling back to the old brief here would repeat
    // the Zest bug on the board, so the card says the deal is alive and not
    // this reader's move, and nothing else.
    const r = orderedStep(
      brief('2026-08-15T10:00:00Z', 'Ring Doug.'),
      order('2026-08-17T09:36:00Z', null, true),
    )
    expect(r?.kind).toBe('hugo')
    expect(r?.text).toBe('Hugo is on this one')
  })
})

describe('the RPC is the only safe door, and it is built like one', () => {
  const SQL = readFileSync('supabase/migrations/20260817000002_deal_orders_on_the_board.sql', 'utf8')

  it('security definer, gated, search_path pinned', () => {
    expect(SQL).toMatch(/security definer/i)
    expect(SQL).toMatch(/wk_is_agent_or_admin\(\)/)
    expect(SQL).toMatch(/set search_path = public/i)
  })

  it('masks the instruction behind wk_is_admin, with the same three flags as the RLS', () => {
    expect(SQL).toMatch(/wk_is_admin\(\)/)
    expect(SQL).toMatch(/blocked_needs_hugo/)
    expect(SQL).toMatch(/figure_mismatch/)
    expect(SQL).toMatch(/stage_mismatch/)
  })

  it('blocked_on_hugo uses the exact predicate the cockpit RPC uses', () => {
    expect(SQL).toMatch(/who = 'HUGO'/)
    expect(SQL).toMatch(/flags && array\['blocked_needs_hugo'\]/)
  })

  it('newest judgement per contact, both kinds', () => {
    expect(SQL).toMatch(/distinct on \(l\.contact_id\)/i)
    expect(SQL).toMatch(/'assessment'/)
    expect(SQL).toMatch(/'fallback_refused'/)
  })
})

describe('the wiring is real', () => {
  it('the hook goes through the RPC, never a raw select on the log', () => {
    const hook = readFileSync('src/features/crm/hooks/useDealOrders.ts', 'utf8')
    expect(hook).toMatch(/rpc\('wk_deal_orders'/)
    // A raw select would hit the RLS row filter and silently serve an agent
    // an OLDER visible instruction. The RPC is the only door.
    expect(hook).not.toMatch(/from\('wk_deal_manager_log'/)
  })

  it('the board hands the order to the card, and the modal gets it too', () => {
    const page = readFileSync('src/features/crm/pages/PipelinesPage.tsx', 'utf8')
    expect(page).toMatch(/useDealOrders/)
    expect((page.match(/order=\{/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('the stale stage tag stands down when the brain has the freshest word', () => {
    // "Renegotiate" beside "hold at 96,375" is two deciders on one card.
    const page = readFileSync('src/features/crm/pages/PipelinesPage.tsx', 'utf8')
    expect(page).toMatch(/orderedStep/)
    expect(page).toMatch(/!== 'order'[\s\S]{0,120}<NextStepChip/)
  })

  it('BriefLine draws it, and no long dashes anywhere in the new copy', () => {
    const line = readFileSync('src/features/crm/components/shared/BriefLine.tsx', 'utf8')
    expect(line).toMatch(/orderedStep/)
    expect(line).toMatch(/Hugo is on this one/)
    for (const f of ['src/features/crm/lib/dealOrder.ts',
      'src/features/crm/components/shared/BriefLine.tsx']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/[–—]/)
    }
  })
})
