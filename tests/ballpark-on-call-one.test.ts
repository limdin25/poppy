// The ballpark on call one: one button, one sentence, and every guard that
// keeps it a ballpark rather than an offer.
//
// Hugo, 2026-08-19 (voice): "from the call number one we need a button there
// that Pedro presses, very clear button on the top, and then give us the
// ballpark when Pedro is ready. Pedro says: okay, let me check my system
// here, I'm not making an offer. I just want to know if I'm in the ballpark
// or a million miles off."
//
// The course's own lesson ("Offer Without Offering", Deal Sourcing Course)
// is this exact move: desktop valuation FIRST, then on the call, "if I was
// to offer around this, would I be in the ballpark or would I be a million
// miles off?" Our overnight machine IS the desktop valuation, so the only
// missing piece was pricing the condition mid-call, which is what the
// button does.
//
// The design rule every pin below protects: THE FIGURE NEVER COMES FROM THE
// SCRIPT. Call one has no money tokens (property-script-isolation pins
// that), so the only number Pedro can say is the one the panel returns
// after the system heard THIS call. No press, no figure.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the room: the button exists on call one and only call one', () => {
  const room = read('src/features/crm/components/live-call/PropertyCallRoom.tsx')

  it('mounts the panel in discovery mode with a selected house, keyed by listing', () => {
    // Discovery mode is exactly the mode with no armed figures, and the key
    // means switching houses can never show one house's figure beside
    // another's script.
    expect(room).toMatch(/callMode === 'discovery' && selectedListing && \(/)
    expect(room).toMatch(/<BallparkOnCallPanel key=\{selectedListing\.id\} propertyId=\{selectedListing\.id\} \/>/)
  })
})

describe('the panel: live listen, text-first parse, ballpark not negotiation', () => {
  const panel = read('src/features/crm/components/live-call/BallparkOnCallPanel.tsx')

  it('always requests the LIVE path, so stored homework can never be read out as this call', () => {
    // Mid-call the current wk_calls row has no duration yet, so the stored
    // preview would look fresh and the panel would price a conversation
    // that has not happened. live:true forces the listen.
    expect(panel).toMatch(/live: true/)
  })

  it('parses text first, so a gateway timeout becomes a sentence, not "Unexpected token"', () => {
    expect(panel).toMatch(/await res\.text\(\)/)
  })

  it('the sentence is the course wording, and the guard forbids negotiating today', () => {
    expect(panel).toMatch(/would\s+I be in the ballpark, or am I a million miles off\?/)
    expect(panel).toMatch(/No negotiating today/)
    expect(panel).toMatch(/Never above/)
    expect(panel).toMatch(/One number, then silence/)
  })

  it('a refusal tells him to say NO number, never to guess one', () => {
    expect(panel).toMatch(/Do not float any number/)
    expect(panel).toMatch(/Do not invent a number/)
  })
})

describe('the route: live bypasses the stored homework and runs fast', () => {
  const route = read('api/crm/fetch-ballpark.ts')

  it('body.live forces the live run with fast:true', () => {
    expect(route).toMatch(/body\.live\s*\?\s*await runBallparkPreview\(supabase, body\.propertyId, \{ fast: true \}\)/)
  })

  it('the stored-preview shortcut still exists for the non-live press', () => {
    // The cockpit's confirm press must keep NOT redoing homework (the Grove
    // Avenue 504 fix); only the mid-call button opts out of it.
    expect(route).toMatch(/: await storedFreshPreview\(body\.propertyId\)/)
  })
})

describe('the lib: fast skips the deep photo pass, the runner keeps it', () => {
  it('deep is the inverse of fast', () => {
    const lib = read('api/lib/ballpark.ts')
    expect(lib).toMatch(/deep: !opts\.fast/)
  })

  it('the runner never passes fast, so the figures that ARM a deal always had the full look', () => {
    const runner = read('api/cron/ballpark-runner.ts')
    expect(runner).toMatch(/runBallparkPreview\(supabase, s\.propertyId\)/)
    expect(runner).not.toMatch(/fast:\s*true/)
  })
})

describe('the graders agree with the script, or Pedro gets marked down for obeying it', () => {
  it('the live coach allows exactly the panel sentence and still stops invented numbers', () => {
    const coach = read('supabase/functions/wk-voice-transcription/index.ts')
    expect(coach).toMatch(/Hearing that sentence is CORRECT, do not flag it/)
    expect(coach).toMatch(/Any OTHER number of ours, invented, remembered or rounded, fire a card/)
    expect(coach).toMatch(/Check the system, then lock the next step/)
  })

  it('the 5:30 report grades the approved first-call float as correct play', () => {
    const report = read('api/cron/daily-agent-reports.ts')
    expect(report).toMatch(/a first-call figure said the approved way is CORRECT PLAY/)
    // And the unframed number stays a rule break: the fence moved, it did
    // not fall.
    expect(report).toMatch(/is still the old rule break/)
  })

  it('the after-call review expects their figure first, then the system check', () => {
    const review = read('api/crm/call-review.ts')
    expect(review).toMatch(/Get THEIR figure first/)
    expect(review).toMatch(/THE SYSTEM CHECK, then the money/)
    expect(review).toMatch(/saying NO number of ours is the correct call, not a miss/)
  })
})

