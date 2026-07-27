import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "I am on /admin/crm/leaderboard as admin and I am not able
// to select an agent, I am looking as marr but it shows me pedro static."
//
// The board ignored the "See as" switcher entirely, and the Daily reports panel
// below it showed every agent's report regardless — which is the "pedro static"
// he actually saw.
//
// His choice: KEEP every agent ranked (a one-row leaderboard is not a
// leaderboard), highlight the one being viewed, filter the reports to them.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const pageRaw = read('src/features/crm/pages/LeaderboardPage.tsx')
const page = stripComments(pageRaw)
const panel = stripComments(read('src/features/crm/components/DailyReportsPanel.tsx'))

describe('the leaderboard respects "See as"', () => {
  it('reads the impersonation context at all', () => {
    expect(page).toMatch(/useViewAs\(\)/)
  })

  it('highlights the viewed agent and labels the row', () => {
    expect(page).toMatch(/const isFocus = !!focusId && focusId === r\.agentId/)
    expect(page).toMatch(/viewing/)
  })

  it('still ranks EVERYONE — no filtering of the rows', () => {
    // Hugo's explicit choice. If this ever becomes a filter, it stops being a
    // leaderboard.
    expect(page).not.toMatch(/rows\.filter\(\(r\) => r\.agentId === focusId\)/)
    expect(page).toMatch(/reports\.rows/)
  })

  it('carries its own agent picker so it works without the global switcher', () => {
    expect(page).toMatch(/data-testid="leaderboard-agent-picker"/)
    expect(page).toMatch(/setViewAs\(id \|\| null/)
    expect(page).toMatch(/<option value="">Everyone<\/option>/)
  })

  it('only offers the picker to an admin', () => {
    expect(page).toMatch(/\{isAdmin && \(\s*<select/)
  })
})

describe('the daily reports follow the selection', () => {
  it('filters to the focused agent', () => {
    expect(panel).toMatch(/focusAgentId/)
    expect(panel).toMatch(/!focusAgentId \|\| r\.agentId === focusAgentId/)
  })

  it('says whose reports are being shown', () => {
    expect(panel).toMatch(/only/)
    expect(panel).toMatch(/No report for \$\{focusAgentName/)
  })

  it('defaults to everyone when nothing is selected', () => {
    expect(panel).toMatch(/focusAgentId = null/)
  })

  it('is passed the selection by the page', () => {
    expect(page).toMatch(/<DailyReportsPanel focusAgentId=\{focusId\}/)
  })
})

describe('regressions this page already had', () => {
  it('spans the right number of columns in the funnel view', () => {
    // 11 <th> render in the funnel view (# + Agent + 9 metrics); COLS said 10,
    // so the empty/loading row under-spanned by one.
    const head = pageRaw.split('<thead')[1].split('</thead>')[0]
    const shared = (head.split("{view === 'calls' ?")[0].match(/<th /g) ?? []).length
    const branches = head.split("{view === 'calls' ?")[1]
    const callsCols = (branches.split(') : (')[0].match(/<th /g) ?? []).length
    const funnelCols = (branches.split(') : (')[1].match(/<th /g) ?? []).length

    expect(shared + callsCols).toBe(8)
    expect(shared + funnelCols).toBe(11) // COLS said 10 — the row under-spanned
    expect(page).toMatch(/view === 'funnel' \? 11 : 8/)
  })

  it('keeps the contracts other tests pin', () => {
    expect(page).toMatch(/b\.calls\s*-\s*a\.calls/)
    expect(page).not.toMatch(/import .*from '\.\.\/hooks\/useReports'/)
    expect(page).toMatch(/\['today', 'yesterday', 'week', 'month'\]/)
    expect(page).toMatch(/overflow-x-auto/)
    expect(page).not.toMatch(/colSpan=\{8\}/)
    expect(page).toMatch(/data-testid=\{`leaderboard-view-\$\{v\}`\}/)
  })
})
