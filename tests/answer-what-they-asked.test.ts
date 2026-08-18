// A REPLY THAT ANSWERS NOTHING THEY ASKED IS NOT A REPLY.
//
// Stanks Drive, Leeds, 2026-08-17. Keeley at Reeds Rains wrote to Pedro the
// morning after his call: "If you could let me know the following, I can
// register your company on our database to send properties to: Full company
// name, Registered address, Telephone number, Email address, Budget, Type of
// property, Areas you are looking in."
//
// That is a branch offering to feed us stock. The cockpit's own card read it
// correctly, "Keeley's email asks for company registration details. Reply with
// them today", and the draft under it said:
//
//     "I wanted to follow up on our conversation about Stanks Drive and see
//      where things stand. We remain keen and our position as a cash buyer has
//      not changed. Could you let me know whether the vendor has had any
//      further thoughts..."
//
// Hugo: "the prospect has asked us some questions, the draft doesn't say
// anything about the reply. And it doesn't tell me what should I do next.
// Should we just reply and stop? Reply and wait, reply and call back on a
// second call and put the ballpark? What is it? We have to be very clear."
//
// FOUR SEPARATE FAULTS BEHIND ONE BAD EMAIL, all pinned here:
//
//   1. The writer never saw her email. The cockpit sends the thread, the call
//      note and the transcript on every kind, and draft-offer-email.ts used
//      them for `counter_reply` ONLY. Third sighting of that exact class.
//   2. The writer never saw the DECISION. It is fed brief.doNow and
//      brief.blockers, the deterministic brief, empty on that card, while the
//      order lived in the assessment and never travelled.
//   3. Nothing in the repo held our own company details anywhere a writer could
//      reach: three human-facing scripts, no module.
//   4. There was no ACTION for "answer what they asked". In "Discovery done,
//      evaluating" the legal verbs were the ballpark, chase a missing fact,
//      escalate and hold, so a correct order was filed under escalate_hugo and
//      the blue button read "Send it to Hugo".

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COMPANY, WHAT_WE_BUY, companyFactsBlock, asksWhoWeAre } from '../api/lib/company-facts'
import { allowedActions, UNIVERSAL_ACTIONS, PROMPT_VERSION } from '../api/lib/deal-manager-contract'
import { primaryButtonFor, labelFor, commitVerbFor } from '../src/features/crm/components/cockpit/cockpitActions'
import { buildDealState, figuresIn } from '../api/lib/deal-state'
import { stressTest } from '../api/lib/deal-stress-test'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const DRAFT = read('api/crm/draft-offer-email.ts')
const ACTION = read('api/crm/cockpit-action.ts')
const BRAIN = read('api/lib/deal-brain.ts')

/** Keeley's email, as it arrived. */
const KEELEY = 'Good Morning Pedro, It was nice to speak with you this morning. '
  + 'If you could let me know the following, I can register your company on our database '
  + 'to send properties to: Full company name Registered address Telephone number '
  + 'Email address Budget Type of property Areas you are looking in'

describe('1. the writer reads what they wrote, on every kind of email', () => {
  it('the thread reaches the follow up, not only the counter', () => {
    // It was computed and then dropped: threadBlock existed and was spliced
    // into the counter_reply prompt alone.
    const user = DRAFT.slice(DRAFT.indexOf('const user = isCounterReply'), DRAFT.indexOf('const out = await callLLM'))
    expect(user).toMatch(/!isVideoRequest && threadBlock/)
    expect(user).toMatch(/THEIR NEWEST MESSAGE IS WHAT YOU ARE ANSWERING/)
  })

  it('and so does the call, so it cannot re-ask what the call settled', () => {
    const user = DRAFT.slice(DRAFT.indexOf('const user = isCounterReply'), DRAFT.indexOf('const out = await callLLM'))
    expect(user).toMatch(/isFollowUp && callBlock/)
  })

  it('call one is still deliberately excluded: no thread exists yet', () => {
    const user = DRAFT.slice(DRAFT.indexOf('const user = isCounterReply'), DRAFT.indexOf('const out = await callLLM'))
    // Every one of the new blocks is gated on !isVideoRequest.
    const added = user.match(/^\s+(!isVideoRequest.*)$/gm) ?? []
    expect(added.length).toBeGreaterThanOrEqual(3)
  })

  it('the prompt orders it to answer everything they asked, first', () => {
    expect(DRAFT).toMatch(/IF THEY HAVE WRITTEN TO US, ANSWER WHAT THEY ASKED, FIRST, AND ANSWER ALL OF IT/)
    expect(DRAFT).toMatch(/a short labelled list is better than a paragraph/)
    expect(DRAFT).toMatch(/say plainly that it is coming rather than inventing it/)
  })
})

