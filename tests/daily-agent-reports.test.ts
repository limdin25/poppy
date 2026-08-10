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
    // a coaching report loses its authority. This used to assert the softer
    // "close, not exact"; on 2026-08-10 that turned out not to be strong
    // enough, because the report went on to publish "you never once asked" off
    // a counter that matched one phrasing in five. The wording is now "a floor,
    // not a fact" plus an outright ban on absolutes, asserted below.
    expect(cron).toMatch(/a floor, not a fact/i)
    expect(cron).toMatch(/the transcripts win/i)
  })
})

// Hugo 2026-07-27: "we need videos sent on the grade as well" / "and
// conversations". Dials and script steps are process. A video landing on a
// plumber's phone is the only thing that pays, so it is the score.

describe('the grade: videos sent', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const SINCE = '2026-07-27T00:00:00.000Z'
  const UNTIL = '2026-07-28T00:00:00.000Z'
  const page = (p: Partial<Record<string, string | null>> = {}) => ({
    created_at: '2026-07-27T11:00:00.000Z', sent_at: null, render_status: 'ready',
    first_opened_at: null, watched_at: null, ...p,
  })

  it('counts videos made and videos sent separately', async () => {
    const { videoStats } = await load()
    const v = videoStats([
      page({ sent_at: '2026-07-27T11:05:00.000Z' }),
      page(),
    ] as never, SINCE, UNTIL)
    expect(v.videos_made).toBe(2)
    expect(v.videos_sent).toBe(1)
    expect(v.videos_ready_not_sent).toBe(1) // built, sitting there, theirs to fix
  })

  it('counts a video SENT today off a page made yesterday', async () => {
    // The agent did the sending work today; the grade has to see it.
    const { videoStats } = await load()
    const v = videoStats([
      page({ created_at: '2026-07-26T15:00:00.000Z', sent_at: '2026-07-27T09:30:00.000Z' }),
    ] as never, SINCE, UNTIL)
    expect(v.videos_made).toBe(0)
    expect(v.videos_sent).toBe(1)
  })

  it('does not blame the agent for a render that failed or is still going', async () => {
    const { videoStats } = await load()
    const v = videoStats([
      page({ render_status: 'failed' }),
      page({ render_status: 'rendering' }),
    ] as never, SINCE, UNTIL)
    expect(v.videos_render_failed).toBe(1)
    expect(v.videos_still_rendering).toBe(1)
    expect(v.videos_ready_not_sent).toBe(0) // neither is the agent's fault
    expect(cron).toMatch(/OUR system, not the agent/i)
    expect(cron).toMatch(/Never criticise them for those/i)
  })

  it('only counts engagement on videos actually sent that day', async () => {
    const { videoStats } = await load()
    const v = videoStats([
      page({ sent_at: '2026-07-27T11:05:00.000Z', first_opened_at: '2026-07-27T12:00:00.000Z', watched_at: '2026-07-27T12:01:00.000Z' }),
      page({ first_opened_at: '2026-07-27T12:00:00.000Z' }), // never sent, cannot have been opened
    ] as never, SINCE, UNTIL)
    expect(v.videos_opened).toBe(1)
    expect(v.videos_watched).toBe(1)
  })

  it('makes videos sent the headline of the grade, not a footnote', () => {
    expect(cron).toMatch(/\*\*The grade\*\*/)
    expect(cron).toMatch(/Videos sent is the score that matters/i)
    // A tidy-sounding day with nothing sent must not read as a good day.
    expect(cron).toMatch(/perfect calls with no videos sent is not a good day/i)
  })

  it('states the funnel as dials to conversations to offers to videos', () => {
    expect(cron).toMatch(/dials -> conversations -> offers/)
    expect(cron).toMatch(/videos made -> videos sent/)
  })

  it('leads Hugo\'s email with videos sent over conversations and dials', () => {
    expect(cron).toMatch(/videos_sent\}<\/strong> videos sent/)
    expect(cron).toMatch(/from \$\{r\.stats\.conversations\} conversations and \$\{r\.stats\.dials\} dials/)
  })

  it('fetches pages by created_at OR sent_at, not just one', () => {
    expect(cron).toMatch(/and\(created_at\.gte/)
    expect(cron).toMatch(/and\(sent_at\.gte/)
  })
})

