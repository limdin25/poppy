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
import { videoRequestTemplate } from '../src/features/crm/components/live-call/PropertyEmailPane'

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
    expect(SCRIPT).toMatch(/What's the best email for you\?/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/I'm going to send you one right now/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/tell me it's landed before I let you go/)
  })

  it('tells him he does not type it, and what to do when it is wrong', () => {
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/it types itself into the <b>Email<\/b> tab/)
    expect(SCRIPT.replace(/\s+/g, ' ')).toMatch(/trust them and correct it/)
  })

  it('the coach carries the same instruction, or it grades a call on wording he cannot see', () => {
    expect(COACH).toMatch(/I'm sending you one now so you've got my address/)
    expect(COACH).toMatch(/Can you just tell me it's landed/)
  })
})