describe('2. the decision reaches the writer', () => {
  it('the cockpit sends the brain\'s live order', () => {
    expect(ACTION).toMatch(/order: order \?\? null/)
    const loader = ACTION.slice(ACTION.indexOf('async function loadDraftContext'), ACTION.indexOf('/** Proxy to the draft route'))
    expect(loader).toMatch(/\.in\('kind', \['assessment', 'fallback_refused'\]\)/)
    expect(loader).toMatch(/\.order\('created_at', \{ ascending: false \}\)/)
    // Never fatal: a log read that fails must not stop somebody answering.
    expect(loader).toMatch(/catch/)
  })

  it('an email address is never used as a name in a sign off', () => {
    const loader = ACTION.slice(ACTION.indexOf('async function loadDraftContext'), ACTION.indexOf('/** Proxy to the draft route'))
    expect(loader).toMatch(/!name\.includes\('@'\)/)
  })

  it('the writer is told the order is what this email carries out', () => {
    expect(DRAFT).toMatch(/WHAT WE HAVE DECIDED TO DO ABOUT THIS DEAL/)
    // And it goes through the same figure fence as everything else internal:
    // an order may name our ceiling.
    expect(DRAFT).toMatch(/redactFigures\(c\.order\)/)
  })

  it('the gate stops calling an unanswered email "nothing specific to chase"', () => {
    const withReply = buildDealState({
      property: { id: 'p1', address: 'Stanks Drive, Leeds, LS14 5EA', asking_price: 140000 },
      contact: { id: 'c1' },
      columnName: 'Discovery done, evaluating',
      calls: [{ id: 'k1', created_at: '2026-08-16T09:00:00Z', disposition: 'Qualified', duration_sec: 300 }],
      messages: [{ id: 'm1', created_at: '2026-08-17T08:42:00Z', direction: 'inbound', body: KEELEY }],
      now: new Date('2026-08-17T18:00:00Z'),
    })
    expect(withReply.writing.replySinceBrief).toBe(true)
    const r = stressTest({
      state: withReply, action: 'draft_follow_up_email',
      contactEmail: 'keeley.melia@reedsrains.co.uk', now: new Date('2026-08-17T18:00:00Z'),
    })
    expect(r.warned).not.toContain('blocker_known')
  })
})