// Hugo 2026-08-10: "the Google business is dead ... now we are selling, we are
// making offers on properties. That's what we are doing now."
//
// Pedro Houses' first real property day (60 calls to estate agents) was graded
// by this cron against the HeyElsie reviews script and scored zero, with the
// report telling him he "did not run the HeyElsie script", the script of a
// business he is not in. A day with property_call-stamped calls now grades
// against the property script.

describe('property days are graded against the property business', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const pconv = (agent: string[], caller: string[] = ['Hello, sales.'], scriptKey: string | null = 'property_call') => ({
    id: 'p1', started_at: '2026-08-10T13:00:00Z', duration_sec: 120, status: 'completed',
    disposition: null, company: 'Reeds Rains', script_key: scriptKey,
    lines: [
      { speaker: 'caller', body: caller[0] ?? 'Hello.' },
      ...agent.map((b) => ({ speaker: 'agent', body: b })),
      ...caller.slice(1).map((b) => ({ speaker: 'caller', body: b })),
    ],
  })

  it('one stamped call marks the whole day as property', async () => {
    // 15 of Pedro's 60 first-day calls carried NULL script_key because he had
    // been dropped in the wrong room, the day is still a property day.
    const { isPropertyDay } = await load()
    expect(isPropertyDay([pconv(['x'], ['y'], null), pconv(['x'])] as never)).toBe(true)
    expect(isPropertyDay([pconv(['x'], ['y'], null)] as never)).toBe(false)
    expect(isPropertyDay([] as never)).toBe(false)
  })

  it('the handler branches BEFORE the sales grading, and has its own system prompt', () => {
    expect(cron).toMatch(/if \(isPropertyDay\(rows\)\)/)
    expect(cron).toMatch(/PROPERTY_SYSTEM/)
    expect(cron).toMatch(/property deal-sourcing caller/i)
  })

  it('credits the intro even through mangled ASR ("Ugo at Unio")', async () => {
    // The transcriber writes "I work with our director Ugo at Unio", and that IS
    // the correct intro, said correctly, transcribed badly.
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'I work with our director Ugo at Unio, we buy in the area, cash.',
    ])] as never)
    expect(r.said_who_we_are).toBe(1)
    expect(r.said_cash).toBe(1)
  })

  it('counts the availability opener and the checklist families', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'Hi, I\'m calling about the three bed on Mill Lane, is that one still available?',
      'Is it vacant or is there a tenant in?',
      'What sort of condition is it in, does it need work?',
      'Has it had much interest, any offers so far?',
      'Do you know why they\'re selling?',
      'How long\'s it been on with you, has the price come down at all?',
      'Is it freehold or leasehold?',
    ])] as never)
    expect(r.asked_availability).toBe(1)
    expect(r.asked_occupancy).toBe(1)
    expect(r.asked_condition).toBe(1)
    expect(r.asked_interest).toBe(1)
    expect(r.asked_why_selling).toBe(1)
    expect(r.asked_time_on_market).toBe(1)
    expect(r.asked_tenure).toBe(1)
  })

  it('the offer without offering counts as a float, not a formal offer', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'If we were to offer around £62,000, am I in the ballpark or am I a million miles off?',
    ])] as never)
    expect(r.floated_a_figure).toBe(1)
    expect(r.made_formal_offer).toBe(0)
  })

  it('a figure only scores when the BRANCH says one, after the money is opened', async () => {
    const { propertyScriptCheck } = await load()
    // Branch names a number after the float: the score.
    const scored = propertyScriptCheck([pconv(
      ['If we were to offer around £62,000, am I in the ballpark?'],
      ['Hello.', 'They\'d want closer to 70 grand, honestly.'],
    )] as never)
    expect(scored.lead_named_figure).toBe(1)
    // "It's on at £150,000" in the availability chat is not a figure obtained.
    const notScored = propertyScriptCheck([pconv(
      ['Is that one still available?'],
      ['It\'s on at £150,000 and yes it\'s available.'],
    )] as never)
    expect(notScored.lead_named_figure).toBe(0)
  })

  it('asking THEM for a figure is its own count', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'So what sort of figure do you think would actually get it done?',
    ])] as never)
    expect(r.asked_them_for_a_figure).toBe(1)
  })

  it('the script\'s own deflection lines are NOT rule breaks', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'Of course. Nothing I\'ve said today is a formal offer, I\'m just trying to find out if we\'re in the right area.',
      'Let me check Hugo\'s diary and come back to you, he\'d want to be there. What have you got free later in the week?',
    ])] as never)
    expect(r.made_formal_offer).toBe(0)
    expect(r.booked_a_viewing).toBe(0)
  })

  it('a real formal offer and a real booking ARE rule breaks', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([pconv([
      'We\'re offering sixty two thousand and that\'s our formal offer.',
      'Shall I book a viewing for Thursday at two?',
    ])] as never)
    expect(r.made_formal_offer).toBe(1)
    expect(r.booked_a_viewing).toBe(1)
  })

  it('sourcer and course talk is flagged, agents hang up on course graduates', async () => {
    const { propertyScriptCheck } = await load()
    expect(propertyScriptCheck([pconv(['We\'re deal sourcers, I\'ve just done a course on this.'])] as never)
      .sourcer_or_course_talk).toBe(1)
    expect(propertyScriptCheck([pconv(['Of course, I\'ll do that.'])] as never)
      .sourcer_or_course_talk).toBe(0)
  })

  it('grades live conversations only, never voicemail', async () => {
    const { propertyScriptCheck } = await load()
    const vm = {
      id: 'v1', started_at: '2026-08-10T10:00:00Z', duration_sec: 20, status: 'completed',
      disposition: 'Voicemail', company: 'Hunters', script_key: 'property_call',
      lines: [
        { speaker: 'caller', body: 'Please leave a message after the tone.' },
        { speaker: 'agent', body: 'Hi, calling about the house on Mill Lane.' },
      ],
    }
    expect(propertyScriptCheck([vm] as never).conversations_graded).toBe(0)
  })

  it('counts the outcome buttons by name, the property pipeline has its own', async () => {
    const { dispositionCounts } = await load()
    const m = dispositionCounts([
      { ...pconv(['x']), disposition: 'Interested' },
      { ...pconv(['x']), disposition: 'Interested' },
      { ...pconv(['x']), disposition: null },
    ] as never)
    expect(m['interested']).toBe(2)
    expect(m['none pressed']).toBe(1)
  })

  it('reads the property script live (DB copy first, bundled file as fallback)', () => {
    expect(cron).toMatch(/from\('wk_property_call_script'\)/)
    expect(cron).toMatch(/property-call-script\.html/)
    // And the deploy ships the fallback file with the function.
    const fns = (JSON.parse(read('vercel.json')) as {
      functions: Record<string, { includeFiles?: string }>
    }).functions
    expect(fns['api/cron/daily-agent-reports.ts']?.includeFiles)
      .toBe('src/core/content/property-call-script.html')
  })

  it('htmlToText keeps the words and drops the markup', async () => {
    const { htmlToText } = await load()
    const t = htmlToText('<style>.x{}</style><h2>The money</h2><p>Say <b>one</b> number &amp; stop.</p><!-- note -->')
    expect(t).toContain('## The money')
    expect(t).toContain('Say one number & stop.')
    expect(t).not.toContain('<')
  })

  it('tells the model the ASR mangles proper nouns and never to coach off them', () => {
    expect(cron).toMatch(/MANGLES PROPER NOUNS/i)
    expect(cron).toMatch(/never coach anyone off a mangled name/i)
  })

  it('the property grade is figures out of branches, and the Houses tab must be used', () => {
    expect(cron).toMatch(/figure out of the branch'?s mouth is the score/i)
    expect(cron).toMatch(/houses_outcomes_logged/)
    expect(cron).toMatch(/figures out of branches/) // the email headline
  })

  it('property rule breaks are the property ones, not the sales ones', () => {
    expect(cron).toMatch(/formal_offer\|booked_viewing\|invented_fact\|said_ceiling/)
  })
})

