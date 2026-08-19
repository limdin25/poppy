// "HOLD, NOTHING TODAY" MUST MEAN WHAT IT SAYS.
//
// 2026-08-17. Hugo screenshotted the Zest Hull card, the best-evidenced deal on
// the board, reading "Hold, nothing today", and said the brain should have been
// telling him to send the email.
//
// The brain WAS. Read back from wk_deal_manager_log, it had decided eight times
// in a row: "Offer of 103,600 is placed and Lucy is waiting on proof of funds.
// Email Pedro your bank statement", who=HUGO. Two independent faults turned that
// into the opposite words on the screen, and this file pins both shut.
//
//   FAULT 1  escalate_hugo was legal in only two columns and the deal sat in
//            Nurturing, so the one verb that fitted did not exist and the
//            decision fell through to `hold`, whose button reads "Hold, nothing
//            today".
//
//   FAULT 2  every one of those rows carried the flag blocked_needs_hugo, which
//            wk_deal_manager_log_read hides from anyone who is not an admin. The
//            screenshot was a PEDRO session. His cockpit found no readable
//            assessment, silently fell back to a two day old deterministic
//            brief, and printed a Hold button on a live deal.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildDealState, THREAD_BODY_CAP, type DealStateInput } from '../api/lib/deal-state'
import {
  validateVerdict, allowedActions, UNIVERSAL_ACTIONS, ACTIONS_BY_STAGE,
  PROMPT_VERSION,
} from '../api/lib/deal-manager-contract'
import { PRIMARY_BUTTON_FOR, primaryButtonFor, COCKPIT_ACTIONS } from '../src/features/crm/components/cockpit/cockpitActions'

const NOW = new Date('2026-08-17T07:00:00Z')

/** Zest Hull as it actually sat: Nurturing, offer placed, blocked on funds. */
const zest = (over: Partial<DealStateInput> = {}) => buildDealState({
  property: {
    id: 'zest',
    address: 'Welwyn Park Road, Hull, North Humberside, HU6',
    asking_price: 125000,
    deal: {
      cmv: { estimate: 129500, confidence: 'high', comps: 15 },
      gdv: { estimate: 140000 },
      offer: { open: 103600, max: 103600, ladder: [103600] },
    },
  },
  columnName: 'Nurturing',
  now: NOW,
  ...over,
})

describe('fault 1: the brain always has a verb for "this one is Hugo\'s"', () => {
  it('escalate_hugo is legal in EVERY column', () => {
    expect(UNIVERSAL_ACTIONS).toContain('escalate_hugo')
    // Every named stage, plus a column the board does not have.
    for (const column of [...Object.keys(ACTIONS_BY_STAGE), 'Some New Column', null]) {
      expect(allowedActions(column)).toContain('escalate_hugo')
    }
  })

  it('was NOT legal in Nurturing before, which is the bug', () => {
    // The stage's own list still does not name it: it is universal, which is
    // the point. If someone "tidies up" by moving it into the per-stage lists,
    // the next column somebody adds reopens this hole.
    expect(ACTIONS_BY_STAGE.Nurturing).not.toContain('escalate_hugo')
  })

  it('escalate_hugo points at a real button', () => {
    expect(PRIMARY_BUTTON_FOR.escalate_hugo).toBe('escalate_hugo')
    expect(COCKPIT_ACTIONS.escalate_hugo.label).toBe('Send it to Hugo')
  })
})

