import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A refusal is not the word STOP, and it must still stop the machines.
//
// Hugo, 2026-08-06, looking at a real thread: a HeyPubli lead answered "Not
// interested" at 19:00 and an automated follow-up pitched them again at 20:11.
// "they said not interested and you still pitched." The opt-out keyword list
// only ever matched a bare stop/unsubscribe/quit, so nothing caught it.
//
// The fix travels: wk-sms-incoming flags `refused` on the inbound, relays it to
// heypubli, and heypubli stores it in whatsapp_opted_out_at, which is the one
// column BOTH the nurture drip and the onboarding nudge brain refuse to send
// past. These tests pin the detector's wording and that journey.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const incomingSrc = read('supabase/functions/wk-sms-incoming/index.ts')
const relayRoute = read('heypubli/app/api/webhooks/whatsapp-inbound/route.ts')

/** Rebuild the detector from the source, so the test cannot drift from the code. */
function refusalMatchers(): RegExp[] {
  // The patterns are re(`...`) template literals that interpolate ${G}, the
  // word gap. Read G out of the source too, so widening the gap in one place
  // widens it here and this test keeps testing the real thing.
  const gap = incomingSrc.match(/const G = '([^']+)'/)?.[1]
  expect(gap, 'const G (the word gap) not found in wk-sms-incoming').toBeTruthy()
  const block = incomingSrc.split('const refused =')[1]?.split(';')[0] ?? ''
  const found = block.match(/re\(`([^`]+)`\)/g) ?? []
  expect(found.length).toBeGreaterThan(0)
  return found.map((call) => {
    const body = call.slice(call.indexOf('`') + 1, call.lastIndexOf('`'))
    // Undo the TS string escaping (\\b -> \b) and substitute the gap.
    const src = body.replace(/\\\\/g, '\\').split('${G}').join(gap as string)
    return new RegExp(src, 'i')
  })
}

const isRefusal = (text: string) => refusalMatchers().some((re) => re.test(text))

describe('refusal detector', () => {
  // The exact message that caused the incident, plus the spellings a phone
  // keyboard actually produces.
  it.each([
    'Not interested',
    'not interested',
    'NOT INTERESTED',
    'not intrested',
    'no interested',
    'I am not interested thanks',
    'remove me',
    'please remove my number',
    'dont message me',
    "don't contact me again",
    'leave me alone',
    // A real lead, 07 Aug 06:37, two minutes after we explained the offer.
    // Every pattern demanded whitespace between the words, so this one got
    // through and the automation would have pitched him again.
    'No..thanks',
    'no.thanks',
    'No, thanks',
    'No -- thanks',
    'not.interested',
    'Not-Interested',
  ])('treats %j as a refusal', (text) => {
    expect(isRefusal(text)).toBe(true)
  })

  // The other half of the job: a mid-conversation "no" is an ANSWER, not a
  // refusal. Every one of these is a real reply from the India test, and
  // blocking them would silence people who are actively engaging.
  it.each([
    'Yes interested',
    'Not understand',
    'Tell properly',
    'Okay noted',
    'Yes',
    'Yr',
    'no',
    'No',
    'not now',
    'i dont know',
    'I have no Instagram yet',
  ])('does NOT treat %j as a refusal', (text) => {
    expect(isRefusal(text)).toBe(false)
  })
})

describe('the refusal travels to where automation reads it', () => {
  // 2026-08-19: the per-message relay to heypubli was REMOVED with the
  // Instagram method (the WhatsApp number became the builders and estate
  // agents line). The refusal flag still parks Elsie's OWN automation (the
  // ai_reply guard below), and the heypubli half of these pins stays because
  // its webhook still exists for any other caller.
  it('wk-sms-incoming no longer relays to heypubli at all', () => {
    expect(incomingSrc).not.toContain("type: 'inbound_whatsapp'")
    // The env may be named in the tombstone comment; reading it is the bug.
    expect(incomingSrc).not.toContain("Deno.env.get('HEYPUBLI_URL')")
  })

  it("Elsie's own AI reply still refuses on a refusal", () => {
    // The enqueue guard: refused is one of the conditions that stop the
    // ai_reply job being queued at all.
    expect(incomingSrc).toMatch(/!optOut && !refused/)
  })

  // Deliberately NOT do-not-text: that tag is the STOP contract and it locks a
  // human agent out of the thread as well. A refusal parks the robots only.
  it('does not tag do-not-text for a plain refusal', () => {
    const tagBlock = incomingSrc.split("tag: 'do-not-text'")[0]
    const lastGuard = tagBlock.lastIndexOf('if (')
    expect(tagBlock.slice(lastGuard)).toContain('optOut')
    expect(tagBlock.slice(lastGuard)).not.toContain('refused')
  })

  it('heypubli parks the automation on a refusal, same as an opt-out', () => {
    expect(relayRoute).toContain('refused: z.boolean()')
    expect(relayRoute).toContain('event.opt_out || event.refused')
    // whatsapp_opted_out_at is the column runOnboardingNudges and runNurture
    // both refuse to send past.
    const branch = relayRoute.split('event.opt_out || event.refused')[1] ?? ''
    expect(branch).toContain('whatsapp_opted_out_at')
    expect(branch).toContain('nurture_state')
  })

  it('the onboarding nudge brain honours that column', () => {
    const nudges = read('heypubli/lib/data/onboarding-nudges.ts')
    expect(nudges).toContain('whatsapp_opted_out_at')
  })
})
