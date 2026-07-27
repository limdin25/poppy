import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "add log with timeline of what happened and what is next
// with time counting."
//
// Two halves. The countdown and the sent log are pure, so they get real
// behavioural tests. The drawer that renders them cannot be mounted here (the
// vitest env is node, no jsdom), so it gets a source contract: the one that
// matters is that it IMPORTS the shared schedule instead of writing its own.

// api/lib/vsl-settings opens a supabase client at import time; the mirror test
// below imports it, so give it something to chew on (as message-copy does).
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const load = async () => import('../src/features/crm/lib/followUpTimeline')

const HELPER_PATH = 'src/features/crm/lib/followUpTimeline.ts'
const DRAWER_PATH = 'src/features/crm/components/funnel/FunnelLeadDrawer.tsx'

const NOW = Date.parse('2026-07-27T12:00:00Z')
const inMs = (ms: number) => new Date(NOW + ms).toISOString()

describe('countdownLabel', () => {
  it('says "any minute now" for anything due, or overdue', async () => {
    const { countdownLabel } = await load()
    // The cron wakes every five minutes, so a due message goes out on its next
    // pass. A countdown ticking into negative numbers would just be lying.
    expect(countdownLabel(inMs(-2 * 60 * 60_000), NOW)).toBe('any minute now')
    expect(countdownLabel(inMs(0), NOW)).toBe('any minute now')
    expect(countdownLabel(inMs(45_000), NOW)).toBe('any minute now')
  })

  it('counts minutes under the hour', async () => {
    const { countdownLabel } = await load()
    expect(countdownLabel(inMs(12 * 60_000), NOW)).toBe('in 12m')
    expect(countdownLabel(inMs(59 * 60_000), NOW)).toBe('in 59m')
  })

  it('counts hours and minutes under the day', async () => {
    const { countdownLabel } = await load()
    expect(countdownLabel(inMs(72 * 60_000), NOW)).toBe('in 1h 12m')
    expect(countdownLabel(inMs(2 * 3_600_000), NOW)).toBe('in 2h')
    expect(countdownLabel(inMs(23 * 3_600_000), NOW)).toBe('in 23h')
  })

  it('counts whole days past that', async () => {
    const { countdownLabel } = await load()
    expect(countdownLabel(inMs(24 * 3_600_000), NOW)).toBe('in 1 day')
    expect(countdownLabel(inMs(72 * 3_600_000), NOW)).toBe('in 3 days')
    expect(countdownLabel(inMs(7 * 24 * 3_600_000), NOW)).toBe('in 7 days')
    // Rounded, not floored: the schedule is written in whole days, and floor
    // turns a 71h59m wait into "in 2 days", a different plan from the one Hugo
    // signed off.
    expect(countdownLabel(inMs(72 * 3_600_000 - 60_000), NOW)).toBe('in 3 days')
  })

  it('renders nothing rather than the word Invalid', async () => {
    const { countdownLabel } = await load()
    expect(countdownLabel(null, NOW)).toBe('')
    expect(countdownLabel(undefined, NOW)).toBe('')
    expect(countdownLabel('', NOW)).toBe('')
    expect(countdownLabel('not a date', NOW)).toBe('')
  })

  it('takes a Date or a plain number, not only an ISO string', async () => {
    const { countdownLabel } = await load()
    expect(countdownLabel(new Date(NOW + 3_600_000), NOW)).toBe('in 1h')
    expect(countdownLabel(NOW + 3_600_000, NOW)).toBe('in 1h')
  })

  it('never emits a long dash', async () => {
    const { countdownLabel } = await load()
    const offsets = [-1, 0, 30_000, 5 * 60_000, 90 * 60_000, 30 * 3_600_000, 400 * 3_600_000]
    for (const o of offsets) {
      expect(countdownLabel(inMs(o), NOW)).not.toMatch(/[–—]/)
    }
  })
})

describe('londonStamp', () => {
  it('is Europe/London, so BST is not shown an hour early', async () => {
    const { londonStamp } = await load()
    const summer = londonStamp('2026-07-27T12:00:00Z')
    expect(summer).toMatch(/13:00:00/)
    expect(summer).toMatch(/London/)
    // And back to UTC in the winter.
    expect(londonStamp('2026-01-15T12:00:00Z')).toMatch(/12:00:00/)
  })

  it('carries the year, which the visible stamps in the drawer drop', async () => {
    const { londonStamp } = await load()
    expect(londonStamp('2026-07-27T12:00:00Z')).toMatch(/2026/)
  })

  it('is empty for a missing or unparseable time', async () => {
    const { londonStamp } = await load()
    expect(londonStamp(null)).toBe('')
    expect(londonStamp('nope')).toBe('')
  })
})

