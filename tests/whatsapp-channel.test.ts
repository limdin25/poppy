import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// WhatsApp through the Twilio sender (+447460035763, registered with Meta,
// 2026-08-02). One channel column end to end: inbound stamps it, the AI reply
// job carries it, drafts keep it, every send path prefixes whatsapp: on the
// wire while rows store bare e164. An adversarial review found the worker
// dropping the channel key and the 24h window failing ASYNCHRONOUSLY (Twilio
// accepts then kills with 63016); these greps pin every one of those fixes.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const incoming = stripComments(read('supabase/functions/wk-sms-incoming/index.ts'))
const send = stripComments(read('supabase/functions/wk-sms-send/index.ts'))
const worker = stripComments(read('supabase/functions/wk-jobs-worker/index.ts'))
const draftAction = stripComments(read('supabase/functions/wk-draft-action/index.ts'))
const status = stripComments(read('supabase/functions/wk-sms-status/index.ts'))
const aiReply = stripComments(read('api/crm/ai-reply.ts'))
const inboxPage = stripComments(read('src/features/crm/pages/InboxPage.tsx'))

describe('inbound: wk-sms-incoming', () => {
  it('detects whatsapp: BEFORE phoneVariants strips it, and stores the channel', () => {
    const detectIdx = incoming.indexOf("rawFrom.startsWith('whatsapp:')")
    const variantsIdx = incoming.indexOf('phoneVariants(rawFrom)')
    expect(detectIdx).toBeGreaterThan(-1)
    expect(variantsIdx).toBeGreaterThan(detectIdx)
    expect(incoming).toMatch(/direction: 'inbound',\s*channel,/)
  })

  it('the ai_reply job carries the channel', () => {
    expect(incoming).toMatch(/payload: \{ contact_id: contactId, to_e164: toE164 \|\| null, from_e164: fromE164, channel \}/)
  })
})

describe('the jobs worker forwards channel (the review-caught break)', () => {
  it('handleAiReply includes channel in the forwarded body', () => {
    // Without this one key the WHOLE chain silently degrades to SMS: the
    // route defaults to sms, drafts get channel sms, wk-draft-action never
    // prefixes, and a WhatsApp lead is answered by a paid SMS.
    const block = worker.split('async function handleAiReply')[1]?.split('}')[0] ?? ''
    expect(worker).toMatch(/channel: payload\.channel/)
    void block
  })
})

describe('outbound: wk-sms-send', () => {
  it('whatsapp goes out FROM the registered sender with whatsapp: prefixes, bare e164 in the row', () => {
    expect(send).toMatch(/WHATSAPP_SENDER_E164 = Deno\.env\.get\('WHATSAPP_SENDER_E164'\) \|\| '\+447460035763'/)
    expect(send).toMatch(/isWhatsApp \? `whatsapp:\$\{toE164\}` : toE164/)
    expect(send).toMatch(/isWhatsApp \? `whatsapp:\$\{fromE164\}` : fromE164/)
    expect(send).toMatch(/channel: isWhatsApp \? 'whatsapp' : 'sms'/)
  })

  it('refuses an out-of-window WhatsApp send SYNCHRONOUSLY (63016 is async, waiting for it is waiting forever)', () => {
    expect(send).toMatch(/\.eq\('direction', 'inbound'\)\s*\.eq\('channel', 'whatsapp'\)/)
    expect(send).toMatch(/24 \* 3600 \* 1000/)
    expect(send).toMatch(/only allows free replies within 24 hours/)
  })

  it('blocks a recorded opt-out and reports delivery fate via StatusCallback', () => {
    expect(send).toMatch(/\.eq\('tag', 'do-not-text'\)/)
    expect(send).toMatch(/StatusCallback: `\$\{SUPABASE_URL\}\/functions\/v1\/wk-sms-status`/)
  })
})

describe('draft approval: wk-draft-action', () => {
  it('keeps the draft channel on the wire send', () => {
    expect(draftAction).toMatch(/draft\.channel as string \| null\) === 'whatsapp'/)
    expect(draftAction).toMatch(/isWhatsApp \? `whatsapp:\$\{to\}` : to/)
  })

  it('is no longer a side door: kill switch, lead lock, opt-out and the 24h window all gate it', () => {
    expect(draftAction).toMatch(/wk_outbound_sms_allowed/)
    expect(draftAction).toMatch(/wk_contact_locked_agent/)
    expect(draftAction).toMatch(/\.eq\('tag', 'do-not-text'\)/)
    expect(draftAction).toMatch(/24 \* 3600 \* 1000/)
    expect(draftAction).toMatch(/StatusCallback/)
  })
})

describe('delivery status: wk-sms-status', () => {
  it('validates the Twilio signature fail-closed and updates forward-only', () => {
    expect(status).toMatch(/x-twilio-signature/)
    expect(status).toMatch(/status: 403/)
    expect(status).toMatch(/STATUS_RANK\[status\] > currentRank/)
  })
})

describe('AI replies: api/crm/ai-reply.ts', () => {
  it('threads replyChannel from the job payload into both insert paths and the send', () => {
    expect(aiReply).toMatch(/payload\.channel === 'whatsapp' \? 'whatsapp' : 'sms'/)
    expect((aiReply.match(/channel: replyChannel/g) ?? []).length).toBe(2)
    expect(aiReply).toMatch(/sendSMS\(fromNumber, toPhone, reply, replyChannel\)/)
  })

  it('stands down on a recorded opt-out', () => {
    expect(aiReply).toMatch(/\.eq\('tag', 'do-not-text'\)/)
    expect(aiReply).toMatch(/skipped: 'do_not_text'/)
  })
})

describe('every CRM WhatsApp surface routes to wk-sms-send, none to dead Unipile', () => {
  const surfaces = [
    'src/features/crm/pages/InboxPage.tsx',
    'src/features/crm/components/contacts/ContactSmsModal.tsx',
    'src/features/crm/components/live-call/MidCallSmsSender.tsx',
    'src/features/crm/components/funnel/FunnelLeadDrawer.tsx',
  ]
  for (const p of surfaces) {
    it(`${p.split('/').pop()} sends WhatsApp via wk-sms-send channel param`, () => {
      const src = stripComments(read(p))
      expect(src).not.toMatch(/unipile-send/)
      expect(src).toMatch(/channel: 'whatsapp'/)
    })
  }

  it('the inbox digs the REAL error out of error.context (supabase-js hides the JSON body)', () => {
    expect(inboxPage).toMatch(/error\.context\?\.clone\(\)\.json\(\)/)
    // Both the composer send and the draft approval toast through it.
    expect((inboxPage.match(/fnErrorText\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
