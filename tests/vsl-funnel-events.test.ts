import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-26: full funnel tracking — link click, play, 90/100%, real watch
// coverage — plus per-event notifications (bell + desktop pop-up + email).
//
// The audit that produced this file found `calc` was accepted by track.ts and
// fired by the page but MISSING from the wk_vsl_events type CHECK, and the
// insert never inspected `error` — so every calculator event was silently
// rejected by Postgres. Both halves of that bug are pinned here.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'

describe('event types — the silent-reject bug', () => {
  const mig = read('supabase/migrations/20260727000001_vsl_event_types.sql')

  it('widens the type CHECK to every type the code actually writes', () => {
    // Rebuilt as a named constraint so it is re-runnable; the original was an
    // inline column check auto-named wk_vsl_events_type_check.
    expect(mig).toMatch(/drop constraint if exists wk_vsl_events_type_check/)
    for (const t of [
      'open', 'progress', 'cta_click', 'tier_pick', 'checkout_start', 'paid',
      'auto_sms', 'link_click', 'play', 'calc',
    ]) {
      expect(mig).toContain(`'${t}'`)
    }
  })

  it('keeps auto_sms — the automation cron writes it', () => {
    // Dropping it while rebuilding the constraint would break every nudge.
    expect(read('api/cron/vsl-automation.ts')).toMatch(/type:\s*'auto_sms'/)
    expect(mig).toContain("'auto_sms'")
  })

  it('every wk_vsl_events insert now inspects its error', () => {
    // Widening the CHECK alone just delays the next silent failure: the reason
    // this survived to production is that nothing looked at `error`.
    for (const f of ['api/vsl/track.ts', 'api/vsl/checkout.ts', 'api/lib/vsl-provision.ts']) {
      const src = read(f)
      const at = src.indexOf("from('wk_vsl_events')")
      // The destructure sits just before the call, the console.error just after.
      const around = src.slice(Math.max(0, at - 120), at + 400)
      expect(around, `${f} discards the insert error`).toMatch(/const \{ error: \w+ \} =/)
      expect(around, `${f} never logs the insert error`).toMatch(/console\.error/)
    }
  })
})

describe('wk_vsl_advance — new inputs, first-touch outputs', () => {
  const mig = read('supabase/migrations/20260727000002_vsl_funnel_tracking.sql')

  it('drops the old 4-arg signature before recreating it', () => {
    // Not cosmetic: OUT columns cannot be replaced, AND leaving the old one
    // alive creates an overload that makes PostgREST's named-arg call from
    // vsl-settings.ts fail with PGRST203.
    expect(mig).toMatch(/drop function if exists public\.wk_vsl_advance\(uuid, text, int, boolean\)/)
  })

  it('RE-REVOKES on the new signature — the security hole if forgotten', () => {
    // DROP destroys the ACL and a fresh CREATE grants EXECUTE TO PUBLIC. This
    // function is SECURITY DEFINER and writes the funnel: without this line
    // anyone holding the anon key could call it with p_target => 'paid'.
    expect(mig).toMatch(
      /revoke all on function public\.wk_vsl_advance\(uuid, text, int, boolean, boolean, boolean, boolean\)\s+from public, anon, authenticated/
    )
    expect(mig).toMatch(/security definer/)
    expect(mig).toMatch(/set search_path = public/)
  })

  it('takes the three new write flags as INPUTS', () => {
    for (const p of ['p_link_click', 'p_play', 'p_completed']) {
      expect(mig).toContain(p)
    }
  })

  it('reports first-touch and the pre-write pct so callers can dedupe', () => {
    for (const c of ['pct_before', 'first_click', 'first_open', 'first_play', 'first_complete']) {
      expect(mig).toContain(c)
    }
  })

  it('derives first_open/first_click from the COUNTERS, not the timestamps', () => {
    // first_opened_at is only set when p_target='opened' AND rank advances, so
    // one dropped beacon leaves it NULL forever and every later reload would
    // re-report "first open". open_count/click_count are unconditional.
    expect(mig).toMatch(/first_open\s*:?=?\s*.*open_count\s*=\s*0|r\.open_count = 0/)
    expect(mig).toMatch(/r\.click_count = 0/)
  })

  it('still holds the row lock before computing anything', () => {
    expect(mig).toMatch(/for update/)
  })
})

