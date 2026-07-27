import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "I and the team need to be able to open the lead during any
// stage on /admin/crm/video-funnel and edit name, email, text, anything."
// Before this the card only linked out to the contact page and opened a
// read-only activity list.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const drawerRaw = read('src/features/crm/components/funnel/FunnelLeadDrawer.tsx')
const drawer = stripComments(drawerRaw)
const boardRaw = read('src/features/crm/pages/VideoFunnelPage.tsx')
const board = stripComments(boardRaw)

describe('the drawer', () => {
  it('exists, is the default export, and keeps the old test id', () => {
    expect(drawer).toMatch(/export default function FunnelLeadDrawer/)
    expect(drawer).toMatch(/data-testid="funnel-lead-drawer"/)
    expect(drawer).toMatch(/data-testid="funnel-activity-drawer"/)
  })

  it('embeds the real edit + SMS components instead of hand-rolling a form', () => {
    expect(drawer).toMatch(/<EditContactModal/)
    expect(drawer).toMatch(/<ContactSmsModal/)
    expect(drawer).not.toMatch(/<input[\s\S]{0,60}draft\.phone/)
  })

  it('persists the WIDE field set, not ContactDetailPage’s three', () => {
    // Copying that call site verbatim would silently discard phone, owner and —
    // the whole point of this drawer — custom_fields.owner_name.
    const save = drawer.split('const save = useCallback')[1]?.split('}, [')[0] ?? ''
    for (const k of [
      'name:', 'phone:', 'email:', 'owner_agent_id:', 'pipeline_column_id:',
      'deal_value_pence:', 'custom_fields:',
    ]) {
      expect(save).toContain(k)
    }
    // Tags live in a different table; patchContact cannot write them.
    expect(drawer).toMatch(/persist\.replaceTags/)
  })

  it('reverts optimistically on failure rather than lying', () => {
    expect(drawer).toMatch(/upsertContact\(prev\)/)
    expect(drawer).toMatch(/Save failed/)
  })

  it('falls back to a by-id fetch, then to an honest no-access state', () => {
    // wk_vsl_pages RLS is narrower than wk_contacts', and useHydrateContacts
    // filters by owner while impersonating — a store miss is legitimate.
    expect(drawer).toMatch(/\.select\(CONTACT_COLUMNS\)/)
    expect(drawer).toMatch(/setState\('denied'\)/)
    expect(drawer).toMatch(/isn't visible under your access/)
  })

  it('is the ONE send path, and shows the message before it goes', () => {
    // Hugo 2026-07-27: "it says looks good text it but is not showing the text."
    // Sending moved here from the board so there is exactly one path, one
    // guard, and a message the agent has actually read.
    expect(drawer).toMatch(/wk-sms-send/)
    expect(drawer).toMatch(/data-testid="funnel-send-composer"/)
    expect(drawer).toMatch(/data-testid="funnel-send-body"/)
    expect(drawer).toMatch(/onNudge/)
  })

  it('offers all three channels, with text as the default', () => {
    expect(drawer).toMatch(/useState<Channel>\('sms'\)/)
    expect(drawer).toMatch(/invoke\('unipile-send'/)   // WhatsApp
    expect(drawer).toMatch(/invoke\('wk-email-send'/)  // Email
    // A channel the lead has no address for is disabled, not left to fail on send.
    expect(drawer).toMatch(/c === 'email' \? !!contact\?\.email : !!contact\?\.phone/)
  })

  it('re-checks the server immediately before sending', () => {
    // The funnel may have been switched off, or the render may not be ready,
    // since the composer was opened.
    expect(drawer).toMatch(/freshInfo\.enabled === false/)
    expect(drawer).toMatch(/!freshInfo\.can_send/)
  })

  it('lets the agent edit the message without losing it on a refetch', () => {
    expect(drawer).toMatch(/setBody\(\(b\) => \(b\.trim\(\) \? b : data\.sms_body\)\)/)
    expect(drawer).toMatch(/Reset to template/)
  })

  it('gates ESC so one keypress cannot close two layers', () => {
    expect(drawer).toMatch(/e\.key === 'Escape' && !editing && !smsTo/)
  })

  it('shows the render timeline Hugo asked for', () => {
    expect(drawer).toMatch(/FULL_TIMELINE/)
    const lib = read('src/features/crm/lib/funnelStages.ts')
    expect(lib).toMatch(/'Video requested'/)  // "when agent clicked to create"
    expect(lib).toMatch(/'Page created'/)
    expect(lib).toMatch(/'Video ready'/)
  })

  it('keeps the staff-preview labelling that moved here intact', () => {
    expect(drawer).toMatch(/Viewed by us/)
    expect(drawer).toMatch(/staff preview, not counted/)
  })

  it('says which column the card is in, and since when', () => {
    expect(drawer).toMatch(/columnEnteredAt/)
    expect(drawer).toMatch(/In \{entered\.label\} since/)
  })

  it('names the agent who made the video', () => {
    expect(drawer).toMatch(/<AgentChip agentId=\{page\.agent_id\}/)
  })
})

describe('the board card', () => {
  it('is a keyboard-reachable button region, not a nested <button>', () => {
    expect(board).toMatch(/role="button"/)
    expect(board).toMatch(/tabIndex=\{0\}/)
    expect(board).toMatch(/data-testid=\{`funnel-card-\$\{p\.id\}`\}/)
  })

  it('ignores Enter/Space that came from a nested control', () => {
    expect(board).toMatch(/if \(e\.target !== e\.currentTarget\) return/)
  })

  it('stops the action row and the video from opening the drawer', () => {
    const guards = board.match(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
  })

  it('holds an ID, so the open drawer stays live as the board reloads', () => {
    expect(board).toMatch(/const \[drawerPageId, setDrawerPageId\] = useState<string \| null>\(null\)/)
    expect(board).toMatch(/pages\.find\(\(p\) => p\.id === drawerPageId\)/)
  })

  it('does not slam the drawer shut during a reload', () => {
    // setPages(data || []) briefly empties the list on every refresh.
    expect(board).toMatch(/drawerPageId && pages\.length > 0 && !pages\.some/)
  })

  it('keeps the staff-preview marker where the funnel tracking expects it', () => {
    expect(board).toMatch(/const PREVIEW = '\?p=1'/)
    expect(board).toMatch(/\$\{p\.slug\}\$\{PREVIEW\}/)
  })

  it('shrank rather than grew — the stage rules moved to lib/', () => {
    expect(boardRaw.split('\n').length).toBeLessThan(963)
    expect(board).toMatch(/from '\.\.\/lib\/funnelStages'/)
    expect(board).not.toMatch(/function boardKey\(/)
    expect(board).not.toMatch(/function ActivityDrawer\(/)
  })
})
