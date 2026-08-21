// THE CARD TELLS THE SAME STORY AS THE COCKPIT.
//
// Hugo, 2026-08-17, looking at the board after the Zest send: "the actions that
// I'm taking on the cockpit are not reflecting fully on the pipelines... for
// Zest it should show there when I click that the mail was sent, the time, and
// what we are waiting for. Same for DDM Residential, they responded already. It
// shows in the cockpit but it's not showing on the pipeline column."
//
// He was right on both counts, and they were the same hole: the cockpit writes
// everything it does to wk_deal_manager_log and reads replies off the message
// stream, while the pipeline card read neither. A press changed the world and
// the board kept describing the old one.
//
// The fix is ONE line on the card, newest-wins: "They replied, 3h ago" when the
// branch's message is the latest event, otherwise "Email sent, 2h ago" for
// whatever the cockpit last did. Same two sources the cockpit itself reads, so
// the two screens cannot drift apart.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { pickPulse, pulseLabel, PULSE_SILENT } from '../src/features/crm/lib/dealPulse'

const at = (iso: string) => new Date(iso).toISOString()

const action = (a: string, created_at: string, instruction: string | null = null) =>
  ({ action: a, created_at: at(created_at), instruction })
const reply = (created_at: string, body = 'Hi, is 96,375 your best and final?') =>
  ({ created_at: at(created_at), body })

describe('newest wins: the card describes the latest event', () => {
  it('Zest: the send is newer than their last email, so the card says sent', () => {
    const p = pickPulse(
      [action('send_email', '2026-08-17T11:06:28Z', 'Send the email, done from the cockpit.')],
      reply('2026-08-17T10:32:00Z'),
    )
    expect(p).not.toBeNull()
    expect(p!.kind).toBe('done')
    expect(p!.label).toBe('Email sent')
    expect(p!.at).toBe(at('2026-08-17T11:06:28Z'))
  })

  it('DDM: their reply is newer than anything we pressed, so the card says they replied', () => {
    const p = pickPulse(
      [action('send_email', '2026-08-16T15:00:00Z')],
      reply('2026-08-17T08:32:00Z'),
    )
    expect(p!.kind).toBe('replied')
    expect(p!.label).toBe('They replied')
    expect(p!.preview).toContain('best and final')
  })

  it('a reply with no cockpit press behind it still shows', () => {
    const p = pickPulse([], reply('2026-08-17T08:32:00Z'))
    expect(p!.kind).toBe('replied')
  })

  it('a press with no reply behind it still shows', () => {
    const p = pickPulse([action('fetch_ballpark', '2026-08-17T09:00:00Z')], null)
    expect(p!.kind).toBe('done')
  })

  it('nothing has happened means no chip, not an empty one', () => {
    expect(pickPulse([], null)).toBeNull()
  })
})

describe('non-events stay off the card', () => {
  it('hold, a note or a comparison never bury the last real move', () => {
    // A hold pressed after a send must not turn "Email sent" into "Held":
    // the card answers "what happened to this deal", and nothing happening
    // is not an answer worth a chip.
    const p = pickPulse([
      action('hold', '2026-08-17T12:00:00Z'),
      action('add_note', '2026-08-17T11:30:00Z'),
      action('send_email', '2026-08-17T11:06:28Z'),
    ], null)
    expect(p!.label).toBe('Email sent')
    for (const quiet of PULSE_SILENT) {
      expect(['hold', 'add_note', 'compare_comps']).toContain(quiet)
    }
  })

  it('only silent presses on file means no chip', () => {
    expect(pickPulse([action('hold', '2026-08-17T12:00:00Z')], null)).toBeNull()
  })
})

