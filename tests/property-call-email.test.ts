// The email asked for, written and sent while the estate agent is still on the
// phone.
//
// Hugo, 2026-08-14: "he asks can I have your email, they give it, and he says
// I'm sending you an email now, please confirm you received it. On this email we
// just ask for the video, so they have our address and we have theirs."
//
// The rule this whole path has to obey is the two-call process: call one NEVER
// carries a figure of ours. An email cannot be unsent, so there are three
// fences between the model and a price in writing, and they are all pinned
// here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { videoRequestTemplate, addressOnlyTemplate } from '../src/features/crm/components/live-call/PropertyEmailPane'
import { firstText } from '../api/lib/anthropic-content'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const PANE = read('src/features/crm/components/live-call/PropertyEmailPane.tsx')
const TABS = read('src/features/crm/components/live-call/DialerRightTabs.tsx')
const DRAFT = read('api/crm/draft-offer-email.ts')
const SEND = read('supabase/functions/wk-email-send/index.ts')
const COACH = read('supabase/functions/wk-voice-transcription/index.ts')
const SCRIPT = read('src/core/content/property-call-script.html')

describe('the template that is always in the box', () => {
  const t = videoRequestTemplate({ street: 'Orion Way', person: 'Doug', fromName: 'Pedro' })

  it('answers Pedro\'s question: there is one, and it is already written', () => {
    // "where can I find the template email to send to them while on the call?"
    expect(t.subject).toContain('Orion Way')
    expect(t.body).toMatch(/^Hi Doug,/)
    expect(t.body).toMatch(/video walkthrough/i)
    expect(t.body).toMatch(/Pedro/)
    expect(t.body).toMatch(/Unico/)
  })

  it('asks for the video and says why, in words an agent will act on', () => {
    expect(t.body).toMatch(/builder prices the works/i)
    expect(t.body).toMatch(/you do not need to be in it/i)
    expect(t.body).toMatch(/floor plan|EPC/i)
  })

  it('greets the branch when nobody gave their name', () => {
    const anon = videoRequestTemplate({ street: 'Welwyn Park Road', person: null, fromName: 'Pedro' })
    expect(anon.body).toMatch(/^Hi,/)
  })

  it('CARRIES NO FIGURE. Call one never puts a number in writing', () => {
    expect(t.body).not.toMatch(/£/)
    expect(t.body).not.toMatch(/\b\d{2,3},\d{3}\b/)
    expect(t.body).not.toMatch(/\boffer of\b/i)
  })

  it('carries no long dash and no curly punctuation', () => {
    expect(`${t.subject} ${t.body}`).not.toMatch(/[–—‘’“”…]/)
  })
})

