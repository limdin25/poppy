// The email classifier exists in two places and they must never disagree.
//
// Deno (the edge function) cannot import from the Vercel api/ tree, so
// api/lib/inbound-classify.ts has a verbatim twin inside
// supabase/functions/wk-email-webhook/index.ts. Same arrangement as
// api/lib/spoken-email.ts and its copy in wk-voice-transcription.
//
// If they drift, the CRM believes one thing about a branch's reply and the
// thing that actually reacts to it believes another, which is worse than
// having no classifier at all.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INBOUND_KINDS, DEAL_CHANGING, stepForInbound } from '../api/lib/inbound-classify'

const root = resolve(__dirname, '..')
const read = (...p: string[]) => readFileSync(resolve(root, ...p), 'utf8')

const webhook = read('supabase', 'functions', 'wk-email-webhook', 'index.ts')
const lib = read('api', 'lib', 'inbound-classify.ts')

describe('the two copies agree', () => {
  it('every kind exists in both', () => {
    for (const kind of INBOUND_KINDS) {
      expect(webhook, `${kind} missing from the webhook`).toContain(`'${kind}'`)
    }
  })

  it('the deal-changing list is the same length in both', () => {
    const inWebhook = webhook
      .match(/const DEAL_CHANGING: InboundKind\[\] = \[([\s\S]*?)\]/)?.[1] ?? ''
    const kinds = INBOUND_KINDS.filter((k) => inWebhook.includes(`'${k}'`))
    expect(kinds.sort()).toEqual([...DEAL_CHANGING].sort())
  })

  it('carries the same figure rule: currency-marked or comma-grouped only', () => {
    // The subtle one. A bare run of digits is NOT money, because a branch
    // signature's phone number would otherwise read as a price: Lexi's real
    // email produced GBP 358,671 and GBP 3,844,565 out of her office and
    // mobile numbers.
    for (const copy of [lib, webhook]) {
      expect(copy).toContain('(?:GBP|£)')
      expect(copy).toContain('n < 1000) continue')
    }
  })

  it('carries the same question detection', () => {
    for (const copy of [lib, webhook]) {
      expect(copy).toContain('any\\s+update')
      expect(copy).toContain('please\\s+(confirm|advise|let\\s+me\\s+know)')
    }
  })

  it('maps a reply to the same next step in both', () => {
    const inWebhook = webhook.match(/function stepForInbound[\s\S]*?\n\}/)?.[0] ?? ''
    expect(inWebhook).toContain("'Renegotiate'")
    expect(inWebhook).toContain("'Get it in writing'")
    expect(stepForInbound('rejection')).toBe('Renegotiate')
    expect(stepForInbound('acceptance')).toBe('Get it in writing')
  })

  it('both refuse to treat an autoreply as an answer, and check it FIRST', () => {
    // Order is load-bearing: an out of office quoting our own offer email
    // underneath would otherwise match every rule below it.
    const firstRuleInWebhook = webhook.indexOf("kind: 'out_of_office'")
    const rejectionInWebhook = webhook.indexOf("kind: 'rejection'")
    expect(firstRuleInWebhook).toBeGreaterThan(-1)
    expect(firstRuleInWebhook).toBeLessThan(rejectionInWebhook)

    const firstRuleInLib = lib.indexOf("kind: 'out_of_office'")
    const rejectionInLib = lib.indexOf("kind: 'rejection'")
    expect(firstRuleInLib).toBeLessThan(rejectionInLib)
  })
})

describe('what the webhook is allowed to do about it', () => {
  it('updates the instruction and raises the alarm', () => {
    expect(webhook).toContain('reactToInbound')
    expect(webhook).toContain('wk_notifications')
    expect(webhook).toContain('next_step')
  })

  it('records a figure the branch named as THEIRS, never as an offer', () => {
    // The key name is the fence: nothing downstream may mistake it for a
    // price we agreed to.
    expect(webhook).toContain('branch_stated_figure')
    expect(webhook).not.toContain('offer_open =')
  })

  it('NEVER moves a board column from the webhook', () => {
    // Code decides moves, and a move is a human decision on a property deal.
    const reaction = webhook.match(/async function reactToInbound[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(reaction).not.toContain('pipeline_column_id')
    expect(reaction).not.toContain('stage_moved')
  })

  it('NEVER sends anything from the webhook', () => {
    const reaction = webhook.match(/async function reactToInbound[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(reaction).not.toMatch(/wk-email-send|wk-sms-send|resend|sendEmail/i)
  })

  it('only touches property leads', () => {
    expect(webhook).toContain("cf.lead_type !== 'estate_agent'")
  })

  it('a failed reading never stops the email being filed', () => {
    const reaction = webhook.match(/async function reactToInbound[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(reaction).toContain('catch')
  })
})
