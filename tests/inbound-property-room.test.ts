// When a branch rings PEDRO, he gets the same room he dials from.
//
// Pedro, 2026-08-18, by WhatsApp:
//   "if someone is ringing me back regarding a property i am inquiring about,
//    I cant find the property info on hey elsie"
//   "the transition of hey elsie from dialer to when I answer an incoming call
//    is very different and its difficult to find information"
//
// Four separate faults were behind that, and each one has a pin here:
//   1. the property panels existed only inside the dialer page
//   2. the caller was matched with ===, so +447... never matched 07...
//      and an unmatched caller showed the FIRST LEAD IN THE STORE
//   3. the browser was never told the inbound wk_calls.id, so no coach, no
//      transcript, no outcome
//   4. the inbound TwiML started no transcription at all, and the speaker
//      mapping assumed the parent leg was the agent
//
// Source-reading pins, in the style of the other property tests: this wiring is
// only otherwise provable by ringing a real estate agent.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { phoneTail, samePhone, findByPhone } from '../api/lib/phone-match'
import { defaultInboundListingId } from '../src/features/crm/hooks/usePropertyListings'
import { callModeForStep, callModeForCard, CALL2_COLUMNS, STEP } from '../src/features/crm/lib/nextStep'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const ROOM = read('src/features/crm/components/live-call/PropertyCallRoom.tsx')
const SCREEN = read('src/features/crm/components/live-call/LiveCallScreen.tsx')
const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')
const CTX = read('src/features/crm/components/live-call/ActiveCallContext.tsx')
const MODAL = read('src/features/crm/components/live-call/IncomingCallModal.tsx')
const SEARCH = read('src/features/crm/components/live-call/BranchSearchPanel.tsx')
const PANE = read('src/features/crm/components/live-call/PropertiesPane.tsx')
const TWIML = read('supabase/functions/wk-voice-twiml-incoming/index.ts')
const COACH = read('supabase/functions/wk-voice-transcription/index.ts')

describe('same number, whatever shape it was written in', () => {
  it('matches on the last nine digits', () => {
    // The three formats that actually live in wk_contacts and arrive from
    // Twilio for one branch.
    expect(samePhone('07380308316', '+447380308316')).toBe(true)
    expect(samePhone('0044 7380 308316', '+447380308316')).toBe(true)
    expect(samePhone('0191 625 0242', '+441916250242')).toBe(true)
    expect(phoneTail('+441916250242')).toBe('916250242')
  })

  it('never matches two numbers that are simply too short', () => {
    // '' means "cannot decide", and two cannot-decides are not a match.
    expect(phoneTail('123')).toBe('')
    expect(samePhone('123', '456')).toBe(false)
    expect(samePhone('', '')).toBe(false)
    expect(samePhone(null, undefined)).toBe(false)
  })

  it('is a different number when the tail differs', () => {
    expect(samePhone('+447380308316', '+447380308317')).toBe(false)
  })

  it('finds the row by phone, whatever the shape', () => {
    const rows = [{ phone: '01916250242' }, { phone: '07380 308316' }]
    expect(findByPhone(rows, '+447380308316', (r) => r.phone)?.phone).toBe('07380 308316')
    expect(findByPhone(rows, '+447000000000', (r) => r.phone)).toBeUndefined()
  })

  it('the inbound webhook falls back to the same rule', () => {
    // Its own copy, because Deno cannot import api/.
    expect(TWIML).toMatch(/function phoneTail/)
    expect(TWIML).toMatch(/digits\.length >= 9 \? digits\.slice\(-9\) : ''/)
    expect(TWIML).toMatch(/\.like\('phone', `%\$\{tail\}`\)/)
  })
})