describe('the three fences between a model and a price in writing', () => {
  it('1. the call-one prompt forbids every kind of figure', () => {
    expect(DRAFT).toMatch(/SYSTEM_VIDEO/)
    expect(DRAFT).toMatch(/NEVER put a price, an offer, a figure or a range in this email/)
  })

  it('2. the call-one draft is never given the numbers at all', () => {
    // A rule a model is told can be broken. A number it was never given cannot.
    expect(DRAFT).toMatch(/const videoFacts = \[/)
    const facts = DRAFT.slice(DRAFT.indexOf('const videoFacts = ['), DRAFT.indexOf('.join', DRAFT.indexOf('const videoFacts = [')))
    expect(facts).not.toMatch(/offerPrice|askingPrice|gdv|refurb/)
  })

  it('3. a draft that names a figure anyway is thrown away', () => {
    expect(DRAFT).toMatch(/isVideoRequest && \/£/)
    expect(DRAFT).toMatch(/thrown away/)
  })

  it('the offer email still refuses to send without an offer figure', () => {
    expect(DRAFT).toMatch(/!isVideoRequest && !gbp\(h\.offerPrice\)/)
  })
})

describe('the draft reads what was actually said', () => {
  it('queries the columns wk_live_transcripts actually has', () => {
    // It asked for `text, created_at`, which do not exist. PostgREST 400d, the
    // catch swallowed it, and every offer email since this endpoint shipped was
    // written as though no call had happened.
    expect(DRAFT).toMatch(/\.select\('speaker, body, ts'\)/)
    expect(DRAFT).toMatch(/\.order\('ts'/)
    expect(DRAFT).not.toMatch(/select\('speaker, text, created_at'\)/)
  })

  it('says so in the logs instead of silently becoming "no transcript"', () => {
    expect(DRAFT).toMatch(/transcript read failed/)
  })
})

describe('the address types itself', () => {
  it('the coach files what it heard, on property calls only', () => {
    expect(COACH).toMatch(/call\.script_key === 'property_call' && mentionsEmail\(transcriptText\)/)
    expect(COACH).toMatch(/captured_email: heard/)
  })

  it('listens to BOTH speakers, because Pedro reads it back to check', () => {
    expect(COACH).toMatch(/heard_from: speaker/)
  })

  it('never writes the address onto the contact behind his back', () => {
    // A mistyped address is an offer that silently never arrives. A human
    // presses send, which is what confirms it.
    const start = COACH.indexOf('THE EMAIL ADDRESS, THE MOMENT IT IS SAID')
    const block = COACH.slice(start, start + 2200)
    expect(block).not.toMatch(/from\('wk_contacts'\)/)
  })

  it('cannot take the transcript pipeline down with it', () => {
    const start = COACH.indexOf('THE EMAIL ADDRESS, THE MOMENT IT IS SAID')
    const block = COACH.slice(start, start + 2200)
    expect(block).toMatch(/try \{/)
    expect(block).toMatch(/catch/)
  })

  it('the pane picks it up over realtime and fills the field', () => {
    expect(PANE).toMatch(/wk_live_coach_events/)
    expect(PANE).toMatch(/captured_email/)
    // His typing always wins over the machine's.
    expect(PANE).toMatch(/setEmail\(\(cur\) => \(cur\.trim\(\) \? cur : found\)\)/)
  })

  it('an unknown coach kind can never white-screen the pane mid-call', () => {
    const live = read('src/features/crm/components/live-call/LiveTranscriptPane.tsx')
    expect(live).toMatch(/COACH_ICONS\[event\.kind\] \?\? COACH_ICONS\.suggestion/)
  })
})

describe('sending it', () => {
  it('goes to what is in the box, not to whatever is stored', () => {
    // Sister branches share one inbox and wk_contacts has a unique index on
    // email, so saving cannot be what decides whether an email can be sent.
    expect(SEND).toMatch(/to_email\?: string/)
    expect(SEND).toMatch(/const toEmail = typedTo \|\|/)
    expect(SEND).toMatch(/That is not a valid email address/)
    expect(PANE).toMatch(/to_email: clean/)
  })

  it('remembers the address afterwards, and a clash is not a send failure', () => {
    expect(PANE).toMatch(/setSent\(true\)/)
    const after = PANE.slice(PANE.indexOf('setSent(true)'))
    expect(after).toMatch(/persist\.patchContact\(contactId, \{ email: clean \}\)/)
    expect(after).toMatch(/not saved to the lead/)
  })

  it('will not send half an email', () => {
    expect(PANE).toMatch(/const canSend = valid && !!subject\.trim\(\) && !!body\.trim\(\)/)
  })
})

describe('the tab, and who can see it', () => {
  it('is a tab of its own on a property call, not buried in Messages', () => {
    expect(TABS).toMatch(/label="Email"/)
    expect(TABS).toMatch(/\{showHouses && \(\s*\n?\s*<TabButton active=\{tab === 'email'\}/)
  })

  it('does not exist on a plumber dial', () => {
    // Marr rings 200 plumbers a day on this screen. The tab set he sees must
    // not move.
    expect(TABS).toMatch(/\{tab === 'email' && showHouses && \(/)
  })

  it('knows which of the two calls it is on', () => {
    expect(PANE).toMatch(/callModeForStep\(nextStep\) === 'offer'/)
    expect(read('src/features/crm/dialer-pro/DialerProPage.tsx')).toMatch(/nextStep=\{contact\?\.customFields\?\.next_step/)
  })
})

describe('the script tells him to send it on the call', () => {
  it('asks for the email, then sends while they are still on the phone', () => {
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/What's the best email for you anyway\?/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/I'm going to send you one right now/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/tell me it's landed before I let you go/)
  })

  it('tells him he does not type it, and what to do when it is wrong', () => {
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/it types itself into that tab/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/trust them and correct it/)
  })

  it('the coach carries the same instruction, or it grades a call on wording he cannot see', () => {
    expect(COACH).toMatch(/I'm sending you one now so you've got my address/)
    expect(COACH).toMatch(/Can you just tell me it's landed/)
  })
})

describe('reading what the model actually said', () => {
  // THE BUG THAT MADE EVERY AI EMAIL FAIL. claude-sonnet-5 answers with a
  // `thinking` block FIRST, so content[0].text is undefined and callLLM
  // returned '' every single time. On production the drafts had never once
  // worked: the API call was fine, the reader was not. Found 2026-08-14 by
  // replaying the request by hand against the production key.
  it('takes the first block that HAS text, never content[0]', () => {
    expect(firstText([{ type: 'thinking', thinking: 'hmm' } as never, { type: 'text', text: 'Dear Doug' }]))
      .toBe('Dear Doug')
    expect(firstText([{ type: 'text', text: 'plain' }])).toBe('plain')
    expect(firstText([{ type: 'thinking' } as never])).toBe('')
    expect(firstText(undefined)).toBe('')
    expect(firstText([])).toBe('')
    // A whitespace-only block is not an answer.
    expect(firstText([{ type: 'text', text: '   ' }, { type: 'text', text: 'real' }])).toBe('real')
  })

  it('every Anthropic reader in api/ goes through it', () => {
    // Same landmine everywhere else: those callers resolve to sonnet-4-6 today
    // and work, and would have gone silent the day anyone switched the model in
    // settings. The change is a no-op for a model with no thinking block.
    for (const f of [
      'api/lib/brrr.ts',
      'api/webhooks/retell.ts',
      'api/webhooks/unipile.ts',
      'api/webhooks/twilio-sms.ts',
      'api/follow-up/enqueue.ts',
    ]) {
      const src = read(f)
      expect(src, f).not.toMatch(/content\?\.\[0\]\?\.text/)
      expect(src, f).toMatch(/firstText/)
    }
  })
})

describe('when the branch says no to the video', () => {
  // Hugo, 2026-08-14: "sometimes the agent refuses the video. Then how do we get
  // their email? You ask, can I have your email anyway, so my director can
  // contact you direct with some questions. And the email is just written hi,
  // this is Pedro, please confirm you have seen this email."
  const t = addressOnlyTemplate({ street: 'Orion Way', person: 'Doug', fromName: 'Pedro' })

  it('asks for NOTHING, because they have just refused one thing', () => {
    expect(t.body).not.toMatch(/video/i)
    expect(t.body).not.toMatch(/floor plan|EPC/i)
    expect(t.body).not.toMatch(/viewing/i)
    expect(t.body).not.toMatch(/could you send/i)
  })

  it('says who it is, and asks only that they confirm it arrived', () => {
    expect(t.body).toMatch(/This is Pedro at Unico/)
    expect(t.body).toMatch(/Orion Way/)
    expect(t.body).toMatch(/confirm it has reached you/i)
    expect(t.body).toMatch(/director may come back to you directly/i)
  })

  it('is short enough to read on a phone in one glance', () => {
    expect(t.body.split(/\s+/).length).toBeLessThan(75)
  })

  it('still carries no figure and no long dash', () => {
    expect(t.body).not.toMatch(/£/)
    expect(`${t.subject} ${t.body}`).not.toMatch(/[–—‘’“”…]/)
  })

  it('is one press in the pane, and the draft knows which one it is', () => {
    expect(PANE).toMatch(/data-testid="property-email-ask-kind"/)
    expect(PANE).toMatch(/No video, just my address/)
    expect(PANE).toMatch(/askKind === 'video' \? 'video_request' : 'address_only'/)
  })

  it('the endpoint treats it as a call-one email: no figures in, none out', () => {
    // isVideoRequest is what every money guard keys off, so address_only has to
    // be inside it or the short email would be handed the offer price.
    expect(DRAFT).toMatch(/const isVideoRequest = body\.kind === 'video_request' \|\| isAddressOnly/)
    expect(DRAFT).toMatch(/SYSTEM_ADDRESS_ONLY/)
    expect(DRAFT).toMatch(/ASK FOR NOTHING except a one line reply/)
  })
})

describe('a refused video never costs us the email', () => {
  it('the script asks for the address ANYWAY, in the same breath', () => {
    const flat = SCRIPT.replace(/\s+/g, ' ')
    expect(flat).toMatch(/What's the best email for you anyway\?/)
    expect(flat).toMatch(/My director will want to come back to you directly/)
    expect(flat).toMatch(/If they say no, that changes NOTHING about the email/)
    expect(flat).toMatch(/Do not argue for the video and do not ask twice/)
  })

  it('the script has the refusal branch, and the branch-inbox one', () => {
    const flat = SCRIPT.replace(/\s+/g, ' ')
    expect(flat).toMatch(/We don't do videos/)
    expect(flat).toMatch(/No bother at all, honestly/)
    expect(flat).toMatch(/I can't give out my email/)
    expect(flat).toMatch(/I'll put your name in the subject/)
  })

  it('the coach says the same, or it coaches a call Pedro is not on', () => {
    expect(COACH).toMatch(/IF THEY REFUSE THE VIDEO, THAT CHANGES NOTHING ABOUT THE EMAIL/)
    expect(COACH).toMatch(/never let a no on the video cost you the address/)
  })
})
