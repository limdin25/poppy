import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "leads must always have the name of who it belongs to."
// Five components each rolled their own profiles query and each picked a
// different roster; two of them omit a profile with no workspace_role that does
// own leads — Hugo's own login — so his name rendered as "Agent"/"Unassigned".

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const mig = read('supabase/migrations/20260727000007_agent_directory.sql')
const hook = read('src/features/crm/hooks/useAgentDirectory.ts')
const load = async () => import('../src/features/crm/hooks/useAgentDirectory')

describe('wk_agent_directory RPC', () => {
  it('resolves ANY owner_agent_id, including role-less lead owners', () => {
    expect(mig).toMatch(/p\.workspace_role in \('agent', 'admin'\)/)
    expect(mig).toMatch(/from wk_voice_agent_limits l where l\.agent_id = p\.id/)
    expect(mig).toMatch(/from wk_contacts c where c\.owner_agent_id = p\.id/)
    expect(mig).toMatch(/from wk_vsl_pages v where v\.agent_id = p\.id/)
  })

  it('is staff-gated in the body, because SECURITY DEFINER bypasses RLS', () => {
    // wk_handle_new_user creates a profiles row for EVERY reviews/receptionist
    // customer signup. Without this predicate the customer table would be
    // readable by any agent's browser.
    expect(mig).toMatch(/security definer set search_path = public/)
    expect(mig).toMatch(/where public\.wk_is_agent_or_admin\(\)/)
  })

  it('is revoked from public and anon, granted only to authenticated', () => {
    expect(mig).toMatch(/revoke all on function public\.wk_agent_directory\(\) from public, anon/)
    expect(mig).toMatch(/grant execute on function public\.wk_agent_directory\(\) to authenticated/)
  })

  it('never returns a blank name', () => {
    expect(mig).toMatch(/coalesce\(nullif\(btrim\(p\.name\), ''\), p\.email, 'Agent'\)/)
  })
})

describe('resolveAgentLabel', () => {
  const entry = (id: string, name: string) => ({
    id, name, email: `${id}@x.com`, workspaceRole: 'agent', isStaff: true,
  })

  it('names a resolved agent', async () => {
    const { resolveAgentLabel } = await load()
    const byId = new Map([['a1', entry('a1', 'Pedro III Almedina')]])
    expect(resolveAgentLabel('a1', byId, false)).toEqual({ label: 'Pedro III Almedina', state: 'named' })
  })

  it('says Unassigned only when there genuinely is no owner', async () => {
    const { resolveAgentLabel } = await load()
    expect(resolveAgentLabel(null, new Map(), false).state).toBe('unassigned')
    expect(resolveAgentLabel(undefined, new Map(), false).label).toBe('Unassigned')
  })

  it('NEVER flashes Unassigned at a lead that has an owner still loading', async () => {
    // This is exactly the lie ContactDetailPage told for months.
    const { resolveAgentLabel } = await load()
    const got = resolveAgentLabel('a1', new Map(), true)
    expect(got.state).toBe('loading')
    expect(got.label).not.toBe('Unassigned')
  })

  it('distinguishes a deleted profile from an unowned lead', async () => {
    const { resolveAgentLabel } = await load()
    expect(resolveAgentLabel('gone', new Map(), false)).toEqual({ label: 'Unknown agent', state: 'unknown' })
  })

  it('builds initials the SAME way the leaderboard already does', async () => {
    // First two words, not first+last: the leaderboard avatar renders "PI" for
    // Pedro III Almedina today. A prettier rule here would give the same person
    // two different discs on two screens.
    const { agentInitials } = await load()
    expect(agentInitials('Pedro III Almedina')).toBe('PI')
    expect(agentInitials('Marr Roland Servidor')).toBe('MR')
    expect(agentInitials('Hugo')).toBe('H')
    expect(agentInitials('')).toBe('?')
  })
})