describe('ONE room, dialled or answered', () => {
  it('the dialer mounts it', () => {
    expect(PAGE).toMatch(/<PropertyCallRoom/)
    expect(PAGE).toMatch(/direction="outbound"/)
  })

  it('the inbound call screen mounts the same one', () => {
    expect(SCREEN).toMatch(/<PropertyCallRoom/)
    expect(SCREEN).toMatch(/direction="inbound"/)
    expect(SCREEN).toMatch(/data-testid="inbound-property-room"/)
  })

  it('and the room is where every property panel lives', () => {
    for (const panel of ['<OfferStrip', '<PropertiesPane', '<DialerScriptPane', '<DialerRightTabs', '<NextStepPanel']) {
      expect(ROOM).toContain(panel)
    }
    // Not left behind in the dialer page, or the two would drift again.
    expect(PAGE).not.toContain('<OfferStrip')
    expect(PAGE).not.toContain('<PropertiesPane')
  })

  it('the plumber room is untouched', () => {
    // Marr dials plumbers on this page all day. His column widths, his tab
    // set and his script pane must not move.
    expect(PAGE).toMatch(/autoSaveId="dialer-pro-call-layout-v4"/)
    expect(PAGE).toMatch(/<CallTimeline callId=\{state\.currentCallId\} \/>/)
    // The property room can only be reached through the houses gate.
    expect(PAGE).toMatch(/\{isHousesCall \? \(/)
  })

  it('the script is the property script, in whichever of the two calls the deal is on', () => {
    expect(ROOM).toMatch(/scriptKey="property_call"/)
    // The room computes ONE mode (step + confirmed ballpark + board column)
    // and passes it everywhere, so no pane can disagree with another.
    expect(ROOM).toMatch(/const callMode = callModeForCard\(nextStep, contact\?\.customFields, columnName\)/)
    expect(ROOM).toMatch(/callMode=\{callMode\}/)
    // Hugo 2026-08-18: "he should have a script for call 1 or 2 depends whos
    // calling." It is the deal's own step that decides, the same switch the
    // strip and the Email tab read, so nothing on screen disagrees.
    expect(callModeForStep(undefined)).toBe('discovery')
    expect(callModeForStep(STEP.call)).toBe('discovery')
    expect(callModeForStep(STEP.homework)).toBe('discovery')
    expect(callModeForStep(STEP.offerCall)).toBe('offer')
    expect(callModeForStep(STEP.chase)).toBe('offer')
  })

  it('the board column arms call two, and can never demote it', () => {
    // Hugo 2026-08-18, watching Jones & Chapman: "on call number two that we
    // make the call directly from the pipeline, it should not open the first
    // script, this is a callback." The column IS the instruction.
    expect(callModeForCard(STEP.call, {}, 'Ready for call 2')).toBe('offer')
    expect(callModeForCard(undefined, null, 'Ballpark agreed')).toBe('offer')
    // A confirmed ballpark still promotes on its own, column or no column.
    expect(callModeForCard(STEP.call, { offer_open: '£153,000' }, null)).toBe('offer')
    // A column that says nothing about which call is next promotes nothing.
    expect(callModeForCard(STEP.call, {}, 'Nurturing')).toBe('discovery')
    expect(callModeForCard(STEP.call, {}, 'Voicemail')).toBe('discovery')
    expect(callModeForCard(undefined, null, null)).toBe('discovery')
    // Promote-only: no column can pull an offer-step deal back to call one.
    expect(callModeForCard(STEP.offerCall, {}, 'Nurturing')).toBe('offer')
  })

  it('every call-two column is a real property stage', () => {
    // Drift pin: the set mirrors PROPERTY_STAGES in api/crm/cockpit.ts. A
    // renamed board column would otherwise silently stop arming call two.
    const COCKPIT = read('api/crm/cockpit.ts')
    for (const name of CALL2_COLUMNS) {
      expect(COCKPIT).toContain(`'${name}'`)
    }
    for (const name of ['Ready for call 2', 'Ballpark agreed', 'Needs viewing', 'Offer sent', 'Waiting on their answer', 'Offer accepted']) {
      expect(CALL2_COLUMNS.has(name)).toBe(true)
    }
    expect(CALL2_COLUMNS.has('Discovery done, evaluating')).toBe(false)
    expect(CALL2_COLUMNS.has('Booked')).toBe(false)
  })

  it('says out loud that they rang us', () => {
    expect(ROOM).toMatch(/direction === 'inbound' && \(/)
    expect(ROOM).toMatch(/data-testid="inbound-callback-line"/)
    expect(ROOM).toMatch(/They rang you/)
  })
})

describe('which house they are ringing about', () => {
  const listing = (id: string, address: string, last_call_at: string | null) =>
    ({ id, address, last_call_at }) as never

  it('the one last discussed beats the best deal', () => {
    // The list arrives best-deal-first. Inbound, that is the wrong house: they
    // are ringing back about a conversation that already happened.
    const listings = [
      listing('best', '9 Orchard Terrace', null),
      listing('talked', '14 Bedford Street', null),
    ]
    expect(defaultInboundListingId(listings, { property_address: '14 Bedford Street' }))
      .toBe('talked')
  })

  it('matches the address loosely, so punctuation is not a different house', () => {
    const listings = [listing('a', '14 Bedford Street, Coventry, CV1', null)]
    expect(defaultInboundListingId(listings, { property_address: '14 bedford street  coventry cv1' }))
      .toBe('a')
  })

  it('falls back to the most recently rung, then to the best deal', () => {
    const listings = [
      listing('best', '9 Orchard Terrace', '2026-08-01T09:00:00Z'),
      listing('recent', '14 Bedford Street', '2026-08-17T09:00:00Z'),
    ]
    expect(defaultInboundListingId(listings, {})).toBe('recent')
    expect(defaultInboundListingId([listing('best', '9 Orchard Terrace', null)], {})).toBe('best')
    expect(defaultInboundListingId([], { property_address: 'anything' })).toBeNull()
  })

  it('the room asks for it only on an inbound call', () => {
    expect(ROOM).toMatch(/direction === 'inbound'\s*\n?\s*\? defaultInboundListingId\(listings, contact\?\.customFields\)/)
    expect(ROOM).toMatch(/: listings\[0\]\?\.id \?\? null/)
  })

  it('the prior-call banner counts calls in both directions', () => {
    // It was outbound-only, so a branch that had rung him BACK opened as
    // though nobody had ever spoken to them. The query moved to
    // useBranchLastCall (2026-08-18) because the call-two opener reads the
    // same record; the banner consumes the hook.
    const LAST_CALL = read('src/features/crm/hooks/useBranchLastCall.ts')
    expect(LAST_CALL).not.toMatch(/\.eq\('direction', 'outbound'\)/)
    expect(LAST_CALL).toMatch(/to_e164\.like\.\*\$\{phoneKey\},from_e164\.like\.\*\$\{phoneKey\}/)
    expect(PANE).toMatch(/useBranchLastCall\(contactPhone, currentCallId\)/)
    // "We spoke yesterday" must never point at a voicemail: the opener reads
    // lastSpoke, which skips the no-contact outcomes.
    expect(LAST_CALL).toMatch(/no pickup/)
    expect(LAST_CALL).toMatch(/voicemail/)
  })
})

describe('the inbound call is a real call', () => {
  it('the webhook keeps the row it inserts', () => {
    expect(TWIML).toMatch(/\.select\('id'\)\.single\(\)/)
    expect(TWIML).toMatch(/wkCallId = \(inserted\?\.id as string \| undefined\) \?\? null/)
  })

  it('files it as a property call when the caller is an estate agent', () => {
    expect(TWIML).toMatch(/script_key: contactIsEstateAgent \? 'property_call' : null/)
    expect(TWIML).toMatch(/lead_type\W+=== 'estate_agent'/)
  })

  it('hands the id and the contact to the browser on the TwiML', () => {
    // The <Client> child leg has its own CallSid, so there is no other way for
    // the browser to find the row the webhook just wrote.
    expect(TWIML).toMatch(/<Identity>\$\{escapeXml\(agentClientIdentity\)\}<\/Identity>/)
    expect(TWIML).toMatch(/<Parameter name="wkCallId"/)
    expect(TWIML).toMatch(/<Parameter name="contactId"/)
  })

  it('the browser reads them instead of guessing', () => {
    expect(CTX).toMatch(/custom\?\.get\('wkCallId'\)/)
    expect(CTX).toMatch(/custom\?\.get\('contactId'\)/)
    expect(CTX).toMatch(/callId: wkCallId/)
    // It used to be hardcoded null on every inbound call.
    expect(CTX).not.toMatch(/startedAt: Date\.now\(\),\s*\n\s*callId: null,\s*\n\s*\}\);\s*\n\s*activeTwilioCallRef/)
    // The fallback for legs in the air during a deploy.
    expect(CTX).toMatch(/findInboundCallRow/)
  })

  it('the coach can hear it, with the tracks the right way round', () => {
    expect(TWIML).toMatch(/<Start>/)
    expect(TWIML).toMatch(/<Transcription/)
    expect(TWIML).toMatch(/inboundTrackLabel="caller"/)
    expect(TWIML).toMatch(/outboundTrackLabel="agent"/)
    // Same three-part gate the outbound mint applies.
    expect(TWIML).toMatch(/ai_enabled && ai\?\.live_coach_enabled/)
    expect(TWIML).toMatch(/ai_coach_enabled: aiCoachEnabled/)
  })

  it('and the transcription function knows whose voice is whose', () => {
    // On an inbound call the PARENT leg is the caller. With the old fixed
    // mapping every word the branch said would have been filed as Pedro's.
    expect(COACH).toMatch(/const parentLegIsAgent = call\.direction !== 'inbound'/)
    expect(COACH).toMatch(/parentLegIsAgent \? 'caller' : 'agent'/)
    expect(COACH).toMatch(/parentLegIsAgent \? 'agent' : 'caller'/)
  })
})

describe('never the wrong lead on screen', () => {
  it('the first-contact fallback cannot fire during a call', () => {
    // THE BUG: an unmatched inbound caller got contactId 'inbound-<sid>', the
    // find missed, and the room rendered store.contacts[0] — a different
    // person's name, stage, tags and SMS box, live, mid-call.
    expect(SCREEN).not.toMatch(/\?\? store\.contacts\[0\] \?\? null;\s*\n\s*const contactFirstName/)
    expect(SCREEN).toMatch(/phase === 'idle' && !isPreview \? store\.contacts\[0\] \?\? null : null/)
  })

  it('matches the caller by number when the id is not ours', () => {
    expect(SCREEN).toMatch(/findByPhone\(store\.contacts, call\.phone, \(c\) => c\.phone\)/)
    expect(MODAL).toMatch(/findByPhone\(contacts, phone, \(c\) => c\.phone\)/)
    expect(MODAL).not.toMatch(/contacts\.find\(\(c\) => c\.phone === phone\)/)
  })

  it('the ring card says what they last spoke about', () => {
    expect(MODAL).toMatch(/data-testid="incoming-last-house"/)
    expect(MODAL).toMatch(/customFields\?\.property_address/)
  })
})

describe('an unknown number still gets the script, and a way to find them', () => {
  it('the room opens for a property caller even with nobody matched', () => {
    // Hugo 2026-08-18: "make it a no brainer for Pedro, and right script in
    // front of him, even if he needs to search the branch because it is
    // unknown, then show him right script and AI coach."
    expect(SCREEN).toMatch(/agentDefaultScript === 'property_call' && !contact/)
    expect(SCREEN).toMatch(/contact\?\.customFields\?\.lead_type === 'estate_agent'/)
    expect(SCREEN).toMatch(/listings\.length > 0/)
  })

  it('the search sits where the contact card would be', () => {
    expect(SCREEN).toMatch(/<BranchSearchPanel/)
    expect(ROOM).toMatch(/emptyState \?\? \(/)
    expect(SEARCH).toMatch(/data-testid="branch-search"/)
    expect(SEARCH).toMatch(/data-testid="branch-search-input"/)
  })

  it('picking a branch files the call against it, and tells the coach', () => {
    expect(SCREEN).toMatch(/contact_id: picked\.id, script_key: 'property_call'/)
    expect(SCREEN).toMatch(/const isProperty = hasHouses \|\| picked\.customFields\?\.lead_type === 'estate_agent'/)
  })

  it('and the room with no contact still cannot show a figure', () => {
    // No listing selected means the script falls back to the contact facts,
    // and with no contact at all that returns {} — call one, no money on
    // screen, which is the safe wrong answer by construction.
    expect(ROOM).toMatch(/discoveryScriptTokensFor\(contact\?\.customFields\)/)
  })
})
