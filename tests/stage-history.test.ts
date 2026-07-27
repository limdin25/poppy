import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "the static pipeline always show last movement even manual
// and by who." Nothing recorded stage changes anywhere before migration
// 20260727000006 — no table, no column, no trigger, 0 rows of kind='stage_moved'.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const mig = read('supabase/migrations/20260727000006_stage_history.sql')
const load = async () => import('../src/features/crm/lib/stageHistory')

describe('stage-history migration', () => {
  it('adds the four denormalised columns with a constrained source', () => {
    for (const col of ['stage_moved_at', 'stage_moved_by', 'stage_moved_from', 'stage_move_source']) {
      expect(mig).toMatch(new RegExp(`add column if not exists ${col}`))
    }
    expect(mig).toMatch(/stage_move_source in \('agent', 'automation', 'import', 'backfill'\)/)
  })

  it('stamps in a BEFORE trigger, never a recursive UPDATE', () => {
    // wk_contacts is REPLICA IDENTITY FULL and published to realtime: a second
    // UPDATE from inside an AFTER trigger would ship a second FULL-ROW event
    // per drag and tick updated_at twice.
    expect(mig).toMatch(/create trigger wk_contacts_stage_move_stamp\s+before update of pipeline_column_id/)
    const stamp = mig.split('create or replace function wk_stamp_stage_move')[1].split('$$')[2] ?? ''
    expect(stamp).not.toMatch(/update wk_contacts/i)
  })

  it('only fires when the column ACTUALLY changed', () => {
    // `UPDATE OF col` fires whenever the column is MENTIONED in the SET list,
    // and every EditContactModal save writes pipeline_column_id regardless.
    // Without this, pressing Save logs a phantom move.
    const whens = mig.match(/when \(old\.pipeline_column_id is distinct from new\.pipeline_column_id\)/g) ?? []
    expect(whens.length).toBe(2) // one on the stamp trigger, one on the log trigger
  })

  it('attributes service-role writes as automation, with a GUC escape hatch', () => {
    expect(mig).toMatch(/current_setting\('app\.stage_move_source', true\)/)
    expect(mig).toMatch(/coalesce\(auth\.role\(\), 'service_role'\) = 'service_role'/)
    expect(mig).toMatch(/then 'automation'/)
    // stage_moved_by must be NULL unless a real person did it.
    expect(mig).toMatch(/case when v_source = 'agent' then v_uid else null end/)
  })

  it('never lets a missing profiles row abort a drag-drop', () => {
    expect(mig).toMatch(/if v_uid is not null and not exists \(select 1 from profiles/)
  })

  it('logs to wk_activities from a SECURITY DEFINER after-trigger', () => {
    // wk_activities_agent_rw's WITH CHECK is (wk_is_admin() or agent_id =
    // auth.uid()); an agent_id=NULL insert from an authenticated transaction
    // would fail the check and abort the agent's own UPDATE.
    expect(mig).toMatch(/create or replace function wk_log_stage_move\(\) returns trigger\s*\nlanguage plpgsql security definer set search_path = public/)
    expect(mig).toMatch(/'stage_moved'/)
    expect(mig).toMatch(/create trigger wk_contacts_stage_move_log\s+after update of pipeline_column_id/)
  })

  it('snapshots column NAMES in meta so a rename cannot rewrite history', () => {
    expect(mig).toMatch(/'from_name', v_from, 'to_name', v_to/)
  })

  it('does NOT publish wk_activities to realtime', () => {
    expect(mig).not.toMatch(/alter publication supabase_realtime add table wk_activities/i)
  })

  it('backfills only the timestamp, marked as such, and invents no timeline rows', () => {
    expect(mig).toMatch(/stage_move_source = 'backfill'/)
    // The backfill must not fabricate wk_activities entries.
    const backfill = mig.split('5. backfill')[1] ?? ''
    expect(backfill).not.toMatch(/insert into wk_activities/i)
    // and must not re-trigger itself
    expect(backfill).not.toMatch(/set[\s\S]{0,80}pipeline_column_id\s*=/i)
  })
})

describe('stage-move copy', () => {
  const base = { at: '2026-07-27T14:32:00Z', byName: 'Pedro III Almedina', fromName: 'Voicemail', toName: 'Interested' }

  it('names the agent by first name on a card, in full on hover', async () => {
    const { stageMoveLabel, stageMoveTitle } = await load()
    const m = { ...base, source: 'agent' as const }
    expect(stageMoveLabel(m, '2h ago')).toBe('Interested · 2h ago · Pedro')
    expect(stageMoveTitle(m, '27 Jul, 14:32')).toBe(
      'Moved from Voicemail to Interested on 27 Jul, 14:32 · by Pedro III Almedina',
    )
  })

  it('says "moved automatically" rather than naming nobody', async () => {
    const { stageMoveLabel, isAutomaticMove } = await load()
    const m = { ...base, byName: null, source: 'automation' as const }
    expect(stageMoveLabel(m, '5m ago')).toBe('Interested · 5m ago · moved automatically')
    expect(isAutomaticMove('automation')).toBe(true)
    expect(isAutomaticMove('agent')).toBe(false)
  })

  it('admits when the history pre-dates tracking, and invents no "from"', async () => {
    const { stageMoveLabel, stageMoveTitle } = await load()
    const m = { ...base, byName: null, fromName: null, source: 'backfill' as const }
    expect(stageMoveLabel(m, '3d ago')).toBe('Interested · 3d ago · recorded before tracking')
    expect(stageMoveTitle(m, '24 Jul, 09:00')).toBe(
      'Moved to Interested on 24 Jul, 09:00 · recorded before tracking',
    )
    expect(stageMoveTitle(m, 'x')).not.toMatch(/from/)
  })

  it('says so plainly when nothing was ever recorded', async () => {
    const { stageMoveLabel, stageMoveTitle, NO_STAGE_MOVE } = await load()
    const m = { at: null, byName: null, fromName: null, toName: 'Interested', source: null }
    expect(stageMoveLabel(m, '')).toBe(NO_STAGE_MOVE)
    expect(stageMoveTitle(m, '')).toBe(NO_STAGE_MOVE)
    expect(NO_STAGE_MOVE).toBe('No stage moves logged')
  })

  it('is pure — no react, no supabase', () => {
    const src = read('src/features/crm/lib/stageHistory.ts')
    expect(src).not.toMatch(/from ['"]react['"]/)
    expect(src).not.toMatch(/integrations\/supabase/)
  })
})

describe('the pipeline board actually renders it', () => {
  it('puts the chip on the card and carries the new columns through', () => {
    const board = read('src/features/crm/pages/PipelinesPage.tsx')
    expect(board).toMatch(/<StageMoveChip contact=\{c\}/)
    expect(board).toMatch(/<AgentChip agentId=\{c\.ownerAgentId\}/)
    // The select must be the shared constant, or the stamps arrive undefined
    // and the chip silently renders "No stage moves logged" for everyone.
    expect(board).toMatch(/\.select\(CONTACT_COLUMNS\)/)

    const cols = read('src/features/crm/hooks/useHydrateContacts.ts')
    for (const c of ['stage_moved_at', 'stage_moved_by', 'stage_moved_from', 'stage_move_source']) {
      expect(cols).toMatch(new RegExp(c))
    }
  })
})