describe('one roster, one request', () => {
  it('reads the RPC, not the profiles table directly', () => {
    expect(hook).toMatch(/rpc\('wk_agent_directory'\)/)
    expect(hook).not.toMatch(/from\('profiles'/)
  })

  it('uses the shared query cache so N components make ONE request', () => {
    expect(hook).toMatch(/queryKey: \['agent-directory'\]/)
    expect(hook).toMatch(/staleTime/)
  })

  it('separates assignable staff from merely resolvable names', () => {
    // A viewer must not be offered as an owner, but nameOf must still resolve
    // one who already owns leads.
    expect(hook).toMatch(/agents: all\.filter\(\(a\) => a\.isStaff\)/)
  })
})

/** Comments explain the bug we fixed and legitimately name it — assert on code. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('EditContactModal no longer offers fake owners', () => {
  const modalRaw = read('src/features/crm/components/contacts/EditContactModal.tsx')
  const modal = stripComments(modalRaw)

  it('drops MOCK_AGENTS entirely', () => {
    // Picking a mock owner made sanitizeUuidFields silently DROP the field and
    // return true — the modal toasted "Saved ✓" and nothing was reassigned.
    // 7 of its 10 call sites passed no agents prop, so this was the norm.
    expect(modal).not.toMatch(/MOCK_AGENTS/)
    expect(modal).not.toMatch(/from '\.\.\/\.\.\/data\/mockAgents'/)
  })

  it('reads the real directory itself, so every call site is right', () => {
    expect(modal).toMatch(/useAgentDirectory\(\)/)
    expect(modal).toMatch(/directory\.agents/)
  })

  it('shows an honest disabled state rather than an empty enabled dropdown', () => {
    expect(modal).toMatch(/Loading agents…/)
    expect(modal).toMatch(/disabled=\{ownersLoading\}/)
  })

  it('makes the PERSON editable, not just the company', () => {
    // contact.name is the COMPANY. owner_name was reachable only via the
    // generic custom-field list, which renders keys that ALREADY exist — so on
    // a lead missing it there was no way to add the person's name at all.
    expect(modal).toMatch(/label="Business name"/)
    expect(modal).toMatch(/label="Person's name"/)
    expect(modal).toMatch(/owner_name: e\.target\.value/)
    expect(modal).toMatch(/website: e\.target\.value/)
    // and they must not also appear in the generic list
    expect(modal).toMatch(/k !== 'owner_name'/)
    expect(modal).toMatch(/k !== 'website'/)
  })
})

describe('AgentChip renders the four states', () => {
  const chip = read('src/features/crm/components/shared/AgentChip.tsx')

  it('tones a gap red, a load muted, an unknown grey', () => {
    expect(chip).toMatch(/unassigned: 'text-\[#C4302B\] italic'/)
    expect(chip).toMatch(/loading: 'text-\[#D1D5DB\]'/)
    expect(chip).toMatch(/unknown: 'text-\[#9CA3AF\] italic'/)
  })

  it('stays light mode — Hugo\'s standing rule', () => {
    expect(chip).not.toMatch(/dark:/)
  })
})

describe('every lead surface names its agent', () => {
  const surfaces: Array<[string, string]> = [
    ['video funnel card', 'src/features/crm/pages/VideoFunnelPage.tsx'],
    ['inbox row', 'src/features/crm/pages/InboxPage.tsx'],
    ['pipeline card', 'src/features/crm/pages/PipelinesPage.tsx'],
    ['contacts row', 'src/features/crm/pages/ContactsPage.tsx'],
    ['contact detail', 'src/features/crm/pages/ContactDetailPage.tsx'],
    ['call history', 'src/features/crm/dialer-pro/history/CallHistoryPro.tsx'],
    ['queue manager', 'src/features/crm/dialer-pro/history/QueueManagerPro.tsx'],
    ['dialer pane', 'src/features/crm/dialer-pro/DialerProPage.tsx'],
  ]

  for (const [label, path] of surfaces) {
    it(`${label} renders an AgentChip`, () => {
      expect(read(path)).toMatch(/<AgentChip/)
    })
  }

  it('contact detail no longer reads the permanently-empty store agents', () => {
    // upsertAgent is dispatched NOWHERE, so state.agents is always [] and the
    // Owner field said "Unassigned" for all 3,510 leads.
    const detail = read('src/features/crm/pages/ContactDetailPage.tsx')
    expect(detail).not.toMatch(/agents\.find\(\(a\) => a\.id === contact\.ownerAgentId\)/)
  })
})