describe('ruleLabel', () => {
  it('takes the wording from the sequence itself, so a rename cannot drift', async () => {
    const { ruleLabel } = await load()
    const { VSL_SEQUENCE } = await import('../api/lib/vsl-sequence')
    for (const def of VSL_SEQUENCE) {
      expect(ruleLabel(def.key)).toBe(def.label)
    }
  })

  it('still reads the five rules that ran before the sequence replaced them', async () => {
    // They are gone from VSL_SEQUENCE but written into the automation blob of
    // every lead we followed up before 2026-07-27.
    const { ruleLabel } = await load()
    expect(ruleLabel('sent_not_opened')).toBe('Sent, not opened')
    expect(ruleLabel('watched_no_click')).toBe('Watched, no click')
  })

  it('prettifies a key it has never seen rather than showing snake_case', async () => {
    const { ruleLabel } = await load()
    expect(ruleLabel('some_rule_from_next_year')).toBe('Some rule from next year')
    expect(ruleLabel('')).toBe('Follow-up')
  })
})

describe('insideQuietHoursLondon', () => {
  const quiet = { start: '08:00', end: '20:00' }

  it('is London time, not the clock on the viewer machine', async () => {
    // 03:00 UTC is 04:00 BST in July, which is not a time we text people.
    const { insideQuietHoursLondon } = await load()
    expect(insideQuietHoursLondon(quiet, Date.parse('2026-07-27T03:00:00Z'))).toBe(false)
    expect(insideQuietHoursLondon(quiet, Date.parse('2026-07-27T12:00:00Z'))).toBe(true)
    // 19:30 UTC is 20:30 BST, past the window, even though UTC says otherwise.
    expect(insideQuietHoursLondon(quiet, Date.parse('2026-07-27T19:30:00Z'))).toBe(false)
  })

  it('matches api/lib/vsl-settings, which it deliberately mirrors', async () => {
    // That module cannot be imported into the browser (it opens a service-role
    // supabase client at import time), so the copy is checked against the
    // original here instead of trusted.
    const { insideQuietHoursLondon } = await load()
    const { insideQuietHours } = await import('../api/lib/vsl-settings')
    const settings = { quiet_hours: quiet } as never
    for (const h of [0, 6, 7, 8, 9, 13, 19, 20, 21, 23]) {
      const at = new Date(Date.parse(`2026-07-27T00:00:00Z`) + h * 3_600_000)
      expect(insideQuietHoursLondon(quiet, at)).toBe(insideQuietHours(settings, at))
    }
  })
})

describe('buildSentLog', () => {
  const ev = (rule: string, at: string, nudge?: number) => ({
    type: 'auto_sms',
    created_at: at,
    meta: nudge === undefined ? { rule } : { rule, nudge },
  })

  it('is oldest first, so the newest message reads last', async () => {
    const { buildSentLog } = await load()
    // The drawer loads events newest first; the log must not inherit that.
    const log = buildSentLog({}, [
      ev('sent_not_opened', '2026-07-26T10:00:00Z'),
      ev('sent_not_opened', '2026-07-25T10:00:00Z'),
    ])
    expect(log.map((l) => l.at)).toEqual([
      '2026-07-25T10:00:00Z',
      '2026-07-26T10:00:00Z',
    ])
  })

  it('numbers repeats of the same rule', async () => {
    const { buildSentLog } = await load()
    const log = buildSentLog({}, [
      ev('sent_not_opened', '2026-07-25T10:00:00Z'),
      ev('sent_not_opened', '2026-07-26T10:00:00Z'),
    ])
    expect(log.map((l) => l.nudge)).toEqual([1, 2])
    expect(log.every((l) => l.exact)).toBe(true)
  })

  it('trusts the nudge number the cron recorded over its own counting', async () => {
    const { buildSentLog } = await load()
    const log = buildSentLog({}, [ev('sent_not_opened', '2026-07-26T10:00:00Z', 3)])
    expect(log[0].nudge).toBe(3)
  })

  it('ignores every event that is not an automatic message', async () => {
    const { buildSentLog } = await load()
    const log = buildSentLog({}, [
      { type: 'open', created_at: '2026-07-25T10:00:00Z', meta: null },
      { type: 'progress', created_at: '2026-07-25T10:01:00Z', meta: null },
      ev('sent_not_opened', '2026-07-26T10:00:00Z'),
    ])
    expect(log).toHaveLength(1)
    expect(log[0].key).toBe('sent_not_opened')
  })

  it('falls back to the page counters when the event row is missing', async () => {
    // The counters remember only the LAST send per rule, so the entry is
    // flagged inexact rather than passed off as the real moment.
    const { buildSentLog } = await load()
    const log = buildSentLog(
      { watched_no_click: { count: 2, last_at: '2026-07-26T09:00:00Z' } },
      [],
    )
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      key: 'watched_no_click',
      label: 'Watched, no click',
      at: '2026-07-26T09:00:00Z',
      nudge: 2,
      exact: false,
    })
  })

  it('does not double count when the events already tell the story', async () => {
    const { buildSentLog } = await load()
    const log = buildSentLog(
      { sent_not_opened: { count: 1, last_at: '2026-07-26T10:00:00Z' } },
      [ev('sent_not_opened', '2026-07-26T10:00:00Z')],
    )
    expect(log).toHaveLength(1)
    expect(log[0].exact).toBe(true)
  })

  it('survives a null automation blob and a null event list', async () => {
    const { buildSentLog } = await load()
    expect(buildSentLog(null, null)).toEqual([])
  })
})

