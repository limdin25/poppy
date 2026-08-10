// The coach is allowed to see words before Twilio admits the sentence ended.
//
// partialResults="false" was the single biggest line in the coach's latency
// budget: 1.5 to 2.5 seconds of the 4.5 to 7 it took end to end, because Twilio
// releases nothing until its own endpointer calls the sentence over. On the
// Alan Cooper call the word "140" was spoken roughly eight seconds before that
// happened, and the right card was still streaming when Pedro said goodbye.
//
// The handler was always written for interim chunks and had simply never been
// fed one. Its comment at the debounce even claimed it fired "within ~400ms of
// the caller speaking", which could not have been true while Final was always
// 'true'.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const TWIML = read('supabase/functions/wk-voice-twiml-outgoing/index.ts')
const HANDLER = read('supabase/functions/wk-voice-transcription/index.ts')

describe('partials are on', () => {
  it('no longer hardcodes partialResults="false" in the TwiML it emits', () => {
    // Comments are stripped first: the note beside the switch has to be able to
    // explain what partialResults="false" used to cost us, and a whole-file
    // match would forbid documenting the very thing being changed.
    const emitted = TWIML.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(emitted).not.toMatch(/partialResults="false"/)
  })

  it('turns them on by default on BOTH dial paths', () => {
    // The agent-initiated dial and the parallel dial. A coach that is fast on
    // one route and blind on the other is worse than one consistently slow,
    // because nobody can tell which they are looking at.
    const switches = TWIML.match(/COACH_PARTIAL_RESULTS'\) === '0' \? 'false' : 'true'/g) ?? []
    expect(switches).toHaveLength(2)
  })

  it('keeps a kill switch that needs no code change', () => {
    // More partials means more OpenAI calls. If the bill or the card noise is
    // wrong, this is the lever.
    expect(TWIML).toMatch(/COACH_PARTIAL_RESULTS=0/)
  })
})

describe('a fragment is not a turn', () => {
  it('refuses to answer a short interim, but never gates a final', () => {
    expect(HANDLER).toMatch(/const tooShortToAnswer = !isFinal && wordCount < 4/)
    expect(HANDLER).toMatch(/speaker === 'caller' && !tooShortToAnswer/)
  })

  it('says why, citing the live call that taught us', () => {
    // bridge/config.py carries the same floor for the same reason.
    expect(HANDLER).toMatch(/A FRAGMENT IS NOT A TURN/)
    expect(HANDLER).toMatch(/Uh, who's/)
  })

  it('lets a genuinely short FINAL through, because those are the loud ones', () => {
    // "Yeah." and "No chance." are real turns and often the most important
    // moment on the call. The guard is explicitly !isFinal.
    expect(HANDLER).toMatch(/Finals are never gated/)
  })
})

describe('a growing sentence replaces its own card, it does not stack', () => {
  it('interims debounce and finals force-supersede', () => {
    // This is what makes partials safe without a separate dedup pass: each new
    // generation supersedes the still-streaming previous one, so the card is
    // rewritten in place as the sentence grows.
    expect(HANDLER).toMatch(/p_force: isFinal/)
    expect(HANDLER).toMatch(/p_min_age_ms: 400/)
  })

  it('the transcript PANE stays finals-only so it cannot fill with half-sentences', () => {
    expect(HANDLER).toMatch(/Persist transcript line ONLY for finalized chunks/)
    expect(HANDLER).toMatch(/if \(isFinal\) \{\s*\n\s*await supa\.from\('wk_live_transcripts'\)\.insert/)
  })
})
