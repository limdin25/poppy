import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  extractTemplateVars,
  slugTemplateName,
  templateProblem,
} from '../src/features/crm/lib/waTemplates'

// WhatsApp Business management (Hugo 2026-08-03): Meta message templates +
// sender profile, both behind the admin-only wk-whatsapp-admin edge fn.
// Templates are the ONLY way to open a conversation outside the 24h window,
// so the validation here decides what reaches Meta's reviewer.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('template validation (client twin of the edge fn)', () => {
  it('accepts the shape Hugo actually asked for', () => {
    const body =
      'Hi {{1}}, thanks for your interest! Would you mind sharing the URL of the Instagram account you will be using to work with us?\n\nThanks,\nMaria'
    expect(templateProblem('instagram_url_request', body)).toBeNull()
  })

  it('refuses named variables: Meta wants {{1}}, not {{name}}', () => {
    expect(templateProblem('t_1', 'Hi {{name}}, hello there')).toMatch(/must be numbers/)
  })

  it('refuses gaps and non-1 starts in variable numbering', () => {
    expect(templateProblem('t_1', 'Hi {{2}}, welcome aboard')).toMatch(/no gaps/)
    expect(templateProblem('t_1', 'Hi {{1}} and {{3}}, welcome')).toMatch(/no gaps/)
  })

  it('refuses a body that starts or ends with a variable (Meta rejects those)', () => {
    expect(templateProblem('t_1', '{{1}} thanks for joining')).toMatch(/start or end/)
    expect(templateProblem('t_1', 'thanks for joining {{1}}')).toMatch(/start or end/)
  })

  it('refuses long dashes and curly quotes (house rule, machine-checked)', () => {
    // Fixtures built from code points so this file stays clean under a
    // repo-wide grep for the very characters it is testing.
    const ch = (c: number) => String.fromCharCode(c)
    expect(templateProblem('t_1', `Hi {{1}} ${ch(0x2014)} welcome`)).toMatch(/straight punctuation/i)
    expect(templateProblem('t_1', `Hi {{1}}, you${ch(0x2019)}re in`)).toMatch(/straight punctuation/i)
    expect(templateProblem('t_1', `Hi {{1}}, wait${ch(0x2026)} ok`)).toMatch(/straight punctuation/i)
  })

  it('refuses bad names and oversize bodies', () => {
    expect(templateProblem('Bad Name', 'Hi {{1}}, welcome')).toMatch(/lowercase/)
    expect(templateProblem('t_1', 'x'.repeat(1025))).toMatch(/1024/)
  })

  it('slug + var extraction behave', () => {
    expect(slugTemplateName("Instagram URL request!")).toBe('instagram_url_request')
    expect(extractTemplateVars('Hi {{1}}, meet {{2}} and {{1}} again')).toEqual(['1', '2'])
  })
})

describe('wk-whatsapp-admin edge fn wiring', () => {
  const fn = read('supabase/functions/wk-whatsapp-admin/index.ts')
  const fnCode = stripComments(fn)

  it('is admin-only: checks admin_users after verifying the JWT', () => {
    expect(fnCode).toMatch(/auth\.getUser\(jwt\)/)
    expect(fnCode).toMatch(/from\('admin_users'\)/)
    expect(fnCode).toMatch(/Admins only/)
  })

  it('server-side validation mirrors the client twin (numbered vars, no long dashes, start/end rule)', () => {
    expect(fn).toMatch(/BANNED_PUNCTUATION/)
    expect(fnCode).toMatch(/Variables must be numbers/)
    expect(fnCode).toMatch(/start or end with a variable/)
  })

  it('submits to Meta via ApprovalRequests/whatsapp and reads status from ContentAndApprovals', () => {
    expect(fnCode).toMatch(/ApprovalRequests\/whatsapp/)
    expect(fnCode).toMatch(/ContentAndApprovals/)
  })

  it('a created-but-unsubmitted template is reported honestly, with its sid', () => {
    expect(fnCode).toMatch(/but the Meta submission failed/)
  })

  it('config.toml registers the function with verify_jwt = true', () => {
    const toml = read('supabase/config.toml')
    expect(toml).toMatch(/\[functions\.wk-whatsapp-admin\]\s*\nverify_jwt = true/)
  })
})