// The counters lied, and a coaching report that tells a man he did not do
// something he did is worse than no report. Every string below is copied
// verbatim out of Pedro's 2026-08-10 transcripts, ASR mangling included.

describe('the counters that got it wrong on day one', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const conv = (agentLines: string[], callerLines: string[] = ['Hello, sales.']) => ({
    id: 'p1', started_at: '2026-08-10T13:00:00Z', duration_sec: 300, status: 'completed',
    disposition: null, company: 'A Branch', script_key: 'property_call',
    lines: [
      { speaker: 'caller', body: callerLines[0] ?? 'Hello.' },
      ...agentLines.map((b) => ({ speaker: 'agent', body: b })),
      ...callerLines.slice(1).map((b) => ({ speaker: 'caller', body: b })),
    ],
  })

  it('counts the float phrasings it used to miss (reported 4, he did 9)', async () => {
    const { propertyScriptCheck } = await load()
    for (const said of [
      'if we were to offer around uh 56,500 pounds',                 // it did catch this one
      'we offer if we offer around 88,000 pounds',                   // and missed this
      'if we offer around 107 and 500,000',                          // and this
      "I don't want to waste your time or embarrass anyone with a silly offer",
    ]) {
      const r = propertyScriptCheck([conv([said])] as never)
      expect(`${said} => ${r.floated_a_figure}`).toBe(`${said} => 1`)
    }
  })

  it('STOPS counting a checklist question as a floated offer', async () => {
    // The false positive that also poisoned lead_named_figure: a fabricated
    // float plus any price the branch said next invented a figure obtained.
    const { propertyScriptCheck } = await load()
    for (const said of [
      "It's on at £150,000 I see, has it had any offers so far?",
      'Have you had any offers near the £185,000 asking?',
    ]) {
      const r = propertyScriptCheck([conv([said])] as never)
      expect(`${said} => ${r.floated_a_figure}`).toBe(`${said} => 0`)
    }
  })

  it('counts the ways of asking THEM for a figure it used to miss', async () => {
    const { propertyScriptCheck } = await load()
    for (const said of [
      'So what sort of figure do you think would actually get it done?',   // the scripted line
      'What figure do you think would get it done?',                      // noun in the middle: missed before
      'What are they looking for?',
      'What would the vendor actually take, do you think?',
      "What's the lowest they would go?",
      'Is there a number that would get it done today?',
      'Any movement on the price at all?',
    ]) {
      const r = propertyScriptCheck([conv([said])] as never)
      expect(`${said} => ${r.asked_them_for_a_figure}`).toBe(`${said} => 1`)
    }
  })

  it('counts the callbacks it reported as zero (he agreed at least five)', async () => {
    const { propertyScriptCheck } = await load()
    for (const said of [
      'can I give you a ring back uh around 4:30. How fast for today or perhaps tomorrow morning?',
      'Can I get back to you late uh tomorrow morning would that be ok?',
      'Can can I phone you back uh later today? Would that be ok uh in about an hour?',
      'can I follow up in about a week, would that be okay?',
      'can I phone back uh tomorrow instead?',
    ]) {
      const r = propertyScriptCheck([conv([said])] as never)
      expect(`${said} => ${r.agreed_callback_time}`).toBe(`${said} => 1`)
    }
  })

  it('counts the new remote-model moves: the video ask and subject to a builder', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([conv([
      'we put the figure forward subject to our builder going round',
      'Any chance you could send me a video walkthrough?',
    ])] as never)
    expect(r.offered_subject_to_builder).toBe(1)
    expect(r.asked_for_video_tour).toBe(1)
  })
})