describe('fault 1b: hold and who=HUGO cannot both be true', () => {
  const zestVerdict = {
    attention: 88,
    action: 'hold',
    who: 'HUGO',
    instruction: 'Offer of 103,600 is placed and Lucy is waiting on proof of funds. Email Pedro your bank statement.',
    flags: ['blocked_needs_hugo'],
    evidence: ['money.open'],
    confidence: 'high',
  }

  it('repairs the contradiction into escalate_hugo', () => {
    const out = validateVerdict(zestVerdict, zest())
    expect(out.ok).toBe(true)
    if (out.ok !== true) return
    expect(out.verdict.action).toBe('escalate_hugo')
    expect(out.repaired).toBe('hold_with_who_hugo_became_escalate_hugo')
  })

  it('KEEPS the instruction word for word', () => {
    // The instruction is the valuable part. This is why it is repaired and not
    // refused: `assess` does not retry, so a refusal would throw the correct
    // order away and fall back to the blank card Hugo was already looking at.
    const out = validateVerdict(zestVerdict, zest())
    if (out.ok !== true) throw new Error('should have passed')
    expect(out.verdict.instruction).toBe(zestVerdict.instruction)
    expect(out.verdict.confidence).toBe('high')
    expect(out.verdict.attention).toBe(88)
  })

  it('the repaired verdict no longer points at the Hold button', () => {
    const out = validateVerdict(zestVerdict, zest())
    if (out.ok !== true) throw new Error('should have passed')
    expect(primaryButtonFor(out.verdict.action)).not.toBe('hold')
    expect(COCKPIT_ACTIONS[primaryButtonFor(out.verdict.action)].label)
      .not.toBe('Hold, nothing today')
  })

  it('leaves an HONEST hold alone', () => {
    // A deal whose next move is a callback already booked for Monday is a real
    // hold. Inventing work for it would be the opposite mistake.
    for (const who of ['PEDRO', 'NOBODY'] as const) {
      const out = validateVerdict(
        { ...zestVerdict, who, instruction: 'Callback is booked for Monday. Nothing to do today.' },
        zest(),
      )
      expect(out.ok).toBe(true)
      if (out.ok !== true) return
      expect(out.verdict.action).toBe('hold')
      expect(out.repaired).toBeUndefined()
    }
  })

  it('a straight escalate_hugo passes untouched', () => {
    const out = validateVerdict({ ...zestVerdict, action: 'escalate_hugo' }, zest())
    expect(out.ok).toBe(true)
    if (out.ok !== true) return
    expect(out.verdict.action).toBe('escalate_hugo')
    expect(out.repaired).toBeUndefined()
  })
})

describe('the prompt was bumped, or the whole board keeps its stale answers', () => {
  it('PROMPT_VERSION is past the version that shipped the bug', () => {
    // It is folded into the state hash, so without the bump a prompt rewrite
    // sits invisible behind the dedupe forever.
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(7)
  })

  it('the prompt tells the model the rule, so the repair is a backstop', () => {
    const brain = readFileSync('api/lib/deal-brain.ts', 'utf8')
    expect(brain).toMatch(/Never `hold` with who=HUGO/)
    expect(brain).toMatch(/escalate_hugo.*allowed in EVERY column/)
  })
})