describe('the engine payload: every fact the call won actually reaches the valuation', () => {
  // 2026-08-19. Oundle Road B44, the house Pedro had already floated a number
  // on. The branch read the EPC floor area out loud on call one, the extractor
  // caught it, the row stored it under `heard`, and the valuation still said
  // "size-blind median of 3 comps (no floor area on the subject)".
  //
  // The cause was the SHAPE of this request. reprice() takes the condition
  // survey as one argument and every size or money fact as its own, and the
  // Flask route reads each of those off the TOP LEVEL of the body. We posted
  // them nested inside `survey`, and named the works list `works` where the
  // engine reads `works_needed`. No error, no warning: the engine defaulted
  // every missing argument to None and priced the house as though nobody had
  // ever rung the branch.
  //
  // Cost on that one house: a ballpark of GBP 161,500 opening and GBP 171,000
  // walk-away, against a true GBP 128,802 and GBP 145,572 once the 74 sqm was
  // read. Pedro had already said the wrong number to the agent.
  const lib = read('api/lib/ballpark.ts')
  const body = lib.slice(lib.indexOf('body: JSON.stringify({'), lib.indexOf('engine = await res.json()'))
  const survey = body.slice(body.indexOf('survey: {'), body.indexOf('}', body.indexOf('survey: {')))

  it('sends the condition survey under the keys refurb_model reads', () => {
    expect(survey).toMatch(/condition_band:/)
    expect(survey).toMatch(/works_needed:/)
    // `works` is the name that silently threw the confirmed works list away.
    expect(survey).not.toMatch(/\bworks:/)
  })

  it('keeps the survey to the condition, and nothing else', () => {
    // Anything else in here is a fact the engine will never look at.
    for (const stray of ['floor_area_sqm', 'rent_pcm', 'agent_comp_price', 'agent_comp_note', 'rejected_offer']) {
      expect(survey).not.toMatch(new RegExp(`${stray}:`))
    }
  })

  it('sends every size and money fact at the top level, where the route reads them', () => {
    const flat = body.slice(body.indexOf('},', body.indexOf('survey: {')))
    for (const fact of ['floor_area_sqm', 'rent_pcm', 'agent_comp_price', 'agent_comp_note', 'rejected_offer']) {
      expect(flat).toMatch(new RegExp(`${fact}:`))
    }
  })

  it('prefers the size the agent said over the size on the listing', () => {
    expect(body).toMatch(/floor_area_sqm: heard\.floor_area_sqm \?\? prop\.floor_area_sqm \?\? null/)
  })

  it('extracts all five facts, so none of them can be dropped upstream instead', () => {
    for (const fact of ['floor_area_sqm', 'rent_pcm', 'agent_comp_price', 'agent_comp_note', 'rejected_offer']) {
      expect(lib).toMatch(new RegExp(`${fact}: `))
    }
  })
})

describe('the ballpark hears every call, not just the last one', () => {
  // 2026-08-19, same house. Pedro rang Oundle Road on 18 Aug and the branch
  // read 74 sqm off the EPC. He rang back on 19 Aug to book the viewing. The
  // re-price that evening read ONLY the viewing call, extracted "the agent
  // made no statements about the property's condition, size or works", and
  // handed the engine an empty survey on a house we had spent two calls
  // qualifying. The process is deliberately two calls, so reading one call is
  // structurally guaranteed to lose the survey the moment call two happens.
  const lib = read('api/lib/ballpark.ts')

  it('the preview reads the recent calls, and readNewestTranscript stays for its own callers', () => {
    expect(lib).toMatch(/readRecentTranscripts\(sb, prop\.wk_contact_id\)/)
    // Still exported: call-extract and the call listener want the newest call
    // and only the newest call.
    expect(lib).toMatch(/export async function readNewestTranscript/)
    expect(lib).toMatch(/export async function readRecentTranscripts/)
  })

  it('labels the calls and puts them oldest first, so the newest fact can win', () => {
    expect(lib).toMatch(/MOST RECENT CALL/)
    expect(lib).toMatch(/EARLIER CALL/)
    expect(lib).toMatch(/\[\.\.\.found\]\.reverse\(\)/)
  })

  it('heardCallId is still the NEWEST call, which is what the freshness check means', () => {
    expect(lib).toMatch(/newestId: heardCallId/)
    expect(lib).toMatch(/const newestId = found\[0\]\.id/)
  })

  it('the prompt reads every call and refuses to borrow another house on that branch', () => {
    expect(lib).toMatch(/read them ALL/)
    expect(lib).toMatch(/the most recent one wins/)
    expect(lib).toMatch(/THAT BRANCH SELLS MANY HOUSES/)
    expect(lib).toMatch(/plainly about a different address, ignore it/)
  })

  it('carries no long dash or curly punctuation into the prompt', () => {
    const prompt = lib.slice(lib.indexOf('const SYSTEM_EXTRACT'), lib.indexOf("].join('\\n');"))
    expect(prompt).not.toMatch(/[–—‘’“”…]/)
  })
})
