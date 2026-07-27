import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// lib/funnelStages holds the video funnel's stage rules. They used to live
// inline in VideoFunnelPage.tsx; the inbox badges now need the SAME rules, and
// a second copy would drift. These are real behavioural tests, not greps —
// which is the whole reason the module is pure (no react, no supabase).

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const load = async () => import('../src/features/crm/lib/funnelStages')

const page = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1', slug: 'acme', contact_id: 'c1', agent_id: 'a1',
    business_name: 'Acme', owner_first: null, town: null,
    state: 'created', watched_pct: 0, open_count: 0, cta_variant: 'a',
    created_at: '2026-07-20T09:00:00Z',
    sent_at: null, first_click_at: null, click_count: 0, first_opened_at: null,
    play_at: null, watched_at: null, completed_at: null, cta_clicked_at: null,
    checkout_started_at: null, paid_at: null,
    updated_at: '2026-07-27T12:00:00Z',
    render_status: null, render_error: null,
    render_requested_at: null, render_started_at: null, render_done_at: null,
    video_url: null, poster_url: null, no_website: false,
    ...over,
  }) as never

describe('boardKey — the rendering carve-out', () => {
  it('carves rendering and render_ready out of state created', async () => {
    const { boardKey } = await load()
    expect(boardKey({ state: 'created', render_status: null })).toBe('created')
    expect(boardKey({ state: 'created', render_status: 'queued' })).toBe('rendering')
    expect(boardKey({ state: 'created', render_status: 'rendering' })).toBe('rendering')
    expect(boardKey({ state: 'created', render_status: 'ready' })).toBe('render_ready')
  })

  it('leaves a failed render in created so the card can wear the error', async () => {
    const { boardKey } = await load()
    expect(boardKey({ state: 'created', render_status: 'failed' })).toBe('created')
  })

  it('NEVER calls an already-sent page "ready to send"', async () => {
    // render_status never resets after sending. Keying "waiting on a human" off
    // it alone would badge every sent lead as waiting, forever — the single
    // nastiest bug available in this feature.
    const { boardKey, isReadyToSend } = await load()
    expect(boardKey({ state: 'sent', render_status: 'ready' })).toBe('sent')
    expect(isReadyToSend({ state: 'sent', render_status: 'ready' })).toBe(false)
    expect(isReadyToSend({ state: 'paid', render_status: 'ready' })).toBe(false)
    expect(isReadyToSend({ state: 'created', render_status: 'ready' })).toBe(true)
  })
})

describe('columnEnteredAt — "when did it move to this column"', () => {
  it('answers with the stamp that put the card where it is, for every column', async () => {
    const { columnEnteredAt } = await load()
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{}, 'created', '2026-07-20T09:00:00Z'],
      [{ render_status: 'rendering', render_started_at: '2026-07-21T10:00:00Z' }, 'rendering', '2026-07-21T10:00:00Z'],
      [{ render_status: 'ready', render_done_at: '2026-07-21T11:00:00Z' }, 'render_ready', '2026-07-21T11:00:00Z'],
      [{ state: 'sent', sent_at: '2026-07-22T09:00:00Z' }, 'sent', '2026-07-22T09:00:00Z'],
      [{ state: 'opened', first_opened_at: '2026-07-22T10:00:00Z' }, 'opened', '2026-07-22T10:00:00Z'],
      [{ state: 'watched', watched_at: '2026-07-22T11:00:00Z' }, 'watched', '2026-07-22T11:00:00Z'],
      [{ state: 'cta_clicked', cta_clicked_at: '2026-07-22T12:00:00Z' }, 'cta_clicked', '2026-07-22T12:00:00Z'],
      [{ state: 'checkout_started', checkout_started_at: '2026-07-22T13:00:00Z' }, 'checkout_started', '2026-07-22T13:00:00Z'],
      [{ state: 'paid', paid_at: '2026-07-22T14:00:00Z' }, 'paid', '2026-07-22T14:00:00Z'],
    ]
    for (const [over, key, at] of cases) {
      const got = columnEnteredAt(page(over))
      expect(got.key).toBe(key)
      expect(got.at).toBe(at)
    }
  })

  it('falls back to render_requested_at while a render is still queued', async () => {
    const { columnEnteredAt } = await load()
    const got = columnEnteredAt(page({ render_status: 'queued', render_requested_at: '2026-07-21T08:00:00Z' }))
    expect(got.key).toBe('rendering')
    expect(got.at).toBe('2026-07-21T08:00:00Z')
  })

  it('falls back to updated_at rather than showing nothing', async () => {
    const { columnEnteredAt } = await load()
    // A page whose state advanced but whose stamp is missing must still show a
    // time — "—" on the stage line reads as a bug to an operator.
    expect(columnEnteredAt(page({ state: 'opened', first_opened_at: null })).at)
      .toBe('2026-07-27T12:00:00Z')
  })
})

describe('the module stays unit-testable', () => {
  it('imports neither react nor supabase', async () => {
    const src = read('src/features/crm/lib/funnelStages.ts')
    expect(src).not.toMatch(/from ['"]react['"]/)
    expect(src).not.toMatch(/integrations\/supabase/)
  })

  it('keeps all nine of Hugo’s journey labels, in order', async () => {
    const { STAGE_STAMPS, FULL_TIMELINE } = await load()
    expect(STAGE_STAMPS.map((s) => s.label)).toEqual([
      'Video texted',
      'Tapped the link',
      'Opened the page',
      'Started the video',
      'Watched (past halfway)',
      'Watched to the end',
      'Clicked "Start £1 Trial"',
      'Started checkout',
      'Paid',
    ])
    // The render steps Hugo asked for sit in FRONT of the nine.
    expect(FULL_TIMELINE.slice(0, 4).map((s) => s.label)).toEqual([
      'Page created', 'Video requested', 'Rendering started', 'Video ready',
    ])
  })

  it('exposes one colour per stage so board and inbox agree', async () => {
    const { STATES, stateMeta } = await load()
    expect(STATES).toHaveLength(9)
    expect(stateMeta('paid').label).toBe('Paid 🎉')
    // Unknown key degrades instead of throwing.
    expect(stateMeta('nonsense').color).toBe('#9CA3AF')
  })
})