describe('funnel columns + wk_notifications', () => {
  const mig = read('supabase/migrations/20260727000002_vsl_funnel_tracking.sql')

  it('adds the new page columns idempotently', () => {
    for (const c of ['first_click_at', 'click_count', 'play_at', 'completed_at']) {
      expect(mig).toMatch(new RegExp(`add column if not exists ${c}`))
    }
  })

  it('creates wk_notifications with agent-or-admin read and NO client insert', () => {
    expect(mig).toMatch(/create table if not exists wk_notifications/)
    expect(mig).toMatch(/alter table wk_notifications enable row level security/)
    expect(mig).toMatch(/wk_is_admin\(\) or agent_id = auth\.uid\(\)/)
    expect(mig).toMatch(/to authenticated/)
    // Writes are service-role only, exactly like wk_vsl_pages.
    expect(mig).not.toMatch(/create policy \S+ on wk_notifications for insert/)
  })

  it('lets an agent mark their own rows read', () => {
    expect(mig).toMatch(/create policy \S+ on wk_notifications for update/)
  })

  it('indexes the feed query', () => {
    expect(mig).toMatch(/create index if not exists \S+\s+on wk_notifications \(agent_id, created_at desc\)/)
  })

  it('sets replica identity full so read_at updates replicate', () => {
    // House rule from 20260503000002: RLS policies referencing non-PK columns
    // need it, or the UPDATE events silently never arrive.
    expect(mig).toMatch(/alter table wk_notifications replica identity full/)
  })

  it('puts wk_notifications AND wk_vsl_events on realtime', () => {
    for (const t of ['wk_notifications', 'wk_vsl_events']) {
      expect(mig).toMatch(new RegExp(`alter publication supabase_realtime add table ${t}`))
    }
  })

  it('cascades from the contact and page it points at', () => {
    expect(mig).toMatch(/contact_id uuid[^,]*references wk_contacts\(id\) on delete cascade/)
    expect(mig).toMatch(/page_id uuid[^,]*references wk_vsl_pages\(id\) on delete cascade/)
  })
})

describe('crossedMilestones — the dedupe primitive', () => {
  const load = async () => import('../api/lib/vsl-settings')

  it('reports only markers newly crossed by this beacon', async () => {
    const { crossedMilestones } = await load()
    expect(crossedMilestones(0, 60)).toEqual([10, 25, 50])
    expect(crossedMilestones(50, 60)).toEqual([])
    expect(crossedMilestones(50, 95)).toEqual([75, 90])
    expect(crossedMilestones(95, 100)).toEqual([100])
  })

  it('never re-fires on a replay or a rewind', async () => {
    const { crossedMilestones } = await load()
    expect(crossedMilestones(100, 100)).toEqual([])
    expect(crossedMilestones(100, 25)).toEqual([])
    expect(crossedMilestones(90, 10)).toEqual([])
  })

  it('is inclusive at the marker itself', async () => {
    const { crossedMilestones } = await load()
    expect(crossedMilestones(0, 50)).toEqual([10, 25, 50])
    expect(crossedMilestones(49, 50)).toEqual([50])
  })
})

