import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "they should still pick an outcome of the call for the
// pipeline, we already have the video funnel here, so we don't need those
// columns visible on pipelines" + "inside the video funnel we can see the label
// of each lead like interested, nurturing etc."
//
// Two independent axes:
//   wk_contacts.pipeline_column_id — what the HUMAN learned on the call
//   wk_vsl_pages.state             — where the VIDEO is in its journey
// The funnel used to write the first one, destroying the agent's outcome.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const mig = read('supabase/migrations/20260727000009_unhijack_pipeline.sql')
const settings = stripComments(read('api/lib/vsl-settings.ts'))
const vslPage = stripComments(read('api/crm/vsl-page.ts'))
const board = stripComments(read('src/features/crm/pages/VideoFunnelPage.tsx'))
const hydrate = stripComments(read('src/features/crm/hooks/useHydratePipelineColumns.ts'))

describe('the funnel no longer writes the sales pipeline', () => {
  it('advanceVslState does not move the pipeline card', () => {
    expect(settings).not.toMatch(/await movePipelineCard\(/)
  })

  it('neither mover exists any more', () => {
    expect(settings).not.toMatch(/export async function movePipelineCard\b/)
    expect(settings).not.toMatch(/export async function movePipelineCardToColumn\b/)
  })

  it('queueing a render does not move the lead either', () => {
    expect(vslPage).not.toMatch(/movePipelineCardToColumn/)
  })

  it('no funnel code writes pipeline_column_id at all', () => {
    expect(settings).not.toMatch(/update\([\s\S]{0,60}pipeline_column_id/)
  })

  it('the AI booking route is untouched — that IS a real outcome', () => {
    // api/crm/book.ts moves a lead to Booked when the voice agent books a call.
    // That is a human-equivalent disposition and must keep working.
    expect(read('api/crm/book.ts')).toMatch(/pipeline_column_id/)
  })
})

describe('the funnel columns are archived, not deleted', () => {
  it('adds an archived flag rather than dropping the columns', () => {
    // wk_activities.meta references these ids; a DROP would orphan the history
    // the stage-move backfill just created.
    expect(mig).toMatch(/add column if not exists archived boolean not null default false/)
    expect(mig).not.toMatch(/delete from wk_pipeline_columns/i)
    expect(mig).not.toMatch(/drop table wk_pipeline_columns/i)
  })

  it('archives exactly the eight funnel columns', () => {
    const archive = mig.split('3. archive the funnel columns')[1] ?? ''
    for (const name of [
      'Rendering', 'Ready to send', 'Video sent', 'Opened page',
      'Watched video', 'Clicked button', 'Checkout started', 'Paid',
    ]) {
      expect(archive).toContain(`'${name}'`)
    }
    // ...and none of the human outcomes.
    for (const keep of ['Interested', 'Nurturing', 'No pickup', 'Not interested', 'Booked', 'Voicemail']) {
      expect(archive).not.toContain(`'${keep}'`)
    }
  })

  it('backs up and parks any lead stranded in a funnel column', () => {
    // Hiding a column that still holds leads would make them vanish from the
    // board entirely — worse than the problem being fixed.
    const backupIdx = mig.indexOf('insert into wk_contacts_vsl_column_backup_20260727')
    const nullIdx = mig.indexOf('set pipeline_column_id = null')
    expect(backupIdx).toBeGreaterThan(-1)
    expect(nullIdx).toBeGreaterThan(backupIdx)
    expect(mig).toMatch(/REVERT:/)
  })

  it('the board and every stage picker hide archived columns', () => {
    expect(hydrate).toMatch(/\.eq\('archived', false\)/)
  })
})

describe('the funnel card shows the call outcome', () => {
  it('resolves the lead’s pipeline column and renders it', () => {
    expect(board).toMatch(/const outcomeOf = useCallback/)
    expect(board).toMatch(/Call outcome — \$\{outcome\.name\}/)
    expect(board).toMatch(/\{outcome\.name\}/)
  })
})

describe('every funnel stage stays on screen', () => {
  it('collapses an empty column instead of pushing it off the page', () => {
    // Nine 240px columns is 2,256px in a 1,500px page, so the later stages sat
    // off-screen and read as missing.
    expect(board).toMatch(/const collapsed = count === 0/)
    expect(board).toMatch(/min-w-\[40px\]/)
    expect(board).toMatch(/data-testid=\{`funnel-col-\$\{s\.key\}`\}/)
  })

  it('still renders every stage, in order', () => {
    const lib = read('src/features/crm/lib/funnelStages.ts')
    // Scope to STATES — STAGE_STAMPS uses the same `{ key: …, label: … }` shape.
    const statesBlock = lib.split('export const STATES')[1].split('];')[0]
    const keys = [...statesBlock.matchAll(/\{ key: '([a-z_]+)', label:/g)].map((m) => m[1])
    expect(keys).toEqual([
      'created', 'rendering', 'render_ready', 'sent', 'opened',
      // 'playing' added 2026-07-27: pressing play is movement, and a 26%
      // viewer parked in Opened made the whole board look broken.
      'playing',
      'watched', 'cta_clicked', 'checkout_started', 'paid',
    ])
  })
})

describe('the live badge only claims what it can prove', () => {
  // Hugo 2026-07-27: "lead watched but it didnt move to watch." The lead had
  // opened the page and never pressed play. The board said WATCHING NOW because
  // `prev ? …increase… : true` treated any realtime event on a row it had not
  // seen before as proof of a live viewer.
  it('needs a previous row to compare against', () => {
    expect(board).toMatch(/const watching = !!prev && row\.watched_pct > prev\.watched_pct/)
    expect(board).toMatch(/const onPage = !!prev && row\.open_count > prev\.open_count/)
    expect(board).not.toMatch(/prev \? row\.open_count > prev\.open_count/)
  })

  it('says "on the page" when they have only opened it', () => {
    expect(board).toMatch(/ON THE PAGE NOW, call them!/)
    expect(board).toMatch(/WATCHING NOW, call them!/)
  })

  it('carries no long dash, like every other string we show', () => {
    const badge = board.split("liveNow.get(p.id) === 'watching'")[1]?.slice(0, 200) ?? ''
    expect(badge).not.toContain('—')
  })
})