describe('the Templates page keeps each thing in its OWN card', () => {
  // Hugo 2026-08-03: profile + templates shared one box with two Save
  // buttons, so it read as one form ("looks like if I save the profile is
  // gonna save the template"). Three separate cards now.
  const page = stripComments(read('src/features/crm/pages/TemplatesPage.tsx'))

  it('mounts the two admin cards separately, not one merged panel', () => {
    expect(page).toMatch(/isAdminOrWorkspaceAdmin && <WhatsAppMetaTemplates \/>/)
    expect(page).toMatch(/isAdminOrWorkspaceAdmin && <WhatsAppProfileCard \/>/)
    expect(page).not.toMatch(/WhatsAppBusinessPanel/)
  })

  it('each card is its own bordered box, stacked with spacing', () => {
    expect(page).toMatch(/const CARD = 'bg-white border/)
    expect(page).toMatch(/max-w-3xl mx-auto space-y-4/)
    for (const testid of ['wa-meta-templates-card', 'wa-profile-card', 'wa-quick-replies-card']) {
      const src = testid === 'wa-quick-replies-card'
        ? page
        : read(`src/features/crm/components/templates/${testid === 'wa-profile-card' ? 'WhatsAppProfileCard' : 'WhatsAppMetaTemplates'}.tsx`)
      expect(src).toContain(testid)
    }
  })

  it('the cards call wk-whatsapp-admin through one shared door that unwraps error bodies', () => {
    const lib = stripComments(read('src/features/crm/lib/waAdmin.ts'))
    expect(lib).toMatch(/functions\.invoke\('wk-whatsapp-admin'/)
    expect(lib).toMatch(/error\.context\?\.clone\(\)\.json\(\)/)
    for (const f of ['WhatsAppMetaTemplates', 'WhatsAppProfileCard']) {
      const src = stripComments(read(`src/features/crm/components/templates/${f}.tsx`))
      expect(src).toMatch(/callWaAdmin/)
    }
  })
})

describe('sending an approved template (wk-sms-send)', () => {
  const send = stripComments(read('supabase/functions/wk-sms-send/index.ts'))

  it('a template send SKIPS the 24h window, which is the entire point of it', () => {
    expect(send).toMatch(/if \(isWhatsApp && !isTemplate\) \{/)
  })

  it('verifies Meta approval BEFORE spending (an unapproved send dies async, like 63016)', () => {
    expect(send).toMatch(/ApprovalRequests/)
    expect(send).toMatch(/waStatus !== 'approved'/)
  })

  it('ContentSid REPLACES Body, and the variables ride along as JSON', () => {
    expect(send).toMatch(/form\.set\('ContentSid', contentSid\)/)
    expect(send).toMatch(/form\.set\('ContentVariables', JSON\.stringify\(templateVars\)\)/)
    // Body only on the non-template branch, else Twilio 400s.
    expect(send).toMatch(/\} else \{\s*form\.set\('Body', smsBody\);/)
  })

  it('refuses a half-filled template rather than sending "Hi {{1}}"', () => {
    expect(send).toMatch(/Fill in every blank first/)
  })

  it('stores the FILLED wording so the thread shows what the lead read', () => {
    expect(send).toMatch(/body: isTemplate \? renderedTemplate : body/)
  })

  it('still honours every other gate: opt-out, lead lock, kill switch', () => {
    expect(send).toMatch(/\.eq\('tag', 'do-not-text'\)/)
    expect(send).toMatch(/wk_contact_locked_agent/)
    expect(send).toMatch(/wk_outbound_sms_allowed/)
  })

  it('agents (not just admins) may LIST templates, since they send them', () => {
    const admin = stripComments(read('supabase/functions/wk-whatsapp-admin/index.ts'))
    expect(admin).toMatch(/action !== 'template_list' && !isAdmin/)
  })
})

describe('the inbox composer offers the template when the window is shut', () => {
  const inbox = stripComments(read('src/features/crm/pages/InboxPage.tsx'))

  it('sends content_sid + content_variables, never a body, for a template', () => {
    expect(inbox).toMatch(/content_sid: activeMetaTemplate!\.sid/)
    expect(inbox).toMatch(/content_variables: metaVars/)
  })

  it('warns before the send fails, instead of after', () => {
    expect(inbox).toMatch(/inbox-wa-window-closed/)
    expect(inbox).toMatch(/has not messaged in 24 hours/)
  })

  it('only offers APPROVED templates', () => {
    expect(inbox).toMatch(/\.filter\(isApproved\)/)
  })

  it('prefills the person, not the company (contact.name is the business)', () => {
    expect(inbox).toMatch(/customFields\?\.owner_name/)
  })

  // Review-caught (three lenses independently): the attach control stayed
  // live in template mode, but the template branch sends no attachment_url,
  // so a staged file was dropped while the toast said "Template sent".
  it('cannot stage a file against a template: the paperclip is hidden and any staged file cleared', () => {
    expect(inbox).toMatch(/if \(tpl\) setReplyAttachmentUrl\(null\)/)
    expect(inbox).toMatch(/activeMetaTemplate \? null : replyAttachmentUrl \?/)
  })
})

describe('a Twilio hiccup is not reported as a missing template', () => {
  const send = stripComments(read('supabase/functions/wk-sms-send/index.ts'))

  it('twilioGet keeps the status, so 404 and 429 are told apart', () => {
    expect(send).toMatch(/Promise<\{ status: number; data: Record<string, unknown> \| null \}>/)
    expect(send).toMatch(/approval\.status === 404/)
  })

  it('an unreachable Twilio says "try again", never "that template does not exist"', () => {
    expect(send).toMatch(/Could not check that template with Twilio just now/)
    expect(send).toMatch(/Could not read that template from Twilio just now/)
    // Both must promise nothing was sent, because nothing was.
    expect((send.match(/Nothing was sent, try again in a moment/g) ?? []).length).toBe(2)
  })
})
