// The Auction desk is a clean second CRM (Hugo, 2026-09-18): "when he toggles
// to auction everything disappears". Every surface that lists CRM data must be
// scoped by desk. These pins fail the build if one of them loses its filter.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const MIG = read('supabase/migrations/20260918000001_auction_desk.sql')

describe('the database', () => {
  it('labels contacts, calls, campaigns, boards and properties, Houses by default', () => {
    for (const t of ['wk_contacts', 'wk_calls', 'wk_dialer_campaigns', 'wk_pipelines', 'brrr_properties']) {
      expect(MIG).toMatch(new RegExp(`alter table public\\.${t} add column if not exists desk text not null default 'houses';`))
    }
  })
  it('the two RLS-bypassing reads take the desk', () => {
    expect(MIG).toMatch(/create function public\.wk_inbox_thread_previews\(p_agent_id uuid default null, p_desk text default 'houses'\)/)
    expect(MIG).toMatch(/create function public\.wk_callbacks_open\(p_hours numeric default 48, p_desk text default 'houses'\)/)
    expect(MIG).toMatch(/where c\.desk = coalesce\(p_desk, 'houses'\)/)
    expect(MIG).toMatch(/ct\.desk = coalesce\(p_desk, 'houses'\)/)
  })
  it('an agent cannot grant himself a desk', () => {
    expect(MIG).toMatch(/new\.desks\s+:= old\.desks;/)
  })
  it('calls and notifications take the desk of their contact', () => {
    const stamps = read('supabase/migrations/20260918000002_auction_desk_stamps.sql')
    expect(stamps).toMatch(/create trigger wk_calls_desk_from_contact/)
    expect(stamps).toMatch(/create trigger wk_notifications_desk_from_contact/)
  })
})

describe('every list in the CRM is scoped by desk', () => {
  const PINS: Array<[string, RegExp]> = [
    ['src/features/crm/hooks/useHydrateContacts.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/useHydratePipelineColumns.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/usePipelines.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/pages/PipelinesPage.tsx', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/useInboxThreads.ts', /p_desk: desk/],
    ['src/features/crm/hooks/useCallbacks.ts', /p_desk: desk/],
    ['src/features/crm/hooks/useCalls.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/dialer-pro/history/CallHistoryPro.tsx', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/useDialerCampaigns.ts', /\.eq\('desk', desk\)/],
    // The dialer room's own campaign list (2026-09-23): without it every desk
    // opened on "Auction - Pedro", the first campaign by name.
    ['src/features/crm/caller-pad/hooks/useDialerCampaigns.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/useNotifications.ts', /\.eq\('desk', desk\)/],
    ['src/features/crm/hooks/useInboxNotifications.ts', /\(c\.desk \?\? 'houses'\) === desk/],
    ['src/features/crm/hooks/useFollowups.ts', /\(r\.wk_contacts\?\.desk \?\? 'houses'\) === desk/],
    ['src/features/crm/components/live-call/BranchSearchPanel.tsx', /\.eq\('desk', desk\)/],
  ]
  for (const [file, re] of PINS) {
    it(file, () => expect(read(file)).toMatch(re))
  }
  it('a contact made on a desk belongs to it, and an upload never queues the other desk', () => {
    expect(read('src/features/crm/hooks/useContactPersistence.ts')).toMatch(/\n\s+desk,\n/)
    const bulk = read('src/features/crm/components/contacts/BulkUploadModal.tsx')
    expect(bulk).toMatch(/\.in\('phone', allPhones\)\s*\n\s*\.eq\('desk', desk\)/)
  })
})

describe('the switch', () => {
  it('rebuilds the whole CRM on a switch, and waits for the desk before drawing anything', () => {
    const layout = read('src/features/crm/layout/Smsv2Layout.tsx')
    expect(layout).toMatch(/return <CrmShell key=\{desk\} \/>;/)
    expect(layout).toMatch(/if \(!resolved\) \{/)
  })
  it('is locked during a call and only shown to a login with both desks', () => {
    const toggle = read('src/features/crm/layout/DeskToggle.tsx')
    expect(toggle).toMatch(/const locked = phase !== 'idle';/)
    expect(toggle).toMatch(/if \(!resolved \|\| desks\.length < 2\) return null;/)
  })
  it('hides the Houses-only pages on Auction', () => {
    const side = read('src/features/crm/layout/Smsv2Sidebar.tsx')
    for (const p of ['cockpit', 'find-builders', 'raw-leads']) expect(side).toMatch(new RegExp(`'/admin/crm/${p}'`))
    expect(side).toMatch(/desk === 'houses' \|\| !HOUSES_ONLY\.has\(path\)/)
  })
})

describe('an auction lot never reaches a Houses screen', () => {
  it('the Houses listings read is fenced to the Houses desk', () => {
    expect(read('supabase/migrations/20260918000004_auction_office_lots.sql'))
      .toMatch(/where public\.wk_is_agent_or_admin\(\)\s+and p\.desk = 'houses'/)
  })
  it('ingest files an auction lot on the Auction desk', () => {
    expect(read('api/properties/ingest.ts')).toMatch(/\.\.\.\(body\.desk === 'auction' \? \{\s*desk: 'auction',/)
  })
})