describe('the labels', () => {
  it('speak plain English for every button on the cockpit', () => {
    expect(pulseLabel('send_email')).toBe('Email sent')
    expect(pulseLabel('mark_lost')).toBe('Sent to Lost')
    expect(pulseLabel('escalate_hugo')).toBe('Sent to Hugo')
    expect(pulseLabel('fetch_ballpark')).toBe('Ballpark armed')
    expect(pulseLabel('book_followup')).toBe('Follow-up booked')
  })

  it('an action nobody mapped still reads as words, not a slug', () => {
    expect(pulseLabel('assemble_widget')).toBe('Assemble widget')
  })

  it('never a long dash, anywhere', () => {
    for (const a of ['send_email', 'mark_lost', 'escalate_hugo', 'fetch_ballpark',
      'book_builder', 'book_followup', 'move_stage', 'call_branch',
      'draft_offer_email', 'draft_counter_reply']) {
      expect(pulseLabel(a)).not.toMatch(/[–—‘’“”…]/)
    }
  })

  it('a long reply is capped before it becomes a tooltip', () => {
    const p = pickPulse([], reply('2026-08-17T08:32:00Z', 'x'.repeat(500)))
    expect(p!.preview!.length).toBeLessThanOrEqual(140)
  })
})

describe('the wiring is real, not just the logic', () => {
  it('the board renders the chip', () => {
    const page = readFileSync('src/features/crm/pages/PipelinesPage.tsx', 'utf8')
    expect(page).toMatch(/DealPulseChip/)
    expect(page).toMatch(/useDealPulse/)
  })

  it('the hook reads the same two streams the cockpit reads', () => {
    const hook = readFileSync('src/features/crm/hooks/useDealPulse.ts', 'utf8')
    // Executed cockpit presses, from the one log the cockpit itself writes.
    expect(hook).toMatch(/wk_deal_manager_log/)
    expect(hook).toMatch(/action_executed/)
    // And the branch's own messages, inbound only.
    expect(hook).toMatch(/wk_sms_messages/)
    expect(hook).toMatch(/'inbound'/)
  })

  it('the hook chunks its in() filters like every other board hook', () => {
    // One giant in.(...) on a 1,100-card board built a URL past the server
    // limit once before (useContactChannelStatus, found 2026-07-26). Never
    // again by construction.
    const hook = readFileSync('src/features/crm/hooks/useDealPulse.ts', 'utf8')
    expect(hook).toMatch(/CHUNK/)
  })
})

describe('the closing ask is a standing habit, not a one off', () => {
  // Hugo, 2026-08-17, reading the DDM best-and-final reply: "as a closure we
  // should be adding as well, and make that a habit for the future: keep an
  // eye out, if a future property comes across, think of us as a cash buyer,
  // any property that needs to be redone and can go at a discount."
  it('a hold or pass reply always ends by asking to be kept in mind', () => {
    const src = readFileSync('api/crm/draft-offer-email.ts', 'utf8')
    expect(src).toMatch(/keep us in mind/i)
    expect(src).toMatch(/cash buyers/i)
    expect(src).toMatch(/needs work and could go at a discount/i)
  })
})

describe('the Today panel never lies while loading', () => {
  it('says it is reading, not that the brain is off, until the answer is in', () => {
    // Seen live 2026-08-17: the flag defaults to false, the request is slow,
    // and the panel printed "The deal brain is off" over a brain that was on.
    // The panel gained a shut state on 2026-08-21, so there is a branch in
    // front of this one now. What must stay true is the ORDER: loading is
    // answered before the brain flag, never after it.
    const panel = readFileSync('src/features/crm/components/deals/TodayPanel.tsx', 'utf8')
    expect(panel).toMatch(/loading \? 'Reading the day\.\.\.'\s*\n?\s*: managerOn/)
  })

  it('a shut panel says neither, because it has not asked yet', () => {
    // Shut, nothing is fetched at all, so claiming the brain is on OR off
    // would be the same lie in a different direction.
    const panel = readFileSync('src/features/crm/components/deals/TodayPanel.tsx', 'utf8')
    expect(panel).toMatch(/!open \? '[^']+'/)
    expect(panel).toMatch(/if \(open\) void load\(\)/)
  })
})