describe('how far into the call the money lands', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  // The finding of the whole day and nothing measured it. Reading the
  // transcripts by hand put the median at 87%: the figure went in with a tenth
  // of the call left, so the answer was always no.
  const call = (agentLines: string[]) => ({
    id: 'x', started_at: '2026-08-10T13:00:00Z', duration_sec: 300, status: 'completed',
    disposition: null, company: 'A Branch', script_key: 'property_call',
    lines: [{ speaker: 'caller', body: 'Hello, sales.' }, ...agentLines.map((b) => ({ speaker: 'agent', body: b }))],
  })
  const FILLER = 'And what condition is it in?'
  const MONEY = 'if we were to offer around £62,000, am I in the ballpark?'

  it('reports late money as late', async () => {
    const { moneyTiming } = await load()
    // Money on the last of ten turns.
    const t = moneyTiming([call([...Array(9).fill(FILLER), MONEY])] as never)
    expect(t.reached_money_in).toBe(1)
    expect(t.pct_of_call_before_money).toBe(100)
  })

  it('reports early money as early', async () => {
    const { moneyTiming } = await load()
    const t = moneyTiming([call([FILLER, MONEY, ...Array(8).fill(FILLER)])] as never)
    expect(t.pct_of_call_before_money).toBeLessThan(20)
  })

  it('takes the median so one long call cannot move it', async () => {
    const { moneyTiming } = await load()
    const early = call([MONEY, ...Array(9).fill(FILLER)])
    const late = call([...Array(9).fill(FILLER), MONEY])
    const t = moneyTiming([early, early, late] as never)
    expect(t.pct_of_call_before_money).toBe(0)
  })

  it('says nothing rather than guessing when the money never came up', async () => {
    const { moneyTiming } = await load()
    const t = moneyTiming([call([FILLER, FILLER, FILLER])] as never)
    expect(t.reached_money_in).toBe(0)
    expect(t.pct_of_call_before_money).toBeNull()
  })
})

