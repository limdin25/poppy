// THE GATE SAYS WHERE THE CARD LANDS, BEFORE THE PRESS.
//
// Hugo, 2026-08-17: "when you're on the cockpit and send an email, it shows
// the suggested column of the pipeline where it should go after the email is
// sent... and also gives me the drop down if I wanna choose a different one.
// Everywhere we are on the CRM we know which stage the lead is and we can
// change it."
//
// Until now the move was real but invisible: pressing send quietly moved the
// card to "Waiting on their answer" and Hugo only found out by going to the
// board. The destination is now part of the approval itself: one suggestion,
// one dropdown, and the human's choice is what the server honours.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { suggestedMoveFor } from '../api/lib/deal-stress-test'

describe('the suggestion mirrors what the press actually does', () => {
  it('a reply on price moves to Waiting on their answer, from both reply columns', () => {
    expect(suggestedMoveFor('send_email', 'Offer sent')).toBe('Waiting on their answer')
    expect(suggestedMoveFor('send_email', 'Nurturing')).toBe('Waiting on their answer')
  })

  it('the draft actions show the same destination, because the gate opens on the draft', () => {
    // The human is looking at the dialog while it still says draft_counter_reply;
    // the press it leads to is send_email. Showing "no move" on the draft and
    // then moving on the send would be the same lie one screen earlier.
    expect(suggestedMoveFor('draft_counter_reply', 'Nurturing')).toBe('Waiting on their answer')
    expect(suggestedMoveFor('draft_offer_email', 'Offer sent')).toBe('Waiting on their answer')
  })

  it('a call-one email never moves a card', () => {
    expect(suggestedMoveFor('send_email', 'Discovery done, evaluating')).toBeNull()
    expect(suggestedMoveFor('draft_video_email', 'Discovery done, evaluating')).toBeNull()
  })

  it('Send to Lost lands in Not interested, from anywhere', () => {
    expect(suggestedMoveFor('mark_lost', 'Offer sent')).toBe('Not interested')
    expect(suggestedMoveFor('mark_lost', null)).toBe('Not interested')
  })

  it('confirming the ballpark lands in Ready for call 2', () => {
    expect(suggestedMoveFor('fetch_ballpark', 'Discovery done, evaluating')).toBe('Ready for call 2')
  })

  it('everything that moves nothing says nothing', () => {
    for (const quiet of ['hold', 'call_branch', 'book_followup', 'add_note',
      'compare_comps', 'escalate_hugo'] as const) {
      expect(suggestedMoveFor(quiet, 'Nurturing')).toBeNull()
    }
  })
})

describe('the route serves the suggestion and honours the choice', () => {
  const route = readFileSync('api/crm/cockpit-action.ts', 'utf8')

  it('the dry run carries afterMove, so the dialog can show it', () => {
    expect(route).toMatch(/afterMove/)
    expect(route).toMatch(/suggestedMoveFor/)
  })

  it('the record phase takes the column the human picked', () => {
    // Three states, and all three matter: a string moves there, an explicit
    // null means the human said "leave it where it is" and beats the default,
    // and absent means the default road. Without the null case, vetoing the
    // move would be impossible: the server would move the card anyway.
    expect(route).toMatch(/afterColumnId/)
    expect(route).toMatch(/afterColumnId === null/)
  })

  it('the chase is only booked when the card lands in Waiting on their answer', () => {
    // A human who sends the email and files the branch under Not interested
    // must not get a "ring and chase them" appointment for a door they closed.
    const record = route.slice(route.indexOf("body.phase === 'record'"), route.indexOf('await logEvent'))
    expect(record).toMatch(/landed === 'Waiting on their answer'/)
  })
})

describe('the dialog shows it and the panel makes the stage clickable', () => {
  it('the email gate has the destination dropdown', () => {
    const dlg = readFileSync('src/features/crm/components/cockpit/ActionConfirmDialog.tsx', 'utf8')
    expect(dlg).toMatch(/cockpit-after-move/)
    // and the human's choice travels on the record call, where the move happens
    expect(dlg).toMatch(/phase: 'record'[\s\S]{0,400}afterColumnId/)
  })

  it('the stage chip on the command panel opens the move, not just decorates', () => {
    // "Everywhere we are on the CRM we know which stage the lead is and we can
    // change it." The cockpit showed the stage as dead text; the one screen
    // built for acting on a deal was the one screen you could not act from.
    const panel = readFileSync('src/features/crm/components/cockpit/CockpitCommandPanel.tsx', 'utf8')
    expect(panel).toMatch(/cockpit-stage-chip/)
    expect(panel).toMatch(/request\('move_stage'\)/)
  })
})
