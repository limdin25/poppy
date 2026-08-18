// I MOVED IT. THAT IS THE ANSWER.
//
// Hugo, 2026-08-17, on Barrie Crescent: "I moved to ready for the 2nd call but
// still at cockpit, I think when I do that it should be removed."
//
// And then, rejecting a first version that booked Pedro's callback along with
// the move: "it is not obliged to book the time for the follow up. When I move
// a lead to a pipeline column, that's it. If I'm in the cockpit and I move to a
// column, it goes away from the cockpit."
//
// So the move alone clears the card. No second press, no time on it.
//
// WHY THE PRESS AND NOT THE COLUMN, which is the part that will bite anyone who
// tries to simplify this: `wk_contacts.stage_moved_at` changes on EVERY column
// write, and most of them are the machine's. A discovery call outcome moves a
// card into "Discovery done, evaluating", and hiding on that stamp would hide
// the exact deal the cockpit exists to price. Only a human pressing Move the
// stage counts, so the signal comes from the press log.
//
// SAID PLAINLY, because it is Hugo's call and he made it twice: a card set
// aside this way has no time on it, so nothing re-surfaces it on its own. It is
// on the board in the column he chose, and the cockpit footer counts it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDealState, type DealStateInput } from '../api/lib/deal-state'
import { isCockpitDeal, cockpitDeals } from '../api/lib/cockpit-filter'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const ROUTE = read('api/crm/cockpit-action.ts')
const LIST = read('api/crm/cockpit.ts')
const RUN = read('api/lib/deal-manager-run.ts')
const DIALOG = read('src/features/crm/components/cockpit/ActionConfirmDialog.tsx')
const PAGE = read('src/features/crm/pages/DealCockpitPage.tsx')

const NOW = new Date('2026-08-17T18:00:00Z')
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

/** Barrie Crescent as it sat on the board: a real conversation, the ballpark
 *  in, and Hugo has just moved it to Ready for call 2 by hand. */
const barrie = (over: Partial<DealStateInput> = {}) => buildDealState({
  property: { id: 'barrie', address: 'Barrie Crescent, Sheffield, S5 8RL', asking_price: 120000 },
  contact: { id: 'c1' },
  columnName: 'Ready for call 2',
  calls: [{ id: 'k1', created_at: at(-72), disposition: 'Qualified', duration_sec: 400 }],
  now: NOW,
  ...over,
})

describe('the card Hugo moved', () => {
  it('is on the desk while nobody has moved it', () => {
    const d = isCockpitDeal(barrie(), NOW)
    expect(d.inCockpit).toBe(true)
    expect(d.why).toBe('live_column')
  })

  it('LEAVES the moment he moves it, with no time on it and no second press', () => {
    const d = isCockpitDeal(barrie(), NOW, { handMovedAt: at(-0.5) })
    expect(d.inCockpit).toBe(false)
    expect(d.why).toBe('moved_by_hand')
    expect(d.reason).toContain('Ready for call 2')
  })

  it('names what brings it back, because nothing else will', () => {
    const d = isCockpitDeal(barrie(), NOW, { handMovedAt: at(-0.5) })
    expect(d.reason).toMatch(/comes back if they write or a follow up comes due/)
  })

  it('comes straight back when the branch writes AFTER the move', () => {
    const d = isCockpitDeal(barrie({
      messages: [{ id: 'm1', created_at: at(-0.1), direction: 'inbound', body: 'The vendor said no.' }],
    }), NOW, { handMovedAt: at(-0.5) })
    expect(d.inCockpit).toBe(true)
    expect(d.why).toBe('branch_replied')
  })

  it('stays away when their message came BEFORE the move: he moved it knowing', () => {
    const d = isCockpitDeal(barrie({
      messages: [{ id: 'm1', created_at: at(-6), direction: 'inbound', body: 'Anything on this one?' }],
    }), NOW, { handMovedAt: at(-0.5) })
    expect(d.inCockpit).toBe(false)
    expect(d.why).toBe('moved_by_hand')
  })

  it('comes back when a follow up somebody booked comes due', () => {
    const d = isCockpitDeal(barrie({
      followups: [{ id: 'f1', due_at: at(-1), status: 'pending', note: 'Ring Eva' }],
    }), NOW, { handMovedAt: at(-3) })
    expect(d.inCockpit).toBe(true)
    expect(d.why).toBe('overdue_followup')
  })

  it('with no hand move passed at all, nothing changes for anybody else', () => {
    expect(isCockpitDeal(barrie(), NOW, {}).inCockpit).toBe(true)
    expect(cockpitDeals([{ state: barrie() }], NOW)).toHaveLength(1)
    expect(cockpitDeals([{ state: barrie() }], NOW, () => at(-1))).toHaveLength(0)
  })
})

