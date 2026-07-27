import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27, on /admin/crm/contacts: "we only have the business name, we
// also need the lead name" and "date and time of when video was opened, moved
// automatically to any column on the video pipeline, date and time when agent
// click to create the video."

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const contacts = stripComments(read('src/features/crm/pages/ContactsPage.tsx'))
const hook = stripComments(read('src/features/crm/hooks/useContactVslPages.ts'))
const backfill = read('supabase/migrations/20260727000005_owner_backfill.sql')
const rls = read('supabase/migrations/20260727000008_vsl_pages_owner_read.sql')
const load = async () => import('../src/features/crm/hooks/useContactVslPages')

const vslPage = (over: Record<string, unknown> = {}) =>
  ({
    contactId: 'c1', slug: 's', agentId: 'a1',
    createdAt: '2026-07-20T09:00:00Z',
    renderStatus: null, renderRequestedAt: null, renderDoneAt: null,
    sentAt: null, firstOpenedAt: null, watchedAt: null,
    ctaClickedAt: null, checkoutStartedAt: null, paidAt: null,
    state: 'created', watchedPct: 0, openCount: 0,
    ...over,
  }) as never

describe('the Contacts page shows the person', () => {
  it('renders ContactIdentity under the company name', () => {
    // This was the ONLY lead surface in the CRM not doing so.
    expect(contacts).toMatch(/<ContactIdentity/)
    expect(contacts).toMatch(/owner=\{c\.customFields\?\.owner_name\}/)
  })

  it('resolves the Owner column through the shared directory', () => {
    expect(contacts).toMatch(/<AgentChip agentId=\{c\.ownerAgentId\}/)
    expect(contacts).not.toMatch(/owner\?\.name \?\? 'Unassigned'/)
  })
})

describe('the Video column', () => {
  it('exists, with all three of the moments Hugo asked for', () => {
    expect(contacts).toMatch(/>Video</)
    expect(contacts).toMatch(/'Created'/)   // when the agent made it
    expect(contacts).toMatch(/'Opened'/)    // when the lead opened it
    expect(contacts).toMatch(/Auto → \$\{auto\.column\}/) // when the funnel moved it
  })

  it('shows a relative label with the exact stamp on hover', () => {
    expect(contacts).toMatch(/formatRelativeTime\(iso\)/)
    expect(contacts).toMatch(/formatDateTime\(iso\)/)
  })

  it('distinguishes "no video" from a failed render', () => {
    expect(contacts).toMatch(/render failed/)
  })

  it('fetches only the visible slice, not all 3,500 contacts', () => {
    expect(contacts).toMatch(/visibleSlice\.map\(\(c\) => c\.id\)/)
    expect(contacts).toMatch(/useContactVslPages\(visibleIds\)/)
  })
})

describe('useContactVslPages', () => {
  it('batches and reports a failed batch', () => {
    expect(hook).toMatch(/const CHUNK = 100/)
    expect(hook).toMatch(/console\.warn\('\[useContactVslPages\] batch failed:/)
  })

  it('reads the render-request stamp, the whole point of "when agent clicked"', () => {
    expect(hook).toMatch(/render_requested_at/)
    expect(hook).toMatch(/first_opened_at/)
  })
})

describe('lastAutoMove', () => {
  it('picks the LATEST funnel stamp, not the furthest stage', async () => {
    const { lastAutoMove } = await load()
    const got = lastAutoMove(vslPage({
      sentAt: '2026-07-22T09:00:00Z',
      firstOpenedAt: '2026-07-23T09:00:00Z',
    }))
    expect(got).toEqual({ at: '2026-07-23T09:00:00Z', column: 'Opened page' })
  })

  it('names the column the funnel moved the card to', async () => {
    const { lastAutoMove } = await load()
    expect(lastAutoMove(vslPage({ paidAt: '2026-07-24T09:00:00Z' }))?.column).toBe('Paid')
    expect(lastAutoMove(vslPage({ ctaClickedAt: '2026-07-24T09:00:00Z' }))?.column).toBe('Clicked button')
  })

  it('returns null when the funnel has never moved it', async () => {
    const { lastAutoMove } = await load()
    expect(lastAutoMove(vslPage())).toBeNull()
  })

  it('is immune to a later manual drag — it reads the VSL row, not stage_moved_at', () => {
    // wk_contacts.stage_moved_at holds only the LAST move, so one manual drag
    // would erase the auto-move moment forever. These stamps are immutable.
    expect(hook).not.toMatch(/stage_moved_at/)
  })
})

describe('the owner backfill', () => {
  it('backs every pre-image up BEFORE it writes', () => {
    const backupIdx = backfill.indexOf('insert into wk_contacts_owner_backfill_20260727')
    const updateIdx = backfill.indexOf('update wk_contacts c\n   set owner_agent_id')
    expect(backupIdx).toBeGreaterThan(-1)
    expect(updateIdx).toBeGreaterThan(backupIdx)
  })

  it('ships a revert', () => {
    expect(backfill).toMatch(/REVERT \(run by hand/)
    expect(backfill).toMatch(/set owner_agent_id = b\.owner_agent_id/)
  })

  it('only assigns an agent who genuinely called or texted the lead', () => {
    expect(backfill).toMatch(/from wk_calls k/)
    expect(backfill).toMatch(/from wk_sms_messages m/)
    expect(backfill).toMatch(/m\.direction = 'outbound'/)
    expect(backfill).toMatch(/order by ts desc/)
    // no evidence -> stays NULL
    expect(backfill).toMatch(/and c\.owner_agent_id is null/)
  })

  it('never points the FK at an auth user with no profiles row', () => {
    expect(backfill).toMatch(/exists \(select 1 from profiles p where p\.id = e\.agent_id\)/)
  })

  it('cannot trip the stage-move triggers', () => {
    expect(backfill).not.toMatch(/set[\s\S]{0,60}pipeline_column_id\s*=/)
  })
})

describe('the wk_vsl_pages read widening', () => {
  it('lets a lead-owner see their lead’s video page', () => {
    // The policy keyed only on the PAGE's agent_id, which is narrower than
    // wk_contacts' — so a lead you own whose video someone else made showed an
    // empty Video column, indistinguishable from "no video".
    expect(rls).toMatch(/for select to authenticated/)
    expect(rls).toMatch(/c\.owner_agent_id = auth\.uid\(\)/)
    expect(rls).toMatch(/wk_is_admin\(\)/)
  })

  it('does not open up writes', () => {
    expect(rls).not.toMatch(/for (insert|update|delete|all)/i)
  })
})
