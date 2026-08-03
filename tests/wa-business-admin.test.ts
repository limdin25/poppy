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
    expect(templateProblem('t_1', 'Hi {{1}} — welcome')).toMatch(/straight punctuation/i)
    expect(templateProblem('t_1', 'Hi {{1}}, you’re in')).toMatch(/straight punctuation/i)
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

describe('the Templates page mounts the panel for admins only', () => {
  it('WhatsApp tab renders WhatsAppBusinessPanel behind the admin flag', () => {
    const page = stripComments(read('src/features/crm/pages/TemplatesPage.tsx'))
    expect(page).toMatch(/isAdminOrWorkspaceAdmin && <WhatsAppBusinessPanel \/>/)
  })

  it('the panel calls wk-whatsapp-admin and surfaces edge-fn error bodies', () => {
    const panel = stripComments(read('src/features/crm/components/templates/WhatsAppBusinessPanel.tsx'))
    expect(panel).toMatch(/functions\.invoke\('wk-whatsapp-admin'/)
    expect(panel).toMatch(/error\.context\?\.clone\(\)\.json\(\)/)
  })
})