describe('the press does the move and nothing else', () => {
  const move = ROUTE.slice(ROUTE.indexOf("case 'move_stage'"), ROUTE.indexOf("case 'mark_lost'"))

  it('moves by id, and refuses a stage that no longer exists', () => {
    expect(move).toMatch(/moveCardToId\(supabase, bundle\.contactId, body\.columnId\)/)
    expect(move).toMatch(/refused: 'unknown_stage'/)
  })

  it('books NOTHING. Hugo: it is not obliged to book the time', () => {
    expect(move).not.toMatch(/wk_contact_followups/)
    expect(move).not.toMatch(/suggestCallbackAt/)
  })

  it('the machine still never moves a card: a human press only', () => {
    expect(move).not.toMatch(/verdict|assessment|manager/i)
  })
})

describe('where the signal comes from', () => {
  it('the press log, filtered to a human pressing Move the stage', () => {
    const fn = RUN.slice(RUN.indexOf('export async function latestHandMoves'), RUN.indexOf('export async function latestAssessments'))
    expect(fn).toMatch(/\.eq\('kind', 'action_executed'\)/)
    expect(fn).toMatch(/\.eq\('action', 'move_stage'\)/)
    expect(fn).toMatch(/\.eq\('source', 'human'\)/)
  })

  it('NEVER from stage_moved_at, which the machine writes too', () => {
    const loop = LIST.slice(LIST.indexOf('for (const b of bundles)'), LIST.indexOf('const shaped ='))
    expect(loop).toMatch(/handMovedAt: handMoved\.get\(b\.state\.propertyId\)/)
    expect(loop).not.toMatch(/stage_moved_at|board\.movedAt/)
  })

  it('a press log that cannot be read shows MORE, never less', () => {
    // Failing the other way would empty the desk on a database hiccup.
    const fn = RUN.slice(RUN.indexOf('export async function latestHandMoves'), RUN.indexOf('export async function latestAssessments'))
    expect(fn).toMatch(/catch/)
    expect(fn).not.toMatch(/throw/)
  })
})

describe('a card set aside this way is never invisible', () => {
  it('the footer counts it, in Hugo\'s own terms', () => {
    expect(PAGE).toMatch(/you moved on the board/)
    expect(PAGE).toMatch(/setAside\.moved_by_hand/)
  })

  it('the gate says what the move does before the press', () => {
    expect(DIALOG).toMatch(/cockpit-move-clears-desk/)
    expect(DIALOG).toMatch(/takes it off the cockpit/)
    expect(DIALOG).toMatch(/stays on the board where you put/)
  })
})

// ---------------------------------------------------------------------------
// AND THE BUTTON THAT WAS DEAD ON ARRIVAL
// ---------------------------------------------------------------------------
//
// Hugo, same screenshot, a valid date in the box: "when I choose the time, the
// button to confirm is inactive." The dry run fired once, on open, and sent no
// time, so the checks correctly blocked, and nothing typed into the field ever
// asked the server again. Booking a follow up from the cockpit had been
// impossible since the button shipped.

describe('booking a follow up from the cockpit', () => {
  it('re-runs the checks when the time changes', () => {
    expect(DIALOG).toMatch(/TIMED_ACTIONS\.includes\(action\)/)
    expect(DIALOG).toMatch(/dueAt: iso\.toISOString\(\)/)
    expect(DIALOG).toMatch(/\}, \[dueAt, action, deal\.propertyId, run\]\)/)
  })

  it('only the newest answer counts, and a failed re-check never unlocks it', () => {
    expect(DIALOG).toMatch(/if \(seq === dueSeq\.current\) setReport\(res\.report\)/)
  })

  it('opens with a time already in the box', () => {
    expect(ROUTE).toMatch(/action === 'fetch_ballpark' \|\| action === 'book_followup'/)
  })

  it('and says "no time picked" rather than "that time has passed"', () => {
    const src = read('api/lib/deal-stress-test.ts')
    expect(src).toMatch(/block\('due_picked', 'No time has been picked yet'/)
    expect(src).toMatch(/block\('due_in_future', 'That time has already passed'/)
  })
})