describe('watch coverage — a seek must not fake 100%', () => {
  const page = read('api/vsl/page.ts')

  it('measures video.played, not the playhead', () => {
    // page.ts renders a full seek bar wired to v.currentTime. Reporting
    // currentTime/duration means one drag to the end registers 100%, trips
    // completed_at, moves the card to "Watched" and fires the
    // "saw you watched the video" nudge at someone who watched nothing.
    expect(page).toMatch(/\.played/)
    expect(page).toMatch(/function cov\(/)
  })

  it('sums every played range, not just the first', () => {
    // A lead who watches, skips back and rewatches has multiple ranges.
    expect(page).toMatch(/played\.length/)
    expect(page).toMatch(/played\.end\(/)
    expect(page).toMatch(/played\.start\(/)
  })

  it('fires the markers Hugo asked for by name', () => {
    expect(page).toMatch(/\[10,25,50,75,90,100\]/)
  })

  it('sends play once, and completion on ended', () => {
    expect(page).toMatch(/send\('play'\)/)
    expect(page).toMatch(/addEventListener\('ended'/)
  })

  it('flushes the true coverage when the page goes away', () => {
    // Without this watched_pct only ever holds a marker value; the flush is
    // what makes it a real number.
    expect(page).toMatch(/pagehide|visibilitychange/)
  })

  // Behavioural, not a grep: pull the real cov() out of the emitted script and
  // run it against faked TimeRanges. This is the assertion that actually proves
  // a lead cannot drag the bar to the end and be recorded as having watched.
  const cov = (ranges: Array<[number, number]>, duration = 100) => {
    const src = page.slice(page.indexOf('function cov('))
    const body = src.slice(0, src.indexOf('var sentPct'))
    const make = new Function('v', `${body}; return cov;`) as (v: unknown) => () => number
    return make({
      duration,
      played: {
        length: ranges.length,
        start: (i: number) => ranges[i][0],
        end: (i: number) => ranges[i][1],
      },
    })()
  }

  it('a drag to the end scores ~0, not 100', () => {
    // Seeking decodes a sliver at the destination and nothing before it.
    expect(cov([[99, 100]])).toBe(1)
  })

  it('a genuine full watch scores 100', () => {
    expect(cov([[0, 100]])).toBe(100)
  })

  it('adds up a watch-skip-rewatch session', () => {
    expect(cov([[0, 30], [60, 80]])).toBe(50)
  })

  it('never exceeds 100 when ranges overlap the duration', () => {
    expect(cov([[0, 100], [0, 100]])).toBe(100)
  })

  it('is 0 before anything plays', () => {
    expect(cov([])).toBe(0)
  })
})

describe('link click — logged server-side, preview fetchers excluded', () => {
  const page = read('api/vsl/page.ts')

  it('counts a click only on a real document navigation', () => {
    // iMessage builds its preview with a stock Safari UA — indistinguishable by
    // User-Agent, and it fires the moment the SMS is DELIVERED. Real
    // navigations carry Sec-Fetch-Dest: document; preview fetchers send no
    // Sec-Fetch-* at all.
    expect(page).toMatch(/sec-fetch-dest/)
    expect(page).toMatch(/document/)
  })

  it('ignores prefetches and non-GET probes', () => {
    expect(page).toMatch(/sec-purpose|purpose/i)
    expect(page).toMatch(/req\.method/)
  })

  it('skips tracking entirely for internal previews', () => {
    // Hugo opening pages from the board must not burn the lead's first touch.
    expect(page).toMatch(/'p'\)\s*===\s*'1'|p === '1'|preview/)
  })

  it('awaits the write before res.end — there is no waitUntil here', () => {
    // The Vercel Node container freezes once the response completes, so a
    // dangling promise may never run.
    expect(page).toMatch(/await logLinkClick\(/)
    // The comment above it explains why; what matters is that nothing CALLS it.
    expect(page).not.toMatch(/waitUntil\(/)
  })

  it('never accepts link_click from the browser', () => {
    // Server-owned, same rule the file header already states for paid.
    const track = read('api/vsl/track.ts')
    const set = track.slice(track.indexOf('BROWSER_TYPES'), track.indexOf('BROWSER_TYPES') + 200)
    expect(set).toContain("'play'")
    expect(set).not.toContain("'link_click'")
  })
})

describe('beacon signing — forged events text real leads', () => {
  const page = read('api/vsl/page.ts')
  const track = read('api/vsl/track.ts')

  it('mints a token into the page and verifies it on the way in', () => {
    // page_id is printed in the public HTML and slugs are guessable business
    // names, so a forged progress beacon can flip state to 'watched' and make
    // the automation cron text a real lead about a video they never opened.
    expect(page).toMatch(/TOKEN/)
    expect(track).toMatch(/crypto\.subtle/)
    expect(track).toMatch(/VSL_BEACON_SECRET/)
  })

  it('fails closed when the secret is unset', () => {
    expect(track).toMatch(/!secret/)
  })
})

describe('notification fan-out', () => {
  const notify = read('api/lib/vsl-notify.ts')
  const provision = read('api/lib/vsl-provision.ts')
  const page = read('api/vsl/page.ts')

  // The signature's own `}): Promise<void> {` sits at column 0, so slice to the
  // next top-level declaration instead of the first newline-brace.
  const fnBody = (src: string, name: string) => {
    const from = src.indexOf(name)
    const rest = src.slice(from + name.length)
    const end = rest.search(/\n(export |const |function |interface )/)
    return rest.slice(0, end === -1 ? rest.length : end)
  }

  it('writes the row and does NOT email inline', () => {
    // Emailing from a request handler risks a blank sales page: no waitUntil in
    // this stack, and sendEmail throws on a Resend 429.
    const body = fnBody(notify, 'export async function notifyFunnelEvent')
    expect(body).toMatch(/from\('wk_notifications'\)/)
    expect(body).not.toMatch(/sendEmail\(|sendNotification\(/)
  })

  it('never throws — a notification must not break a lead-facing page', () => {
    expect(fnBody(notify, 'export async function notifyFunnelEvent')).toMatch(/catch/)
  })

  it('deep-links to the lead, relatively (react-router cannot take an absolute URL)', () => {
    expect(notify).toMatch(/link: `\/admin\/crm\/contacts\/\$\{page\.contact_id\}`/)
    // …and absolutely for the email, which leaves the app.
    expect(notify).toMatch(/export function leadUrl/)
    expect(notify).toMatch(/APP_URL/)
  })

  it('stamps every email in Europe/London', () => {
    expect(notify).toMatch(/timeZone: 'Europe\/London'/)
    expect(notify).toMatch(/stampLondon\(r\.created_at\)/)
  })

  it('escapes lead names — they come from Google Places free text', () => {
    expect(notify).toMatch(/escHtml/)
    expect(notify).toMatch(/escHtml\(r\.title\)/)
  })

  it('emails BOTH the admin and the owning agent', () => {
    expect(notify).toMatch(/DAILY_REPORT_EMAIL/)
    expect(notify).toMatch(/from\('profiles'\)/)
    expect(notify).toMatch(/\[adminTo, agentEmail\]/)
  })

  it('honours the per-event email toggles', () => {
    expect(notify).toMatch(/settings\.notify\[key\]/)
  })

  it('paces under the Resend rate limit and has a flood breaker', () => {
    expect(notify).toMatch(/setTimeout\(.*600\)|600\)/)
    expect(notify).toMatch(/DIGEST_THRESHOLD/)
  })

  it('marks rows emailed so the queue drains even when a send fails', () => {
    expect(notify).toMatch(/emailed_at: new Date\(\)\.toISOString\(\)/)
  })

  it('does not double-send the £1 sale', () => {
    // notifyOwner used to be the only paid email. Routing paid through the
    // helper while leaving it in place would give Hugo two emails per sale.
    const happy = provision.slice(provision.indexOf('await recordPaid(page, session, priceId, businessId)'))
    expect(happy).toMatch(/notifyFunnelEvent/)
    expect(happy).not.toMatch(/notifyOwner\(`💰/)
  })

  it('keeps the two reconciliation alerts admin-only', () => {
    // Those are Hugo's problem, not the SDR's — and the manual-link path must
    // never emit a cheery "paid" alongside its ⚠️.
    expect(provision).toMatch(/notifyOwner\(`⚠️ VSL sale with NO email/)
    expect(provision).toMatch(/notifyOwner\(`⚠️ VSL sale needs manual link/)
  })

  it('does not announce "paid" from recordPaid — the manual-link path calls it too', () => {
    const rec = provision.slice(provision.indexOf('async function recordPaid'))
    expect(rec.slice(0, rec.indexOf('\n}'))).not.toMatch(/notifyFunnelEvent/)
  })

  it('drains on its own every-minute cron, ungated by quiet hours', () => {
    const vercel = JSON.parse(read('vercel.json')) as { crons: Array<{ path: string; schedule: string }> }
    const cron = vercel.crons.find((c) => c.path === '/api/cron/notify-drain')
    expect(cron?.schedule).toBe('* * * * *')
    // Strip comments — the file explains WHY it isn't gated, which would
    // otherwise trip the assertion below.
    const drain = read('api/cron/notify-drain.ts').replace(/^\s*\/\/.*$/gm, '')
    expect(drain).toMatch(/CRON_SECRET/)
    // vsl-automation returns early when the funnel is dark or it's quiet hours;
    // Hugo's own inbox must not be gated on either.
    expect(drain).not.toMatch(/insideQuietHours|settings\.enabled/)
  })

  it('the board previews pages without burning the lead\'s first touch', () => {
    expect(page).toMatch(/searchParams\.get\('p'\) === '1'/)
  })
})

describe('staff views must never move a lead\'s card', () => {
  const page = read('api/vsl/page.ts')
  const board = read('src/features/crm/pages/VideoFunnelPage.tsx')

  it('recognises a click through from the CRM on a device with no cookie', () => {
    // A phone, a second laptop or an incognito window has no cookie yet and
    // would otherwise be counted as the lead. A prospect never arrives from
    // inside the CRM — they come from an SMS, with no referrer at all.
    expect(page).toMatch(/INTERNAL_REFERRERS/)
    expect(page).toMatch(/app\.heyelsie\.com/)
    expect(page).toMatch(/req\.headers\.referer/)
  })

  it('recognises us by cookie, not just the ?p=1 flag', () => {
    // Hugo 2026-07-26: opening a lead's page from the board moved it to
    // "Opened". ?p=1 alone is not enough — the link gets copied and pasted
    // without it, so the first staff visit marks the browser.
    expect(page).toMatch(/function isStaffView/)
    expect(page).toMatch(/elsie_staff/)
    expect(page).toMatch(/Set-Cookie/)
  })

  it('kills EVERY browser beacon, not just the click log', () => {
    // The original fix only guarded the server-side log; open / play /
    // progress / cta_click all still fired and advanced the funnel. One guard
    // inside send() now covers every beacon on the page.
    expect(page).toMatch(/function send\(t,extra\)\{if\(STAFF\)return;/)
    // …and the signing token is blank for staff, so a hand-made beacon 403s.
    expect(page).toMatch(/TOKEN='\$\{staff \? '' :/)
  })

  it('never advances state from a staff visit', () => {
    const fn = page.slice(page.indexOf('async function logLinkClick'))
    const body = fn.slice(0, fn.indexOf('\nexport default'))
    // The staff branch inserts an event and returns BEFORE advanceVslState.
    const staffBranch = body.slice(body.indexOf('if (staff)'), body.indexOf('const human'))
    expect(staffBranch).toMatch(/internal: true/)
    expect(staffBranch).toMatch(/return;/)
    expect(staffBranch).not.toMatch(/advanceVslState/)
  })

  it('tells the viewer they are not being tracked', () => {
    expect(page).toMatch(/Staff preview — nothing here is tracked/)
  })

  it('the activity drawer labels our own views', () => {
    // Moved out of VideoFunnelPage into FunnelLeadDrawer when the drawer grew
    // editing (Hugo 2026-07-27). Same labelling, new home.
    const drawer = read('src/features/crm/components/funnel/FunnelLeadDrawer.tsx')
    expect(drawer).toMatch(/Viewed by us/)
    expect(drawer).toMatch(/staff preview, not counted/)
  })
})

describe('aggregates — counted from timestamps, never from state', () => {
  const mig = read('supabase/migrations/20260727000003_funnel_aggregates.sql')

  it('the summary counts *_at columns, not board columns', () => {
    // state is forward-only: a paid lead is no longer 'opened', so counting the
    // board would report "opened 0, paid 1" and every drop-off would be wrong.
    expect(mig).toMatch(/filter \(where p\.first_opened_at is not null\)/)
    expect(mig).toMatch(/filter \(where p\.first_click_at is not null\)/)
    expect(mig).toMatch(/filter \(where p\.play_at is not null\)/)
    const summary = mig.slice(mig.indexOf('wk_vsl_funnel_summary'), mig.indexOf('wk_leaderboard'))
    expect(summary).not.toMatch(/where p\.state =/)
  })

  it('both functions are staff-gated SECURITY DEFINER with a pinned search_path', () => {
    for (const fn of ['wk_vsl_funnel_summary', 'wk_leaderboard']) {
      const body = mig.slice(mig.indexOf(`create or replace function public.${fn}`))
      expect(body).toMatch(/security definer/)
      expect(body).toMatch(/set search_path = public/)
      expect(body).toMatch(/public\.wk_is_agent_or_admin\(\)/)
    }
  })

  it('agents are scoped to their own funnel in the summary', () => {
    expect(mig).toMatch(/public\.wk_is_admin\(\) or p\.agent_id = auth\.uid\(\)/)
  })

  it('drops wk_leaderboard before recreating, then re-grants', () => {
    // OUT columns cannot be replaced, and DROP destroys the grants.
    expect(mig).toMatch(/drop function if exists public\.wk_leaderboard\(timestamptz, timestamptz\)/)
    expect(mig).toMatch(/grant execute on function public\.wk_leaderboard\(timestamptz, timestamptz\) to authenticated/)
  })

  it('puts an admin with VSL pages on the roster', () => {
    // The old roster was agents-only, so Hugo's OWN funnel numbers were absent.
    expect(mig).toMatch(/exists \(select 1 from wk_vsl_pages v where v\.agent_id = p\.id\)/)
  })

  it('bounds funnel columns on when the STAGE happened', () => {
    // A page sent three weeks ago and watched today belongs in "today".
    expect(mig).toMatch(/v\.first_opened_at\s+between p_since/)
    expect(mig).toMatch(/v\.paid_at\s+between p_since/)
  })

  it('is a NEW migration file — editing 20260724000002 breaks its contract test', () => {
    const old = read('supabase/migrations/20260724000002_leaderboard_range.sql')
    expect(old).not.toMatch(/videos_sent/)
  })
})

describe('where Hugo and each agent can see it', () => {
  const board = read('src/features/crm/pages/VideoFunnelPage.tsx')
  const lb = read('src/features/crm/pages/LeaderboardPage.tsx')
  const bar = read('src/features/crm/layout/Smsv2StatusBar.tsx')
  const hook = read('src/features/crm/hooks/useNotifications.ts')
  const timeline = read('src/features/crm/hooks/useContactTimeline.ts')
  const inbox = read('src/features/crm/pages/InboxPage.tsx')
  const detail = read('src/features/crm/pages/ContactDetailPage.tsx')
  const helpers = read('src/features/crm/data/helpers.ts')

  it('board shows a conversion strip from the RPC, not the 500-row page', () => {
    expect(board).toMatch(/wk_vsl_funnel_summary/)
    expect(board).toMatch(/funnel-summary-strip/)
  })

  it('board cards carry a real date+time and open a full activity drawer', () => {
    expect(board).toMatch(/formatDateTime/)
    expect(board).toMatch(/STAGE_STAMPS/)
    // The drawer itself now lives in components/funnel and does the editing too.
    const drawer = read('src/features/crm/components/funnel/FunnelLeadDrawer.tsx')
    expect(drawer).toMatch(/funnel-activity-drawer/)
    expect(board).toMatch(/<FunnelLeadDrawer/)
  })

  it('board preview links do not count as the lead visiting', () => {
    expect(board).toMatch(/const PREVIEW = '\?p=1'/)
    expect(board).toMatch(/\$\{p\.slug\}\$\{PREVIEW\}/)
  })

  it('leaderboard gains a funnel view without breaking the calls comparator', () => {
    expect(lb).toMatch(/leaderboard-view-\$\{v\}/)
    expect(lb).toMatch(/'calls', 'funnel'/)
    // tests/leaderboard-rpc.test.ts regexes for this exact expression.
    expect(lb).toMatch(/b\.calls\s*-\s*a\.calls/)
    // …and must NOT import the row type from useReports (asserted there too).
    expect(lb).not.toMatch(/from '\.\.\/hooks\/useReports'/)
  })

  it('leaderboard scrolls instead of clipping, and colSpan follows the view', () => {
    expect(lb).toMatch(/overflow-x-auto/)
    expect(lb).not.toMatch(/colSpan=\{8\}/)
  })

  it('one bell, both sources, one unread count', () => {
    expect(bar).toMatch(/useNotifications/)
    expect(bar).toMatch(/unreadTotal/)
    expect(bar).toMatch(/notifications\.markAllRead\(\); funnel\.markAllRead\(\)/)
  })

  it('desktop pop-ups are guarded and fired outside a state updater', () => {
    expect(hook).toMatch(/'Notification' in window/)
    expect(hook).toMatch(/catch/)
    // Tag by ROW id — a contact tag would swallow the next event for that lead.
    expect(hook).toMatch(/tag: n\.id/)
    expect(bar).toMatch(/useEffect\(\(\) => \{\s*if \(!funnel\.latest\) return/)
  })

  it('unread is a real count, not the page length', () => {
    expect(hook).toMatch(/count: 'exact', head: true/)
  })

  it('funnel events reach BOTH lead timelines', () => {
    // The join has to go through wk_vsl_pages — wk_vsl_events has no contact_id.
    expect(timeline).toMatch(/wk_vsl_pages!inner\(contact_id\)/)
    expect(timeline).toMatch(/results\[6\]/)
    // The dropped `sms_messages` table (which 404'd on every contact open) is
    // gone, so results[] is no longer variable-length and nothing can shift
    // under the funnel query's fixed index.
    expect(timeline).not.toMatch(/from\('sms_messages'/)
    expect(inbox).toMatch(/thread-funnel-event/)
    expect(detail).toMatch(/detail-funnel-event/)
  })

  it('the funnel branch renders before the activity fallthrough', () => {
    expect(inbox.indexOf("item.kind === 'funnel'")).toBeLessThan(
      inbox.indexOf('const a = item.payload as ActivityEvent')
    )
  })

  it('date+time is pinned to Europe/London', () => {
    expect(helpers).toMatch(/export function formatDateTime/)
    expect(helpers).toMatch(/timeZone: 'Europe\/London'/)
  })
})

// ---------------------------------------------------------------------------
// QA + AppSec audit, 2026-07-26. Each of these pins a defect found by driving
// the live app, so it cannot come back silently.
// ---------------------------------------------------------------------------

describe('audit — the calling journey', () => {
  const script = read('src/core/content/one-call-script.html')
  const seed = read('scripts/seed-audit-call-motion.sql')
  const vsl = read('api/lib/vsl-settings.ts')

  it('the live-call script pane is seeded, so it is never the empty state', () => {
    // wk_call_scripts had ZERO rows, so agents saw "No default script yet —
    // open Settings", and Settings is admin-only. A dead end mid-call.
    expect(seed).toMatch(/insert into wk_call_scripts/)
    expect(seed).toMatch(/is_default/)
  })

  it('nothing in the rendered script closes on a card or quotes the tiers', () => {
    // The whole call is now permission to send a video; the page takes payment.
    const nodes = script.slice(script.indexOf('const N = {'), script.indexOf('const MAINLINE'))
    const mainline = script.match(/const MAINLINE = \[[\s\S]*?\];/)![0]
    const bodies = new Map<string, string>()
    for (const m of nodes.matchAll(/\n {2}([a-z_0-9]+):\s*\{stage:[\s\S]*?(?=\n {2}[a-z_0-9]+:\s*\{stage:|$)/g)) {
      bodies.set(m[1], m[0])
    }
    const reach = new Set(Array.from(mainline.matchAll(/'([a-z_0-9]+)'/g), (m) => m[1]))
    const stack = [...reach]
    while (stack.length) {
      for (const t of Array.from((bodies.get(stack.pop()!) || '').matchAll(/n:`([a-z_0-9]+)`/g), (m) => m[1])) {
        if (!reach.has(t)) { reach.add(t); stack.push(t) }
      }
    }
    const rendered = [...reach].map((k) => bodies.get(k) || '').join(' ')
    expect(rendered).not.toMatch(/£99|£179|£279/)
    expect(rendered).not.toMatch(/\bcard\b/i)
    expect(rendered).toMatch(/2-minute audit/)
  })

  it('the coach may not be told to take a card or quote tiers', () => {
    expect(seed).toMatch(/NEVER ask for a card/)
    expect(seed).toMatch(/NEVER read out the monthly tiers/)
  })

  it('the SMS echoes what the agent promised on the phone', () => {
    // "I'll text you the 2-minute audit" then a text saying something else
    // reads like a different offer from a stranger.
    expect(vsl).toMatch(/2-minute audit I just mentioned/)
  })

  it('never promises a length the video does not have', () => {
    // The video is 2:35 and every surface called it "90 seconds" until
    // 2026-07-27, so the first thing a lead saw on pressing play was a timer
    // reading 2:35. Our own script forbids exactly this: "never say a minute
    // and then send five." Hugo: "lets call it a 2 minutes videos."
    const surfaces: Array<[string, string]> = [
      ['sms', vsl],
      ['page', read('api/vsl/page.ts')],
      ['follow-ups', read('api/lib/vsl-sequence.ts')],
      ['email subject', read('api/cron/vsl-auto-send.ts')],
      ['call script', read('scripts/seed-audit-call-motion.sql')],
      ['objection script', read('src/core/content/one-call-script.html')],
    ]
    for (const [name, src] of surfaces) {
      // Strip the one comment that documents the rename itself.
      const copy = src.replace(/It said "90-second" until[\s\S]*?a 2 minutes videos\."/g, '')
      expect(`${name}: ${(copy.match(/90[- ]?seconds?/gi) || []).join(',')}`).toBe(`${name}: `)
    }
  })
})

describe('audit — security + correctness fixes', () => {
  const guard = read('src/features/admin/AdminGuard.tsx')
  const vercel = JSON.parse(read('vercel.json')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const timeline = read('src/features/crm/hooks/useContactTimeline.ts')
  const queue = read('src/features/crm/dialer-pro/useQueuePro.ts')
  const dnc = read('supabase/migrations/20260727000004_do_not_call.sql')

  it('a logged-out visitor to /admin reaches a terminal state', () => {
    // The effect used to bail before setting isAdmin, so it stayed null, the
    // spinner never cleared and the redirect below was unreachable —
    // /admin and /super hung on a blank page forever.
    expect(guard).toMatch(/if \(!user\?\.email\) \{\s*setIsAdmin\(false\)/)
    expect(guard).toMatch(/if \(!user\) return <Navigate to="\/login"/)
  })

  it('every response carries the baseline security headers', () => {
    const global = vercel.headers.find((h) => h.source === '/(.*)')
    expect(global, 'no global header rule').toBeTruthy()
    const keys = global!.headers.map((h) => h.key)
    // X-Frame-Options: the CRM was framable by any site (clickjacking an agent
    // into clicking real buttons). SAMEORIGIN, not DENY — admin pages iframe
    // our own /leads and the scraper.
    expect(keys).toContain('X-Frame-Options')
    expect(global!.headers.find((h) => h.key === 'X-Frame-Options')!.value).toBe('SAMEORIGIN')
    expect(keys).toContain('X-Content-Type-Options')
    expect(keys).toContain('Referrer-Policy')
  })

  it('no query hits the dropped sms_messages table', () => {
    // It 404'd on every contact open and the failure was swallowed.
    expect(timeline).not.toMatch(/from\('sms_messages'/)
    expect(timeline).not.toMatch(/table: 'sms_messages'/)
  })

  it('suppressed leads never enter the dialer queue', () => {
    expect(queue).toMatch(/\.eq\('wk_contacts\.do_not_call', false\)/)
    expect(dnc).toMatch(/add column if not exists do_not_call boolean/)
    // …and the flag also clears any row already queued.
    expect(dnc).toMatch(/set status = 'skipped'/)
  })
})
