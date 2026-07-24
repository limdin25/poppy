import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-24: "every day from today at 5:30pm it gives the daily reports,
// they write there on the leaderboard so they can read, and there's a history
// they can always go back and see. Also email me the report."
// Plus: "not telling off, but you should say everything that should be improved
// — and if someone says fuck off etc, I should be told as well."

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const cron = read('api/cron/daily-agent-reports.ts')
const sql = read('supabase/migrations/20260724000003_agent_daily_reports.sql')
const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }

describe('daily agent reports — schedule', () => {
  it('is registered as a Vercel cron', () => {
    const entry = vercel.crons.find((c) => c.path === '/api/cron/daily-agent-reports')
    expect(entry).toBeDefined()
  })

  it('fires at 17:30 UK (16:30 UTC during BST)', () => {
    const entry = vercel.crons.find((c) => c.path === '/api/cron/daily-agent-reports')!
    expect(entry.schedule).toBe('30 16 * * *')
  })

  it('is protected by CRON_SECRET', () => {
    expect(cron).toMatch(/Bearer \$\{process\.env\.CRON_SECRET\}/)
    expect(cron).toMatch(/status: 401/)
  })

  it('runs on Node with room for two Claude calls, not the edge budget', () => {
    expect(cron).toMatch(/maxDuration/)
    expect(cron).not.toMatch(/runtime:\s*'edge'/)
  })
})

describe('report content — candid, and never buries the bad bits', () => {
  it('instructs the model to report swearing verbatim with the call reference', () => {
    expect(cron).toMatch(/Swearing or crude language/i)
    expect(cron).toMatch(/Quote it verbatim/i)
    expect(cron).toMatch(/call_id/)
  })

  it('forbids omitting a problem because the day went well', () => {
    expect(cron).toMatch(/Never leave one of these out/i)
  })

  it('also flags rudeness, pressure and misleading claims about price', () => {
    expect(cron).toMatch(/Rudeness|arguing|talking over/i)
    expect(cron).toMatch(/misleading about price/i)
  })

  it('is coaching, not a telling-off', () => {
    expect(cron).toMatch(/not a disciplinarian/i)
  })

  it('tells the agent dead-air calls were a system fault, not their doing', () => {
    expect(cron).toMatch(/KNOWN SYSTEM FAULT/)
    expect(cron).toMatch(/not counted against them/i)
  })

  it('forbids inventing quotes and recomputing the stats', () => {
    expect(cron).toMatch(/Never invent a quote/i)
    expect(cron).toMatch(/never recompute/i)
  })
})

describe('report accuracy — stats are computed in code, not by the model', () => {
  it('counts dials, conversations and outcomes deterministically', () => {
    expect(cron).toMatch(/function computeStats/)
    for (const field of ['dials', 'conversations', 'real_conversations', 'dead_air', 'interested', 'talk_ratio']) {
      expect(cron).toContain(field)
    }
  })

  it('passes the computed stats to the model as authoritative', () => {
    expect(cron).toMatch(/STATISTICS \(authoritative/)
  })

  it('excludes voicemail from the transcripts it sends', () => {
    expect(cron).toMatch(/voicemails carry no coaching signal|voicemails excluded/i)
  })

  it('caps transcript volume so one heavy day cannot blow up the bill', () => {
    expect(cron).toMatch(/MAX_CONVERSATIONS/)
    expect(cron).toMatch(/MAX_CHARS_PER_CONVERSATION/)
  })
})

describe('storage and visibility', () => {
  it('keeps one report per agent per day (re-runs overwrite, not duplicate)', () => {
    expect(sql).toMatch(/unique \(agent_id, report_date\)/)
    expect(cron).toMatch(/onConflict: 'agent_id,report_date'/)
  })

  it('lets every CRM agent read every report — the competition is the point', () => {
    expect(sql).toMatch(/for select\s*\n\s*using \(wk_is_agent_or_admin\(\)\)/)
  })

  it('is staff-only — reviews clients and owners must never read it', () => {
    expect(sql).toMatch(/wk_is_agent_or_admin\(\)/)
    expect(sql).not.toMatch(/using \(true\)/)
  })

  it('is written only by the cron, never by an agent', () => {
    expect(sql).toMatch(/for all\s*\n\s*using \(wk_is_admin\(\)\)/)
  })
})

describe('the leaderboard surfaces them with history', () => {
  it('renders the reports panel on the leaderboard page', () => {
    const page = read('src/features/crm/pages/LeaderboardPage.tsx')
    expect(page).toMatch(/<DailyReportsPanel \/>/)
  })

  it('shows a day list so agents can go back to any past report', () => {
    const panel = read('src/features/crm/components/DailyReportsPanel.tsx')
    expect(panel).toMatch(/dates\.map/)
    expect(panel).toMatch(/setPicked/)
  })

  it('does not filter to the signed-in agent — both agents see both', () => {
    const hook = read('src/features/crm/hooks/useDailyReports.ts')
    expect(hook).not.toMatch(/\.eq\('agent_id'/)
  })
})

describe('email to Hugo', () => {
  it('emails the day\'s reports', () => {
    expect(cron).toMatch(/sendEmail\(/)
    expect(cron).toMatch(/Daily agent reports/)
  })

  it('sends to a configurable address with Hugo as the fallback', () => {
    expect(cron).toMatch(/DAILY_REPORT_EMAIL/)
  })

  it('does not fail the run when the email fails', () => {
    const emailBlock = cron.split('Email Hugo the lot')[1] ?? ''
    expect(emailBlock).toMatch(/catch/)
  })
})