describe('3. who we are, in one place', () => {
  it('matches the Companies House record Pedro reads out on the phone', () => {
    const script = read('src/core/content/property-call-script.html')
    expect(script).toContain(COMPANY.companyNumber)
    expect(script).toContain('483 Green Lanes')
    expect(COMPANY.legalName).toBe('ULINC UNICO GROUP LTD')
    expect(COMPANY.registeredOffice).toContain('483 Green Lanes')
  })

  it('answers every line of the form Keeley actually sent', () => {
    const block = companyFactsBlock({ person: 'Pedro', email: null, phone: null })
    expect(block).toMatch(/Full company name/)
    expect(block).toMatch(/Registered office/)
    expect(block).toMatch(/Areas:/)
    expect(block).toMatch(/Type of property:/)
    expect(block).toMatch(/Budget:/)
    // A fact nobody supplied is simply absent, never invented.
    expect(block).not.toMatch(/Telephone number/)
    expect(block).not.toMatch(/Email address/)
  })

  it('says the trading name and the legal name are one company', () => {
    expect(companyFactsBlock(null)).toMatch(/the same company/)
    expect(COMPANY.tradingName).toBe('Unico')
  })

  it('the budget answer is the standing brief, not a number', () => {
    expect(WHAT_WE_BUY.budget).toMatch(/no fixed budget/i)
    expect(WHAT_WE_BUY.budget).toMatch(/needs plenty of work|price has to come down/)
    expect(WHAT_WE_BUY.budget).not.toMatch(/£|\d{2,3},\d{3}/)
  })

  it('recognises the ask off their own words', () => {
    expect(asksWhoWeAre(KEELEY)).toBe(true)
    expect(asksWhoWeAre('Are you a real registered company? What is your company number?')).toBe(true)
    expect(asksWhoWeAre('The vendor has rejected your offer.')).toBe(false)
  })

  it('is only shown when they asked, and is never typed into the prompt', () => {
    expect(DRAFT).toMatch(/const theyAskedWhoWeAre = \(c\.thread \?\? \[\]\)\.some\(/)
    // Same rule as the proof of funds: the facts live in one module, never in
    // the writer's prompt, or two copies drift.
    expect(DRAFT).not.toMatch(/ULINC|11197856|Green Lanes/)
  })

  it('carries no long dash and no curly punctuation', () => {
    expect(read('api/lib/company-facts.ts')).not.toMatch(/[–—‘’“”…]/)
  })
})

// THE FENCE THAT BLOCKED THE VERY EMAIL IT WAS MEANT TO ALLOW.
//
// Hugo, minutes after this shipped: the draft answered Keeley properly, gave
// her our company number, and the gate refused to send it twice over. "This
// names GBP 11,197,856, which is not a figure the engine has for this house."
// 11197856 is our Companies House number. Both fences were working exactly as
// designed, on a number that is not a price and never can be.
describe('3b. a company number is not eleven million pounds', () => {
  const EMAIL = 'Our full company name is ULINC UNICO GROUP LTD, company number 11197856, '
    + 'registered office 483 Green Lanes, London, N13 4BS.'

  it('reads no figure out of our own registration details', () => {
    expect(figuresIn(EMAIL)).toEqual([])
  })

  it('catches the shapes a company number never takes', () => {
    // Bare digits only. A comma-grouped number after the same words is still a
    // figure, so the fence loses nothing it was built for.
    expect(figuresIn('company number 103,600')).toEqual([103600])
    expect(figuresIn('we can pay 103,600')).toEqual([103600])
    expect(figuresIn('our offer is GBP 103600')).toEqual([103600])
  })

  it('handles the ways it is actually written', () => {
    for (const s of [
      'company number 11197856', 'Company No. 11197856', 'company no 11197856',
      'registration number 11197856', 'registered at Companies House 11197856',
    ]) {
      expect(figuresIn(s), s).toEqual([])
    }
  })

  it('a postcode with digits is still not money either', () => {
    expect(figuresIn('483 Green Lanes, London, N13 4BS')).toEqual([])
  })

  it('the gate lets the whole answer through', () => {
    const state = buildDealState({
      property: { id: 'p1', address: 'Stanks Drive, Leeds, LS14 5EA', asking_price: 140000 },
      contact: { id: 'c1' },
      columnName: 'Discovery done, evaluating',
      calls: [{ id: 'k1', created_at: '2026-08-16T09:00:00Z', disposition: 'Qualified', duration_sec: 300 }],
      messages: [{ id: 'm1', created_at: '2026-08-17T08:42:00Z', direction: 'inbound', body: KEELEY }],
      now: new Date('2026-08-17T18:00:00Z'),
    })
    const r = stressTest({
      state, action: 'draft_follow_up_email',
      draft: { subject: 'Stanks Drive, Leeds, LS14 5EA', body: EMAIL, kind: 'follow_up' },
      contactEmail: 'keeley.melia@reedsrains.co.uk', now: new Date('2026-08-17T18:00:00Z'),
    })
    expect(r.blocked).not.toContain('follow_up_before_the_offer')
    expect(r.blocked).not.toContain('figures_on_file')
  })
})

describe('4. there is a verb for "answer what they asked"', () => {
  it('legal in EVERY column, because a branch can write at any stage', () => {
    expect(UNIVERSAL_ACTIONS).toContain('reply_to_their_email')
    for (const col of ['Discovery done, evaluating', 'Ready for call 2', 'Booked', null]) {
      expect(allowedActions(col)).toContain('reply_to_their_email')
    }
  })

  it('points at the follow-up draft, NOT the money reply', () => {
    // draft_counter_reply runs decideCounter and the ceiling fences. An
    // ordinary answer to an ordinary question has no business going through
    // the money path.
    expect(primaryButtonFor('reply_to_their_email')).toBe('draft_follow_up_email')
  })

  it('and never lands on Send it to Hugo again', () => {
    expect(primaryButtonFor('reply_to_their_email')).not.toBe('escalate_hugo')
    expect(primaryButtonFor('reply_to_their_email')).not.toBe('hold')
  })

  it('the brain is told to use it instead of escalating', () => {
    expect(BRAIN).toMatch(/THEY WROTE TO US AND ASKED FOR SOMETHING: ANSWER IT/)
    expect(BRAIN).toMatch(/never file this under `escalate_hugo` or `hold`/)
    expect(BRAIN).toMatch(/Our own company registration details, our address and what we buy are NOT that/)
  })
})

describe('5. and then what', () => {
  it('every order that ends in a reply names the step after it', () => {
    expect(BRAIN).toMatch(/ALWAYS SAY WHAT HAPPENS AFTER/)
    expect(BRAIN).toMatch(/then the ballpark before Wednesday\\?'s call/)
    expect(BRAIN).toMatch(/without it a person does the thing and stops/)
  })

  it('the order got the room for it: three sentences, not two', () => {
    expect(BRAIN).toMatch(/at most 3 short sentences and under 55 words/)
  })

  it('the prompt version was bumped, or the board serves yesterday\'s cards', () => {
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(10)
  })
})

// ---------------------------------------------------------------------------
// "SEND IT TO HUGO" DID NOT SEND IT TO HUGO
// ---------------------------------------------------------------------------
//
// Hugo, 2026-08-17, signed in as an admin and looking at a card whose blue
// button read "Send it to Hugo": "what is it send to Hugo, i am Hugo logein as
// everyone".
//
// The question exposed a real bug under a fair complaint about the words. The
// escalate press notified `actorId`, whoever pressed the button. Hugo pressing
// it told Hugo, which looked like it worked. PEDRO pressing it told PEDRO, and
// the boss heard nothing at all.

describe('6. escalating reaches the boss, not the presser', () => {
  const escalate = ACTION.slice(ACTION.indexOf("case 'escalate_hugo'"), ACTION.indexOf("case 'assemble_investor_pack'"))

  it('notifies the ADMINS, never the person who pressed', () => {
    expect(escalate).toMatch(/const admins = await adminRecipients\(supabase\)/)
    expect(escalate).toMatch(/for \(const id of notify\)/)
    expect(escalate).toMatch(/agentId: id/)
    expect(escalate).not.toMatch(/agentId: actorId/)
  })

  it('falls back to the presser rather than telling nobody, and SAYS it did', () => {
    expect(escalate).toMatch(/admins\.length \? admins : \[actorId\]/)
    expect(escalate).toMatch(/noAdminFound: admins\.length === 0/)
  })

  it('resolves admins the same two ways wk_is_admin() does, never a hardcoded email', () => {
    const fn = ACTION.slice(ACTION.indexOf('async function adminRecipients'), ACTION.indexOf('/** THE TWO THINGS THE EMAIL WRITER'))
    expect(fn).toMatch(/\.eq\('workspace_role', 'admin'\)/)
    expect(fn).toMatch(/from\('admin_users'\)/)
    expect(fn).not.toMatch(/@nfstay|@heyelsie|@lemlin/)
    // Never fatal: a failed lookup falls back, it does not throw away the press.
    expect(fn).toMatch(/catch/)
  })
})

describe('7. the button says something true to whoever is reading it', () => {
  it('an admin is not told to send it to himself', () => {
    expect(labelFor('escalate_hugo', true)).toBe('Put it on my list')
    expect(commitVerbFor('escalate_hugo', true)).toBe('Put it on my list')
  })

  it('and an agent still sees the words that make sense to an agent', () => {
    expect(labelFor('escalate_hugo', false)).toBe('Send it to Hugo')
    expect(commitVerbFor('escalate_hugo', false)).toBe('Send it to Hugo')
  })

  it('nothing else changes wording by who is looking', () => {
    for (const a of ['hold', 'mark_lost', 'fetch_ballpark', 'draft_follow_up_email'] as const) {
      expect(labelFor(a, true)).toBe(labelFor(a, false))
      expect(commitVerbFor(a, true)).toBe(commitVerbFor(a, false))
    }
  })
})

// ---------------------------------------------------------------------------
// A VIEWING IS NEVER FREE
// ---------------------------------------------------------------------------
//
// Zest, 18 Aug. Leanne: "before the offer can be put forward to the vendor you
// would need to view the property. Is there a day and time that would be
// suitable for you?" The draft came back: "We are happy to arrange a viewing...
// Our offer remains £103,600... That is our maximum, so the next answer will be
// a yes or a no."
//
// Hugo: "That's not the right one. It says you should say hi, yes we can
// arrange a viewing, that's not a problem. However, can you just confirm that
// we are within the ballpark? I don't want to waste your time and our time if
// the numbers are not within the ballpark that the vendor might be able to
// accept."
//
// Two mistakes in one paragraph. Our viewing is the builder going round, so
// agreeing to one before anybody has said the figure is close spends a day of
// real work on a deal that may be dead. And restating our maximum hands the
// branch our ceiling in writing for nothing: they already have the number, and
// after that there is no negotiation left, only that number.

describe('8. yes to the viewing, and are we in the ballpark', () => {
  it('the writer says yes AND asks, in the same email', () => {
    expect(DRAFT).toMatch(/IF THEY WANT A VIEWING, ACCESS OR A SURVEY BEFORE THEY WILL PUT OUR OFFER TO THE VENDOR/)
    expect(DRAFT).toMatch(/say yes, plainly and without conditions/)
    expect(DRAFT).toMatch(/confirm the figure already with them is in the ballpark/)
    expect(DRAFT).toMatch(/neither of us wants to waste a visit/)
  })

  it('and never repeats our figure or calls it our maximum', () => {
    expect(DRAFT).toMatch(/NEVER repeat our figure in this email, and never say it is our maximum/)
    expect(DRAFT).toMatch(/puts our ceiling in writing/)
  })

  it('our visit is the builder, never a survey', () => {
    expect(DRAFT).toMatch(/our builder going round to view and price the works, which IS the viewing/)
  })

  it('the brain orders both halves, so the draft is not the only thing that knows', () => {
    expect(BRAIN).toMatch(/A VIEWING IS NEVER FREE, SO QUALIFY THE FIGURE BEFORE YOU SPEND ONE/)
    expect(BRAIN).toMatch(/agree to the access, then ask them to confirm the figure/)
    expect(BRAIN).toMatch(/never spent on a figure nobody has said is close/)
    expect(BRAIN).toMatch(/a ceiling in writing ends the negotiation/)
  })

  it('the prompt version moved, or the board keeps the old answer', () => {
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(11)
  })

  it('an email with no figure in it clears the ceiling fence on its own', () => {
    // The point Hugo did not have to make: the block he was staring at
    // ("103,600 is the most we would ever pay... say a figure below it, or say
    // no figure at all") disappears the moment the reply stops restating the
    // number. The right words and the fence agree.
    const state = buildDealState({
      property: {
        id: 'zest', address: 'Welwyn Park Road, Hull, HU6', asking_price: 125000,
        deal: { offer: { open: 103600, max: 103600, ladder: [103600] } },
      },
      contact: { id: 'c1' },
      columnName: 'Waiting on their answer',
      calls: [{ id: 'k1', created_at: '2026-08-16T09:00:00Z', disposition: 'Qualified', duration_sec: 300 }],
      now: new Date('2026-08-18T12:00:00Z'),
    })
    const body = 'Thank you for coming back to us. Yes, we can arrange a viewing, that is not a problem. '
      + 'Before we book it in, could you confirm we are in the ballpark the vendor might accept? '
      + 'I would rather not waste your time or ours if the number is nowhere near.'
    const r = stressTest({
      state, action: 'send_email',
      draft: { subject: 'Welwyn Park Road, Hull, HU6', body, kind: 'counter_reply' },
      contactEmail: 'lucy@movewithzest.co.uk', now: new Date('2026-08-18T12:00:00Z'),
    })
    expect(r.blocked).not.toContain('ceiling_not_in_writing')
  })
})
