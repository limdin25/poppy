// THE BRIDGE IS HOW WE BUY, NOT A HOLE IN THE MONEY.
//
// Welwyn Park Road, 17 Aug 2026. We emailed Lucy at Zest a formal offer of
// 103,600 with our proof of funds attached, and the email explained the
// structure in as many words: the company accounts together with a bridging
// facility, no mortgage, no chain. She wrote back that the funds fell short of
// the offer. The cockpit then agreed with her: the card read "Produce a
// replacement proof of funds showing at least that full amount", escalated to
// Hugo, and the reply it wanted to draft said nothing about the facility at
// all.
//
// Hugo: "we clearly said that we're gonna use bridge loan, which is totally
// acceptable, that's as much as a cash buyer... the brain generates the replies
// that basically doesn't reinforce that."
//
// TWO FAULTS, one visible and one measured:
//
//   1. The brain never saw the sentence. `THREAD_BODY_CAP` was 900 characters
//      and that sentence starts at 875 of a 1,029 character email, so our own
//      words reached it as "The purchase completes us". The only money it could
//      see was a statement total under an offer.
//   2. Nothing anywhere told it that this is the designed structure. The money
//      auditor had been taught it that morning; the brain and the reply writer
//      had not.
//
// Both halves are pinned here, because either one alone puts the same card
// back on the board.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDealState, THREAD_BODY_CAP } from '../api/lib/deal-state'
import { PROMPT_VERSION } from '../api/lib/deal-manager-contract'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const DRAFT = read('api/crm/draft-offer-email.ts')
// READ, NOT IMPORTED. api/lib/deal-brain.ts imports the LLM wrapper, which
// builds a Supabase client at module load, so importing it here would need live
// credentials to assert on a string constant. The prompt itself is sliced out
// so the punctuation rule below is tested on the words the model reads, not on
// the comments around them.
const BRAIN = read('api/lib/deal-brain.ts')
const DEAL_MANAGER_SYSTEM = BRAIN.slice(
  BRAIN.indexOf('export const DEAL_MANAGER_SYSTEM'),
  BRAIN.indexOf('export function dealManagerPrompt'),
)

const NOW = new Date('2026-08-17T18:00:00Z')

// The email as it actually went out, word for word off the deal history.
const OUR_EMAIL = [
  'Dear Leanne,',
  '',
  'Thank you for coming back to us and for sending over your email address.',
  '',
  'We would like to formally place our offer at £103,600 for the property on '
  + 'Welwyn Park Road. This is subject to our builder going round to view and '
  + 'price the works. It is our maximum, so the next answer is a straightforward '
  + 'yes or no. The bathroom and the other works needed are the reason we cannot '
  + 'go higher.',
  '',
  'Please find our proof of funds attached. This is a certified copy of the '
  + 'Revolut Business balance sheets for our company Airbrick Finance Ltd, dated '
  + '14 August 2026. The document covers 10 company accounts, which is why more '
  + 'than one balance appears on it. The total available across those accounts is '
  + '£102,071. Account numbers, sort codes and IBANs are hidden throughout, which '
  + 'is standard practice for a document shared by email and does not affect what '
  + 'the statement shows. The purchase completes using these company accounts '
  + 'together with a bridging facility, so there is no mortgage and no chain.',
  '',
  'Kind regards,',
  'Pedro Almedina',
].join('\n')

const zest = (messages: Array<{ id: string; created_at: string; direction: string; body: string }>) =>
  buildDealState({
    property: {
      id: 'welwyn',
      address: 'Welwyn Park Road, Hull, HU6',
      asking_price: 125000,
      deal: { offer: { open: 97125, max: 103600, ladder: [97125, 100363, 103600] } },
    },
    columnName: 'Nurturing',
    messages,
    now: NOW,
  })

describe('what the brain is allowed to see of our own email', () => {
  it('KEEPS the sentence that says how the purchase completes', () => {
    // The measurement that caused this: 1,029 characters, and the funding
    // sentence begins at 875. Anything under about 1,030 deletes it.
    expect(OUR_EMAIL.length).toBeGreaterThan(1000)
    expect(OUR_EMAIL.indexOf('The purchase completes')).toBeGreaterThan(850)

    const state = zest([
      { id: 'm1', created_at: '2026-08-17T11:06:00Z', direction: 'outbound', body: OUR_EMAIL },
    ])
    const ours = state.writing.thread.find((m) => m.direction === 'outbound')
    expect(ours).toBeTruthy()
    expect(ours!.body).toMatch(/together with a bridging facility/)
    expect(ours!.body).toMatch(/no mortgage and no chain/)
  })

  it('never cuts a message off in silence: a trim SAYS it is a trim', () => {
    const long = `${'a'.repeat(THREAD_BODY_CAP + 500)} and the tail nobody sees`
    const state = zest([
      { id: 'm1', created_at: '2026-08-17T11:06:00Z', direction: 'outbound', body: long },
    ])
    const ours = state.writing.thread[0]
    expect(ours.body).toMatch(/the rest of this message is not shown/)
    expect(ours.body).not.toMatch(/the tail nobody sees/)
  })

  it('shows their complaint and our answer in the same thread', () => {
    const state = zest([
      { id: 'm1', created_at: '2026-08-17T11:06:00Z', direction: 'outbound', body: OUR_EMAIL },
      {
        id: 'm2',
        created_at: '2026-08-17T15:52:00Z',
        direction: 'inbound',
        body: 'The proof of funds you sent does not cover the offer, the total shown is below 103,600.',
      },
    ])
    expect(state.writing.thread).toHaveLength(2)
    expect(state.writing.thread[0].body).toMatch(/bridging facility/)
    expect(state.writing.replySinceBrief).toBe(true)
  })
})

