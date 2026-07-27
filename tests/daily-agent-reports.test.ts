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
// The privacy migration supersedes the original staff-wide read policy.
const privacySql = read('supabase/migrations/20260724000004_daily_reports_private.sql')
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
    expect(cron).toMatch(/status\(401\)/)
  })

  it('uses the Node (req, res) handler shape, not the edge Request API', () => {
    // The edge signature type-checks but throws `req.headers.get is not a
    // function` at runtime on the Node runtime. Caught in production 2026-07-24.
    expect(cron).not.toMatch(/req\.headers\.get\(/)
    expect(cron).not.toMatch(/new Response\(/)
    expect(cron).toMatch(/res\.status\(200\)\.json/)
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

  it('each agent reads ONLY their own report; admins read all', () => {
    // Hugo 2026-07-24 reversed "both see both": conduct criticism read in front
    // of a colleague gets defended, not acted on.
    expect(privacySql).toMatch(/drop policy if exists wk_agent_daily_reports_staff_read/i)
    expect(privacySql).toMatch(/using \(wk_is_admin\(\) or agent_id = auth\.uid\(\)\)/)
  })

  it('keeps the leaderboard TABLE public — that is where the competition lives', () => {
    // wk_leaderboard is staff-wide on purpose; only the coaching notes are private.
    const rpc = read('supabase/migrations/20260724000002_leaderboard_range.sql')
    expect(rpc).toMatch(/where public\.wk_is_agent_or_admin\(\)/)
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
    // Now takes the See-as focus so the panel follows the selected agent
    // (Hugo 2026-07-27: picking "See as: Marr" still showed Pedro's report).
    expect(page).toMatch(/<DailyReportsPanel/)
  })

  it('shows a day list so agents can go back to any past report', () => {
    const panel = read('src/features/crm/components/DailyReportsPanel.tsx')
    expect(panel).toMatch(/dates\.map/)
    expect(panel).toMatch(/setPicked/)
  })

  it('relies on RLS for privacy rather than a client-side filter', () => {
    // A client-side filter would be security theatre — the rows must not reach
    // the browser in the first place.
    const hook = read('src/features/crm/hooks/useDailyReports.ts')
    expect(hook).not.toMatch(/\.eq\('agent_id'/)
    expect(hook).toMatch(/RLS|enforce/i)
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

describe('conduct flags — the owner must never miss a serious item', () => {
  it('asks for a machine-readable FLAGS block covering the non-negotiables', () => {
    expect(cron).toMatch(/---FLAGS---/)
    expect(cron).toMatch(/swearing\|rudeness\|pressure\|misleading\|wrong_name/)
  })

  it('only emits the block when something actually happened', () => {
    expect(cron).toMatch(/Never emit an empty array/i)
  })

  it('headlines them in the owner email with a link to the call', () => {
    expect(cron).toMatch(/Needs your attention/)
    expect(cron).toMatch(/admin\/crm\/calls\/\$\{esc\(f\.call_id\)\}/)
  })

  it('escapes flag text into the email — quotes come from call audio, not us', () => {
    expect(cron).toMatch(/const esc = /)
    expect(cron).toMatch(/esc\(f\.quote\)/)
  })

  it('still tells the agent — flags index the report, they do not replace it', () => {
    expect(cron).toMatch(/an index for the business owner, not a replacement/i)
  })
})

describe('splitReport — parsing the model output', () => {
  // The cron module builds a Supabase client at import time.
  process.env.SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
  const load = async () => (await import('../api/cron/daily-agent-reports')).splitReport

  it('returns the whole text and no flags on a clean day', async () => {
    const splitReport = await load()
    const r = splitReport('**Today**\nGood day, nothing to flag.')
    expect(r.flags).toEqual([])
    expect(r.body).toContain('Good day')
  })

  it('separates the report from the flags', async () => {
    const splitReport = await load()
    const r = splitReport(
      '**Today**\n224 dials.\n\n---FLAGS---\n' +
        '[{"type":"swearing","quote":"you can just say fuck off","company":"Clayton Plumbing","call_id":"fa11780d","why":"Not acceptable on a customer call."}]',
    )
    expect(r.body).not.toContain('FLAGS')
    expect(r.body).not.toContain('fuck off') // body keeps its own prose copy, not the JSON
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0].type).toBe('swearing')
    expect(r.flags[0].call_id).toBe('fa11780d')
  })

  it('keeps the report when the JSON is malformed — a bad block must not cost us the day', async () => {
    const splitReport = await load()
    const r = splitReport('**Today**\nSolid day.\n\n---FLAGS---\n[{"type":"swearing",')
    expect(r.body).toContain('Solid day')
    expect(r.flags).toEqual([])
  })

  it('ignores a non-array or junk payload', async () => {
    const splitReport = await load()
    expect(splitReport('Report\n---FLAGS---\nnone').flags).toEqual([])
    expect(splitReport('Report\n---FLAGS---\n[]').flags).toEqual([])
  })

  it('drops entries that carry no quote', async () => {
    const splitReport = await load()
    const r = splitReport('Report\n---FLAGS---\n[{"type":"swearing"},{"type":"pressure","quote":"why are you not listening"}]')
    expect(r.flags).toHaveLength(1)
    expect(r.flags[0].quote).toBe('why are you not listening')
  })

  it('tolerates prose around the JSON array', async () => {
    const splitReport = await load()
    const r = splitReport('Report\n---FLAGS---\nHere you go:\n[{"quote":"x","type":"rudeness"}]\nThanks.')
    expect(r.flags).toHaveLength(1)
  })
})

// Hugo 2026-07-27, after the first full transcript audit of a calling day:
//   "please also make sure daily feedback reports all those things as well, on
//    what needs to improve together with what we already tell them."
//
// The report used to grade whatever the model noticed that day. The standing
// coaching (the six script steps) now gets counted in code and graded every
// day, so it cannot quietly drop off because the day went well.

describe('the script check', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const conv = (agent: string[], caller = ['Hello.', 'Yeah go on then.']) => ({
    id: 'c1', started_at: '2026-07-27T10:00:00Z', duration_sec: 90, status: 'completed',
    disposition: null, company: 'Acme Plumbing',
    lines: [
      { speaker: 'caller', body: caller[0] ?? 'Hello.' },
      ...agent.map((b) => ({ speaker: 'agent', body: b })),
      { speaker: 'caller', body: caller[1] ?? 'Ok.' },
    ],
  })

  it('grades against the live script, not a copy pasted into the code', () => {
    expect(cron).toMatch(/from\('wk_call_scripts'\)/)
    expect(cron).toMatch(/THE SCRIPT THEY ARE MEANT TO FOLLOW/)
  })

  it('counts the six steps in code so the model never tallies', () => {
    expect(cron).toMatch(/export function scriptCheck/)
    for (const f of [
      'said_who_they_are', 'said_recording_notice', 'name_before_recording',
      'reached_hook', 'reached_offer', 'used_close',
      'asked_for_their_number', 'read_out_monthly_tiers',
    ]) expect(cron).toContain(f)
  })

  it('catches the opener inverted — recording line first, name never', async () => {
    // Marr, 2026-07-27: said the recording line in 57 of 63 conversations and
    // his own name in 2. That inversion is the single biggest thing costing us
    // conversations, so it has to be its own number.
    const { scriptCheck } = await load()
    const bad = scriptCheck([conv([
      "Hey, just a quick one, is this Dave from Acme Plumbing?",
      "Just so you know this call is being recorded for training purposes.",
    ])] as never)
    expect(bad.said_recording_notice).toBe(1)
    expect(bad.said_who_they_are).toBe(0)
    expect(bad.name_before_recording).toBe(0)

    const good = scriptCheck([conv([
      "Hi, quick one, is that Dave? It's Pedro from HeyElsie.",
      "Just so you know the call's recorded for training.",
    ])] as never)
    expect(good.name_before_recording).toBe(1)
  })

  it('does not credit the opener when the name comes AFTER the recording line', async () => {
    const { scriptCheck } = await load()
    const r = scriptCheck([conv([
      "Just so you know this call is recorded for training.",
      "My name is Pedro and I'm from HeyElsie.",
    ])] as never)
    expect(r.said_who_they_are).toBe(1)
    expect(r.name_before_recording).toBe(0) // said it, but too late to help
  })

  it('flags asking for a number, and does NOT flag promising to send to it', async () => {
    // Hugo 2026-07-27: "we don't need to ask for number because we are already
    // calling the mobile number". Telling them it is on its way is the script;
    // asking them to read it out is the rule break.
    const { scriptCheck } = await load()
    expect(scriptCheck([conv(["Perfect, is this the best number for a text?"])] as never)
      .asked_for_their_number).toBe(1)
    expect(scriptCheck([conv(["I'll get it sent across to this number shortly."])] as never)
      .asked_for_their_number).toBe(0)
  })

  it('flags reading out the monthly tiers', async () => {
    const { scriptCheck } = await load()
    expect(scriptCheck([conv(["It's £99 a month for the basic one."])] as never)
      .read_out_monthly_tiers).toBe(1)
    expect(scriptCheck([conv(["You can start it yourself from there for a quid."])] as never)
      .read_out_monthly_tiers).toBe(0)
  })

  it('grades live conversations only, never voicemail', async () => {
    const { scriptCheck } = await load()
    const vm = {
      id: 'v1', started_at: '2026-07-27T10:00:00Z', duration_sec: 20, status: 'completed',
      disposition: 'Voicemail', company: 'Acme',
      lines: [
        { speaker: 'caller', body: 'Please leave a message after the tone.' },
        { speaker: 'agent', body: 'Hi, just so you know this call is recorded.' },
      ],
    }
    expect(scriptCheck([vm] as never).conversations_graded).toBe(0)
  })
})

describe('dialling pace', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const call = (startIso: string, sec: number) => ({
    id: startIso, started_at: startIso, duration_sec: sec, status: 'completed',
    disposition: null, company: null, lines: [],
  })

  it('measures the gaps between calls, not just the total', async () => {
    // Pedro, 2026-07-27: 49 dials to Marr's 177, and a two-hour hole after
    // 13:05 with 1,185 leads waiting. Volume is half the job and the report
    // was blind to it.
    const { paceStats } = await load()
    const p = paceStats([
      call('2026-07-27T09:00:00Z', 60),
      call('2026-07-27T09:05:00Z', 60),
      call('2026-07-27T11:05:00Z', 60),
    ] as never)
    expect(p.dials).toBe(3)
    expect(p.longest_gap_minutes).toBe(119)
    expect(p.gaps_over_10_min).toBe(1)
    expect(p.minutes_on_calls).toBe(3)
  })

  it('survives a day with no calls at all', async () => {
    const { paceStats } = await load()
    expect((await load()).paceStats([] as never).dials).toBe(0)
  })

  it('tells the model a single long gap is a lunch break, not slacking', () => {
    expect(cron).toMatch(/lunch break and is theirs to take/i)
  })
})

describe('the report always covers the standing coaching', () => {
  it('has a Script check section that runs even on a good day', () => {
    expect(cron).toMatch(/\*\*Script check\*\*/)
    expect(cron).toMatch(/even on a good day/i)
    expect(cron).toMatch(/does not get dropped/i)
  })

  it('reports pace in the opening paragraph, not just call quality', () => {
    expect(cron).toMatch(/A perfect script at 49 dials loses to a rough one at 177/)
  })

  it('praises the steps they hit rather than listing only failures', () => {
    expect(cron).toMatch(/do not only list failures/i)
  })

  it('admits the counts come from imperfect speech recognition', () => {
    // Overstating a derived number to an agent who knows what they said is how
    // a coaching report loses its authority.
    expect(cron).toMatch(/close, not exact/i)
    expect(cron).toMatch(/believe the transcripts/i)
  })
})