describe('the helper holds no schedule of its own', () => {
  const helper = stripComments(read(HELPER_PATH))

  it('has no delays, caps or repeat gaps in it', async () => {
    // A second copy of the schedule WILL drift from api/lib/vsl-sequence.ts,
    // and then the board promises a text the cron never sends.
    expect(helper).not.toMatch(/delay_minutes|repeat_hours|max_sends/)
  })

  it('stays pure, so these tests are real rather than greps', () => {
    expect(helper).not.toMatch(/from 'react'|@\/integrations\/supabase/)
  })

  it('obeys the no-long-dash rule', () => {
    expect(read(HELPER_PATH)).not.toMatch(/[–—]/)
  })
})

describe('the Follow-ups panel in the drawer', () => {
  const drawerRaw = read(DRAWER_PATH)
  const drawer = stripComments(drawerRaw)

  it('imports the shared schedule instead of declaring its own delays', () => {
    expect(drawer).toMatch(/import \{ nextSequenceStep[^}]*\} from '[^']*api\/lib\/vsl-sequence'/)
    expect(drawer).toMatch(/nextSequenceStep\(/)
    // The delays, the caps and the rule keys all live on the other side of that
    // import. If any of these come back, there are two schedules again.
    expect(drawer).not.toMatch(/delay_minutes|repeat_hours|max_sends/)
    expect(drawer).not.toMatch(/sent_not_opened|opened_not_watched|checkout_abandoned/)
  })

  it('renders the log of what already went out', () => {
    expect(drawer).toMatch(/data-testid="funnel-followups"/)
    expect(drawer).toMatch(/data-testid="funnel-followup-log"/)
    expect(drawer).toMatch(/buildSentLog\(page\.automation, events\)/)
    // Newest last is the helper's job; the drawer must not re-sort it.
    expect(drawer).not.toMatch(/log\.reverse\(\)/)
  })

  it('renders what is next, with a live countdown and the exact time', () => {
    expect(drawer).toMatch(/data-testid="funnel-followup-next"/)
    expect(drawer).toMatch(/data-testid="funnel-followup-countdown"/)
    expect(drawer).toMatch(/countdownLabel\(step\.at, now\)/)
    expect(drawer).toMatch(/title=\{londonStamp\(step\.at\)\}/)
    // A step that is already due is "any minute now", not a countdown to a
    // moment that has passed.
    expect(drawer).toMatch(/verdict\?\.due \? 'any minute now'/)
  })

  it('gives the honest reason, in the sequence own words', () => {
    // cooldown / quiet_hours / replied / paid / capped all come back as one
    // printable sentence. Rewriting them here would be a second copy of the
    // rules by the back door.
    expect(drawer).toMatch(/verdict\.detail/)
    expect(drawer).toMatch(/verdict\?\.reason === 'replied'/)
    expect(drawer).toMatch(/They replied on \{formatDateTime\(repliedAt\)\}/)
    expect(drawer).toMatch(/only visible to admins/)
  })

  it('hands the sequence the context it cannot read for itself', () => {
    // The schedule is pure: it cannot see the inbox, the master switch, the
    // agent opt-out or the clock in London.
    expect(drawer).toMatch(/lastInboundAt: repliedAt/)
    expect(drawer).toMatch(/enabled: settings\.enabled/)
    expect(drawer).toMatch(/agentDisabled: settings\.agent_disabled\.includes/)
    expect(drawer).toMatch(/insideQuietHours: insideQuietHoursLondon\(settings\.quiet_hours, now\)/)
    // And it passes the row itself, rather than reshaping it on the way in.
    expect(drawer).toMatch(/nextSequenceStep\(page, \{/)
  })

  it('ticks on ONE interval, cleaned up on unmount, without refetching', () => {
    const ticks = drawer.match(/setInterval\(/g) ?? []
    expect(ticks).toHaveLength(1)
    expect(drawer).toMatch(/return \(\) => clearInterval\(tick\)/)
    // The countdown must not drag the board's queries along with it.
    const effect = drawer.split('const tick = setInterval')[1]?.split('}, []);')[0] ?? ''
    expect(effect).not.toMatch(/supabase|fetch\(/)
  })

  it('stamps absolute times in London, exact in the title attribute', () => {
    expect(drawer).toMatch(/londonStamp\(s\.at\)/)
    expect(drawer).toMatch(/formatDateTime\(s\.at\)/)
  })

  it('does not tell the lead we watched them, anywhere in this panel', () => {
    // The panel is internal, but the wording still gets copied into messages.
    expect(drawer).not.toMatch(/saw you watched|noticed you opened/i)
  })
})