describe('the second gear after a no', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const call = (lines: Array<[string, string]>) => ({
    id: 'x', started_at: '2026-08-10T13:00:00Z', duration_sec: 300, status: 'completed',
    disposition: null, company: 'Alan Cooper Estates', script_key: 'property_call',
    lines: lines.map(([speaker, body]) => ({ speaker, body })),
  })

  it('THE ALAN COOPER CALL: a goodbye is not a second gear', async () => {
    // Verbatim. She named the vendor's figure and he thanked her and hung up.
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([call([
      ['caller', 'Hello, sales.'],
      ['agent', 'if we were to offer around 124,500 pounds, am I in the ballpark?'],
      ['caller', "so I don't think that would be a figure. They would be looking around the 140 Mark"],
      ['agent', 'Actually understand well. Thank you for your time. Have a great day.'],
    ])] as never)
    expect(r.faced_a_no).toBe(1)
    expect(r.second_gear_after_a_no).toBe(0)
  })

  it('credits him when he actually keeps going', async () => {
    const { propertyScriptCheck } = await load()
    const r = propertyScriptCheck([call([
      ['caller', 'Hello, sales.'],
      ['agent', 'if we were to offer around 124,500 pounds, am I in the ballpark?'],
      ['caller', "I don't think they would consider it at this time."],
      ['agent', 'Fair enough, no problem. What would the vendor actually take, do you think?'],
    ])] as never)
    expect(r.faced_a_no).toBe(1)
    expect(r.second_gear_after_a_no).toBe(1)
  })
})

describe('dead air was a fault that never happened', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const silent = (callerLine: string) => ({
    id: 'v', started_at: '2026-08-10T13:00:00Z', duration_sec: 40, status: 'completed',
    disposition: null, company: 'A Branch', script_key: 'property_call',
    lines: [{ speaker: 'caller', body: callerLine }],
  })

  it('does not call an IVR, a hold queue or a closed office a system fault', async () => {
    // The report claimed 12 dead-air calls. Reading all 30 silent calls found
    // zero: every one was a machine. Telling an agent his audio failed when it
    // did not hands him an excuse he never needed.
    const { computeStats } = await load()
    for (const line of [
      'Your call cannot be transferred, please try again later',
      'Your call is in a queue and will be answered shortly',
      'I cannot hear you',
      'Our office is closed, our opening hours are nine to five thirty',
      'Please hold, your call is important to us',
      'For sales press one, for lettings press two',
    ]) {
      const s = computeStats([silent(line)] as never)
      expect(`${line} => ${s.dead_air}`).toBe(`${line} => 0`)
    }
  })

  it('still catches the real thing: a human says hello into a dead line', async () => {
    const { computeStats } = await load()
    expect(computeStats([silent('Hello? Hello, can you hear me?')] as never).dead_air).toBe(1)
  })
})

