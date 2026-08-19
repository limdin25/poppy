// The builder viewing booked at the disposition, in UK time, with the note
// that survives all the way to the cockpit calendar.
//
// Hugo, 2026-08-19: "build a calendar next to the call disposition. If you
// book a builder we can add the date there right after the call. UK time.
// And it reflects on the cockpit's calendar." Same day, Pedro's screenshot:
// "it doesnt show my note about the viewing schedule". The note he typed
// into the post-call quick note never reached the follow-up row, and viewing
// items returned note:null by construction. Both leaks are pinned shut here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ukInputToIso, isoToUkInput, ukHour, ukDateKey } from '../src/features/crm/lib/ukTime'

const read = (p: string) => readFileSync(p, 'utf8')

describe('UK wall time, wherever the laptop is', () => {
  it('summer: 2pm typed is 1pm UTC (London is BST)', () => {
    expect(ukInputToIso('2026-08-21T14:00')).toBe('2026-08-21T13:00:00.000Z')
  })

  it('winter: 2pm typed is 2pm UTC (London is GMT)', () => {
    expect(ukInputToIso('2026-01-21T14:00')).toBe('2026-01-21T14:00:00.000Z')
  })

  it('round-trips: the instant renders back as the same London wall time', () => {
    expect(isoToUkInput('2026-08-21T13:00:00.000Z')).toBe('2026-08-21T14:00')
    expect(isoToUkInput('2026-01-21T14:00:00.000Z')).toBe('2026-01-21T14:00')
  })

  it('ukHour reads the London hour, not the machine hour', () => {
    expect(ukHour('2026-08-21T13:00:00.000Z')).toBe(14)
    expect(ukHour('2026-08-21T23:30:00.000Z')).toBe(0)
  })

  it('ukDateKey gives London its own midnight: 11pm UTC in August is already tomorrow', () => {
    expect(ukDateKey('2026-08-21T23:30:00.000Z')).toBe('2026-08-22')
  })
})

describe('the booking route', () => {
  const route = read('api/crm/book-viewing.ts')

  it('is agent-or-admin, like every other CRM door', () => {
    expect(route).toMatch(/wk_is_agent_or_admin/)
  })

  it('writes viewing_at, and the note only when one was given', () => {
    expect(route).toMatch(/viewing_at: new Date\(atMs\)\.toISOString\(\)/)
    expect(route).toMatch(/\.\.\.\(note \? \{ viewing_notes: note \} : \{\}\)/)
  })

  it('requires no builder: the date is the call\'s product, the builder is Hugo\'s', () => {
    expect(route).not.toMatch(/builderId/)
  })
})

describe('the disposition side', () => {
  const panel = read('src/features/crm/components/live-call/PostCallPanel.tsx')

  it('shows the viewing box on property calls only', () => {
    expect(panel).toMatch(/isPropertyCall = endedContact\?\.customFields\?\.lead_type === 'estate_agent'/)
    expect(panel).toMatch(/\{isPropertyCall && listings\.length > 0 && \(/)
  })

  it('converts the typed time as UK wall time and falls back to the quick note', () => {
    expect(panel).toMatch(/ukInputToIso\(dueLocal\)/)
    expect(panel).toMatch(/note: note\.trim\(\) \|\| quickNote\.trim\(\) \|\| null/)
  })

  it('hands the quick note to the follow-up modal, the exact leak in Pedro\'s screenshot', () => {
    expect(panel).toMatch(/initialNote=\{quickNote\}/)
  })
})

describe('the follow-up modal books in UK time and starts from the quick note', () => {
  const modal = read('src/features/crm/components/followups/FollowupPromptModal.tsx')

  it('due_at is the typed wall time read as London', () => {
    expect(modal).toMatch(/const dueIso = ukInputToIso\(dueLocal\)/)
    expect(modal).toMatch(/due_at: dueIso/)
  })

  it('the working-hours warning checks the LONDON hour', () => {
    expect(modal).toMatch(/ukHour\(dueIso\)/)
  })

  it('the note starts as the quick note and the label says UK', () => {
    expect(modal).toMatch(/setNote\(initialNote\)/)
    expect(modal).toMatch(/Due \(UK time\)/)
  })
})

describe('the cockpit calendar carries the note to the card and the opened day', () => {
  it('viewing items return the booking note, never a hardcoded null', () => {
    const api = read('api/crm/cockpit-calendar.ts')
    expect(api).toMatch(/viewing_notes/)
    expect(api).toMatch(/note: v\.viewing_notes/)
  })

  it('the grid is a month view with a full day pane, and the card renders the note', () => {
    const grid = read('src/features/crm/components/cockpit/CockpitCalendar.tsx')
    expect(grid).toMatch(/data-testid="cockpit-calendar-grid"/)
    expect(grid).toMatch(/data-testid="cockpit-calendar-day"/)
    expect(grid).toMatch(/\{it\.note\}/)
    // UK date bucketing, so a late-evening UTC booking lands on the right day.
    expect(grid).toMatch(/ukDateKey\(it\.at\)/)
  })
})