// "THE BRAIN NEVER SAW THE SENTENCE" IS NOT AN ACCEPTED ANSWER ANY MORE.
// Hugo, 17 Aug. So the rule is general, not a patch on one cap: anything the
// brain reads as CONTENT either arrives whole or says out loud that it does
// not. A cut that looks like the end of a sentence is worse than no text.
describe('nothing the brain reads is trimmed in silence', () => {
  const src = readFileSync(resolve(root, 'api/lib/deal-state.ts'), 'utf8')

  it('the transcript announces its own trim', () => {
    expect(src).toMatch(/\(start of call trimmed\)/)
  })

  it('the email thread announces its own trim', () => {
    expect(src).toMatch(/the rest of this message is not shown/)
  })

  it('every cap goes through a named function, never a bare slice in the shaper', () => {
    // A `.slice(0, CAP)` written inline in the object literal is how the
    // funding sentence disappeared: there was no single place to say "and
    // mark it". Both caps are functions now, so a third one has somewhere
    // obvious to live.
    expect(src).toMatch(/function capTranscript/)
    expect(src).toMatch(/function capBody/)
    const shaper = src.slice(src.indexOf('const thread = messages'), src.indexOf('// ---- follow-ups'))
    expect(shaper).not.toMatch(/\.slice\(0, THREAD_BODY_CAP\)/)
  })

  it('the 400 character preview is still a preview, and the whole message rides beside it', () => {
    // lastInboundPreview is named for what it is and is not the brain's copy
    // of the message: writing.thread carries the same message in full. A
    // preview that was the ONLY copy would be the same bug wearing a
    // different field name.
    const state = zest([
      { id: 'm1', created_at: '2026-08-17T15:52:00Z', direction: 'inbound', body: `${'x'.repeat(500)} the end` },
    ])
    expect(state.writing.lastInboundPreview).toHaveLength(400)
    expect(state.writing.thread[0].body).toMatch(/the end$/)
  })
})

describe('the brain is told that the bridge is the design', () => {
  it('forbids ordering a replacement or a bigger statement', () => {
    expect(DEAL_MANAGER_SYSTEM).toMatch(/bridging facility/i)
    expect(DEAL_MANAGER_SYSTEM).toMatch(/NEVER order anyone to produce a bigger statement/)
    expect(DEAL_MANAGER_SYSTEM).toMatch(/not a gap in one|not a shortfall|that money is not missing/i)
  })

  it('sends it back to the reply, and keeps Hugo for a document we have not got', () => {
    expect(DEAL_MANAGER_SYSTEM).toMatch(/The move is a REPLY/)
    expect(DEAL_MANAGER_SYSTEM).toMatch(/no proof of funds on file at all, or the one on file is out of date/)
  })

  it('makes it read our own outbound emails before it orders anything', () => {
    expect(DEAL_MANAGER_SYSTEM).toMatch(/holds our own outbound emails/)
    expect(DEAL_MANAGER_SYSTEM).toMatch(/Never order us to redo work we have already done/)
  })

  it('bumps the prompt version, or the board keeps serving yesterday\'s answer', () => {
    // The sweep hashes the prompt version with the state. Without the bump
    // every card holds its cached assessment until the deal happens to change.
    expect(PROMPT_VERSION).toBeGreaterThanOrEqual(9)
  })

  it('carries no long dash and no curly punctuation', () => {
    expect(DEAL_MANAGER_SYSTEM).not.toMatch(/[–—‘’“”…]/)
  })
})

describe('the reply the branch actually gets', () => {
  it('answers the proof of funds question before the price', () => {
    expect(DRAFT).toMatch(/IF THEY HAVE QUESTIONED OUR PROOF OF FUNDS/)
    expect(DRAFT).toMatch(/THAT IS THE FIRST THING YOUR EMAIL ANSWERS/)
    expect(DRAFT).toMatch(/how the purchase completes/)
    expect(DRAFT).toMatch(/ask them plainly to put the offer to the vendor/i)
  })

  it('never apologises for the total and never promises a new document', () => {
    expect(DRAFT).toMatch(/never agree to send a bigger or updated statement/)
    expect(DRAFT).toMatch(/NEVER offer to produce a bigger, different or updated proof of funds/)
  })

  it('gets the completion facts when they query it, not only when we attach it', () => {
    expect(DRAFT).toMatch(/const theyQueriedTheProof = isCounterReply/)
    expect(DRAFT).toMatch(/if \(attachingNow \|\| theyQueriedTheProof\)/)
    expect(DRAFT).toMatch(/THEY ARE QUESTIONING THE PROOF OF FUNDS WE HAVE ALREADY SENT THEM/)
  })

  it('still writes none of it in this file: the wording lives in the settings row', () => {
    // Same rule as tests/property-call-email.test.ts. Replacing the statement
    // must replace the explanation with it, so the company, the bank, the total
    // and the completion sentence are read, never typed here.
    expect(DRAFT).not.toMatch(/Airbrick|Revolut|102,071|bridging facility/i)
    expect(DRAFT).toMatch(/p\.funding_note \? `- How the purchase completes/)
  })
})