describe('the report may not state an absolute from a derived count', () => {
  it('says so in both prompts, with the day it learned it', () => {
    expect(cron).toMatch(/NEVER STATE AN ABSOLUTE FROM ONE OF THESE COUNTS/)
    expect(cron.match(/NEVER STATE AN ABSOLUTE FROM ONE OF THESE COUNTS/g)?.length).toBe(2)
    expect(cron).toMatch(/I could only find/)
    expect(cron).toMatch(/floated a figure 4 times when he did it 9 times/)
  })

  it('can be handed a correction when a published report was wrong', () => {
    expect(cron).toMatch(/CORRECTION, PUT THIS FIRST/)
    expect(cron).toMatch(/He may have already\n read the wrong one|already\s+read the wrong one/)
    // Only ever by hand. The 17:30 cron must never set it.
    expect(cron).toMatch(/req\.query\?\.correction/)
  })
})

// Hugo 2026-07-27: "Are you sure fourteen plumbers said yes today and never got
// anything. 100% sure? why?"
//
// No. That claim was wrong, and the report made the same mistake in the same
// hour: it told Marr "21 asks turned into only 7 built, that is your money
// walking out the door". Checked against the transcripts, 5 of those 21 said
// yes and every one of the 5 got a video. The other 16 said no.
//
// Asking is not agreeing. Conflating them invents a loss that never happened
// and points the agent at the wrong fix.

describe('asked is not the same as agreed', () => {
  const load = async () => import('../api/cron/daily-agent-reports')
  const call = (lines: Array<[string, string]>) => ({
    id: 'x', started_at: '2026-07-27T10:00:00Z', duration_sec: 120, status: 'completed',
    disposition: null, company: 'Acme',
    lines: lines.map(([speaker, body]) => ({ speaker, body })),
  })
  const OFFER = "I've recorded you a 90 second audit, can I send it to you?"

  it('counts a real yes', async () => {
    const { scriptCheck } = await load()
    const r = scriptCheck([call([
      ['caller', 'Hello.'], ['agent', OFFER], ['caller', 'Yeah, go on and send it.'],
    ])] as never)
    expect(r.reached_offer).toBe(1)
    expect(r.offer_agreed).toBe(1)
  })

  it('does NOT count a no as a yes, even when it opens with "yeah"', async () => {
    // Real replies from 2026-07-27. Every one of these is a refusal that starts
    // with an agreement word, which is exactly how a naive counter inflates.
    const { scriptCheck } = await load()
    for (const no of [
      "Yeah, no, I'm not I'm all right. I'm not interested. Thank you.",
      "Yeah, I'm honestly mate. I'm I'm not interested, but thank you.",
      "Uh could you try calling back tomorrow, please? I'm right in the middle of something.",
      "No, I don't need any more jobs. I'm far too busy.",
    ]) {
      const r = scriptCheck([call([['caller', 'Hello.'], ['agent', OFFER], ['caller', no]])] as never)
      expect(`${no} => ${r.offer_agreed}`).toBe(`${no} => 0`)
    }
  })

  it('ignores an agreement said BEFORE the offer', async () => {
    const { scriptCheck } = await load()
    const r = scriptCheck([call([
      ['caller', 'Yeah, speaking.'],           // agreeing they are the owner
      ['agent', OFFER],
      ['caller', "No, I'm not interested."],
    ])] as never)
    expect(r.offer_agreed).toBe(0)
  })

  it('forbids the report from claiming a lost yes it cannot see', () => {
    expect(cron).toMatch(/is how many times they ASKED/)
    expect(cron).toMatch(/never treat them as one/i)
    expect(cron).toMatch(/Do not claim a yes was lost unless you can see that yes in a transcript/)
  })

  it('puts agreed in the funnel between offers and videos', () => {
    expect(cron).toMatch(/offers made, offers agreed, videos made, videos sent/)
    expect(cron).toMatch(/offers \("can I send it to you\?"\) -> agreed -> videos made/)
  })
})