describe('fault 2: a hidden order never leaves a Hold button behind', () => {
  it('the cockpit asks who is blocked on Hugo, through the CALLER client', () => {
    const src = readFileSync('api/crm/cockpit.ts', 'utf8')
    expect(src).toMatch(/wk_deals_blocked_on_hugo/)
    // The caller's client, not the service role: the function answers only for
    // someone already allowed in the CRM.
    expect(src).toMatch(/blockedOnHugo\(caller,/)
    // Both read paths, the list and the single deal, or one of the two screens
    // keeps the bug.
    expect(src.match(/blockedOnHugo\(caller,/g)?.length).toBe(2)
  })

  it('the signal carries a timestamp and NOTHING else', () => {
    const sql = readFileSync('supabase/migrations/20260817000001_blocked_on_hugo.sql', 'utf8')
    expect(sql).toMatch(/returns table \(property_id uuid, since timestamptz\)/)
    // If any of these ever appear in the projection, the RLS policy this works
    // around has been defeated rather than worked with.
    for (const leak of ['l.instruction', 'l.evidence', 'l.state', 'l.attention']) {
      expect(sql).not.toContain(leak)
    }
    expect(sql).toMatch(/revoke all on function/)
  })

  it('the panel shows the waiting card instead of an order, with no Hold button', () => {
    const panel = readFileSync('src/features/crm/components/cockpit/CockpitCommandPanel.tsx', 'utf8')
    expect(panel).toMatch(/deal\.blockedOnHugo \?/)
    expect(panel).toMatch(/cockpit-blocked-on-hugo/)
    expect(panel).toMatch(/Hugo is on this one/)
    // The order block and its primary button live in the OTHER branch of the
    // ternary, so a blocked deal cannot render them.
    const blocked = panel.slice(panel.indexOf('deal.blockedOnHugo ?'), panel.indexOf('cockpit-order'))
    expect(blocked).not.toContain('cockpit-primary-action')
  })

  it('the queue row hides it too', () => {
    // The row previewed the same stale instruction, so fixing only the panel
    // would have left "Hold, nothing today" in the list Hugo scans first.
    const queue = readFileSync('src/features/crm/components/cockpit/CockpitQueue.tsx', 'utf8')
    expect(queue).toMatch(/deal\.blockedOnHugo \?/)
    expect(queue).toMatch(/Hugo is on this one/)
  })
})

describe('a dead machine is visible on the screen, not only in an email', () => {
  it('a run that STARTS and dies is a fault, not a fresh heartbeat', () => {
    // The hole that hid three failed nights: the pipeline pulses "started" the
    // moment it begins, so the 26 hour age check was satisfied by a run that
    // was OOM-killed at 02:13. Nothing asked whether it ever reached the end.
    const src = readFileSync('api/cron/system-deadman.ts', 'utf8')
    expect(src).toMatch(/VPS_STARTED_STALE_HOURS/)
    expect(src).toMatch(/vps\.extra !== 'complete'/)
    expect(src).toMatch(/VPS overnight died part way/)
  })

  it('the cockpit reads the SAME stamps the dead man reads', () => {
    // Two sources of truth for "is the machine alive" is how you get a green
    // tick on a broken system.
    const src = readFileSync('api/crm/cockpit.ts', 'utf8')
    expect(src).toMatch(/vps_overnight_last_ok_at/)
    expect(src).toMatch(/deal_sweep_last_ok_at/)
    expect(src).toMatch(/machine: await machineHealth/)
  })

  it('platform_settings.value is PARSED, because the column is text not jsonb', () => {
    // Caught by running it: the first live response said the overnight machine
    // had "never reported in" on a day it had pulsed at 23:30. Reading a text
    // column as an object gives undefined for every field, and undefined reads
    // exactly like "never happened".
    const src = readFileSync('api/crm/cockpit.ts', 'utf8')
    const fn = src.slice(src.indexOf('async function machineHealth'))
    expect(fn).toMatch(/JSON\.parse\(String\(s \?\? '\{\}'\)\)/)
    expect(fn).not.toMatch(/value: Record<string, unknown>/)
  })

  it('a check that could not run is never reported as healthy', () => {
    const src = readFileSync('api/crm/cockpit.ts', 'utf8')
    const fn = src.slice(src.indexOf('async function machineHealth'))
    // Both the error path and the throw path answer `ok: null`, not `ok: true`.
    expect(fn).toMatch(/if \(error\) return \{ ok: null, problems: \[\] \}/)
    expect(fn).toMatch(/catch \{\s*return \{ ok: null, problems: \[\] \};/)
  })

  it('the sweep check only runs inside the hours the sweep runs', () => {
    // Otherwise a healthy overnight silence reads as a fault every morning,
    // and a banner that cries wolf is a banner nobody reads.
    const src = readFileSync('api/crm/cockpit.ts', 'utf8')
    expect(src).toMatch(/hourUtc >= 6 && hourUtc <= 20/)
  })

  it('the banner renders on the page', () => {
    const page = readFileSync('src/features/crm/pages/DealCockpitPage.tsx', 'utf8')
    expect(page).toMatch(/cockpit-machine-broken/)
    expect(page).toMatch(/machine\?\.problems\.length/)
  })
})

describe('three roads after call two, not just after call one', () => {
  it('a deal with the ballpark agreed can go offer, builder, or lost', () => {
    // Hugo, 17 Aug: "after 2nd call same thing, tell us if lost and or we
    // should book a builder."
    const legal = allowedActions('Ballpark agreed')
    expect(legal).toContain('send_offer_email')   // the offer goes out
    expect(legal).toContain('book_builder')       // price the work first
    expect(legal).toContain('close_lost')         // the door is shut
  })

  it('the builder road was unreachable before, which is the bug', () => {
    // book_builder was legal ONLY in the viewing column (then called Needs
    // viewing, renamed Viewing booked 19 Aug), and nothing moved a card into
    // it on its own, so from the column deals actually land in the brain had
    // no way to say "get a builder round first".
    expect(ACTIONS_BY_STAGE['Viewing booked']).toContain('book_builder')
    expect(PRIMARY_BUTTON_FOR.book_builder).toBe('book_builder')
  })

  it('the prompt names the three roads in words', () => {
    const brain = readFileSync('api/lib/deal-brain.ts', 'utf8')
    expect(brain).toMatch(/THREE ROADS AGAIN AFTER CALL TWO/)
    expect(brain).toMatch(/The builder IS the viewing/)
  })
})

describe('the gate tests the words in the box, and answers fast', () => {
  // Hugo ticked "best and final" and the button stayed grey ("not clickable,
  // i am logged in"). Three faults in one flow, each pinned here.

  it('a check that carries edited text never regenerates the draft', () => {
    // Regenerating meant ~10s of model time to answer a question about text
    // the server already had, and a report describing a DIFFERENT draft from
    // the one in the box.
    const src = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    expect(src).toMatch(/const hasEditedText = Boolean\(/)
    expect(src).toMatch(/if \(body\.draft\?\.kind && !hasEditedText\)/)
  })

  it('only the newest recheck answer may set the report', () => {
    // Ticking the box blurs the textarea, so an un-flagged recheck races the
    // flagged one, and whichever landed last used to win.
    const dlg = readFileSync('src/features/crm/components/cockpit/ActionConfirmDialog.tsx', 'utf8')
    expect(dlg).toMatch(/const seq = \+\+recheckSeq\.current/)
    expect(dlg).toMatch(/if \(seq === recheckSeq\.current\) setReport\(res\.report\)/)
  })

  it('accepting the best-and-final counts as reading the warnings', () => {
    const dlg = readFileSync('src/features/crm/components/cockpit/ActionConfirmDialog.tsx', 'utf8')
    expect(dlg).toMatch(/if \(e\.target\.checked\) setAcknowledged\(true\)/)
  })
})

describe('the email writer reads the whole file, not a slice', () => {
  // Hugo, 17 Aug, reading a "best and final" draft on a deal where the branch
  // had ALREADY agreed to put the figure forward and was waiting on the proof
  // of funds the email itself attached without mentioning: "the brain is not
  // checking all the emails exchanged... is just writing a random email."
  // The deciding brain HAD read all of it. The writer was handed the figures
  // and a subject line.

  it('the state carries the thread, and the sweep no longer throws it away', () => {
    const s = buildDealState({
      property: { id: 'p1', address: 'X', asking_price: 100000 },
      columnName: 'Nurturing',
      messages: [
        { id: 'm2', created_at: '2026-08-16T10:00:00Z', direction: 'inbound', subject: 'Welwyn Park', body: 'Happy to put it forward once we have proof of funds.' },
        { id: 'm1', created_at: '2026-08-15T10:00:00Z', direction: 'outbound', subject: 'Welwyn Park', body: 'Our offer as discussed.' },
      ],
      now: NOW,
    })
    expect(s.writing.thread).toHaveLength(2)
    // Oldest first, the way a person reads a thread.
    expect(s.writing.thread[0].direction).toBe('outbound')
    expect(s.writing.thread[1].body).toContain('proof of funds')
  })

  it('the thread is capped so a chatty branch cannot blow the prompt', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      created_at: `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
      direction: 'inbound',
      body: 'x'.repeat(5000),
    }))
    const s = buildDealState({
      property: { id: 'p1', address: 'X', asking_price: 100000 },
      columnName: 'Nurturing', messages: many, now: NOW,
    })
    expect(s.writing.thread.length).toBeLessThanOrEqual(6)
    // The cap moved from 900 to 2,400 on 17 Aug because 900 cut our own offer
    // email off mid sentence, three words before it explained how the purchase
    // completes (tests/bridge-is-how-we-buy.test.ts). It is still a cap, and a
    // cut still says it was cut, which is the part that had been missing.
    for (const m of s.writing.thread) {
      expect(m.body.length).toBeLessThanOrEqual(THREAD_BODY_CAP + 60)
      expect(m.body).toMatch(/the rest of this message is not shown/)
    }
    // And it keeps the NEWEST six, not the oldest.
    expect(s.writing.thread[s.writing.thread.length - 1].at).toBe('2026-08-20T10:00:00Z')
  })

  it('the thread is deliberately NOT hashed', () => {
    // It is already represented by lastInboundAt/lastOutboundAt; hashing the
    // bodies would re-judge the board every time a preview renders differently.
    const src = readFileSync('api/lib/deal-manager-run.ts', 'utf8')
    const writing = src.slice(src.indexOf('writing: {'), src.indexOf('followups: {'))
    expect(writing).not.toContain('thread')
  })

  it('the cockpit hands the writer the thread, the call and the attachment fact', () => {
    const src = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    expect(src).toMatch(/thread: state\.writing\.thread/)
    expect(src).toMatch(/callNote: state\.conversation\?\.note/)
    expect(src).toMatch(/attachingProof: attachingProof === true/)
    // Both call sites pass the proof decision; the route is what signs it.
    // And since 17 Aug the draft context too: the brain's live order and the
    // name of whoever pressed, neither of which the writer had.
    expect(src.match(/fetchDraft\(req, jwt, bundle, body.*Boolean\(proof\?\.available\), draftContext\)/g)?.length).toBe(2)
    expect(src).toMatch(/order: order \?\? null/)
  })

  it('the stage fence allows the counter wherever the brain may order it', () => {
    // reply_with_counter is legal in Nurturing and Waiting on their answer
    // since 16 Aug; the stress test's stage list was never widened, so the
    // button the order pointed at was refused in those exact columns.
    const stress = readFileSync('api/lib/deal-stress-test.ts', 'utf8')
    // Anchored inside STAGE_FOR_MONEY_ACTION: the same key also appears in the
    // execution table, and a bare find() matched that one first.
    const table = stress.slice(stress.indexOf('STAGE_FOR_MONEY_ACTION'))
    const line = table.split('\n').find((l) => l.includes('draft_counter_reply:')) ?? ''
    for (const col of ['Nurturing', 'Waiting on their answer']) {
      expect(line).toContain(col)
    }
  })

  it('the counter writer is ORDERED to answer the thread, not re-negotiate it', () => {
    const src = readFileSync('api/crm/draft-offer-email.ts', 'utf8')
    expect(src).toMatch(/READ THE THREAD AND ANSWER IT/)
    expect(src).toMatch(/does not say "best and final"/)
    expect(src).toMatch(/IF A PROOF OF FUNDS IS ATTACHED/)
    // The thread block reaches the counter prompt.
    expect(src).toMatch(/THE EMAIL THREAD SO FAR, oldest first/)
    // And the proof description is no longer gated to one email kind.
    expect(src).toMatch(/c\.attachingProof === true/)
  })
})

describe('the order carries its follow-through', () => {
  it('a sent reply books the chase as well as moving the card', () => {
    // Hugo, 17 Aug: "send the email now ... and add the follow-up in three days
    // if they don't respond for calling."
    const src = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    const record = src.slice(src.indexOf("body.phase === 'record'"), src.indexOf('await logEvent'))
    // The default road still lands in Waiting on their answer; since 17 Aug pm
    // the destination is the suggestion the human saw at the gate (and could
    // override), so the literal moved into suggestedMoveFor.
    expect(record).toMatch(/suggestedMoveFor\('send_email', state\.board\.column\)/)
    expect(record).toMatch(/moveCardTo\(supabase, bundle\.contactId, road\)/)
    // And the chase only follows the card into the waiting column: a send
    // filed under Not interested must not book a "ring and chase them".
    expect(record).toMatch(/landed === 'Waiting on their answer'/)
    expect(record).toMatch(/bookChaseIn\(/)
    expect(record).toMatch(/days: 3/)
    // Best effort: the email has already gone and cannot be unsent, so a failed
    // booking must never report the send as failed.
    expect(record).toMatch(/catch \(e\)/)
  })

  it('the chase does not stack up on a branch we reply to twice', () => {
    const src = readFileSync('api/crm/cockpit-action.ts', 'utf8')
    const fn = src.slice(src.indexOf('async function bookChaseIn'), src.indexOf('async function moveCardTo'))
    expect(fn).toMatch(/'pending'/)
    expect(fn).toMatch(/if \(\(waiting \?\? \[\]\)\.length\) return/)
  })
})
