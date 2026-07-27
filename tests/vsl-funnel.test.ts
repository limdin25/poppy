import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-25: the VSL funnel — per-lead video pages at heyelsie.com/{slug},
// open/watch/click/pay tracking, pipeline auto-move, SMS automation, £1 checkout.

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const vercel = JSON.parse(read('vercel.json')) as {
  rewrites: Array<{ source: string; destination: string; has?: unknown[] }>
  crons: Array<{ path: string; schedule: string }>
}

// The settings lib builds a supabase client at import time.
process.env.SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'

describe('vsl lib — slugs', () => {
  const load = async () => import('../api/lib/vsl-settings')

  it('slugifies business names for the URL', async () => {
    const { slugifyBusiness } = await load()
    expect(slugifyBusiness("Manny's Plumbing & Heating Ltd")).toBe('manny-s-plumbing-and-heating-ltd')
    expect(slugifyBusiness('  CRE Plumbing!!  ')).toBe('cre-plumbing')
  })

  it('never emits a reserved slug that would shadow a real route', async () => {
    const { slugifyBusiness, VSL_RESERVED_SLUGS } = await load()
    // A business literally called "Subscribe" must not claim /subscribe.
    expect(VSL_RESERVED_SLUGS.has(slugifyBusiness('Subscribe'))).toBe(false)
    expect(slugifyBusiness('Report')).toBe('report-video')
    expect(slugifyBusiness('')).toBe('business')
  })

  it('fills templates and survives missing fields', async () => {
    const { fillTemplate } = await load()
    const out = fillTemplate('Hi {first}, video for {business}: {url} — {agent}', {
      first: 'Charlie Creed', business: 'CRE Plumbing', url: 'https://heyelsie.com/cre', agent: 'Pedro III',
    })
    expect(out).toBe('Hi Charlie, video for CRE Plumbing: https://heyelsie.com/cre — Pedro')
    // No name → the name is dropped (not a spammy "Hi there"); grammar tidied.
    expect(fillTemplate('Hi {first}', {})).toBe('Hi')
    expect(fillTemplate("Hi {first}, it's Hugo — video for {business}", { business: 'CRE' }))
      .toBe("Hi, it's Hugo — video for CRE")
  })

  it('accepts {first_name} and strips any leftover token so the SMS worker cannot re-substitute it', async () => {
    const { fillTemplate } = await load()
    // {first_name} is the CRM-standard token; the worker would turn it into the
    // COMPANY name if it survived — so we resolve it here and clear stragglers.
    expect(fillTemplate('Hi {first_name} from {business}', { first: 'Amir', business: 'Blue Flame' }))
      .toBe('Hi Amir from Blue Flame')
    expect(fillTemplate('Hi {first_name}, {leftover} here', { first: 'Amir' })).toBe('Hi Amir, here')
  })

  it('reserved slugs stay in lockstep with the vercel rewrite', async () => {
    const { VSL_RESERVED_SLUGS } = await load()
    for (const r of ['terms', 'privacy', 'dpa', 'register', 'script', 'rank-frame', 'forgot-password']) {
      expect(VSL_RESERVED_SLUGS.has(r)).toBe(true)
      expect(vercel.rewrites.find((x) => x.destination.startsWith('/api/vsl/page'))!.source).toContain(r)
    }
  })

  it('state machine ranks forward-only', async () => {
    const { stateRank } = await load()
    expect(stateRank('paid')).toBeGreaterThan(stateRank('checkout_started'))
    expect(stateRank('checkout_started')).toBeGreaterThan(stateRank('watched'))
    expect(stateRank('watched')).toBeGreaterThan(stateRank('opened'))
    expect(stateRank('opened')).toBeGreaterThan(stateRank('sent'))
    expect(stateRank('nonsense')).toBe(-1)
  })

  it('quiet hours respect Europe/London', async () => {
    const { insideQuietHours, DEFAULT_VSL_SETTINGS } = await load()
    const s = { ...DEFAULT_VSL_SETTINGS, quiet_hours: { start: '00:00', end: '23:59' } }
    expect(insideQuietHours(s)).toBe(true)
    const closed = { ...DEFAULT_VSL_SETTINGS, quiet_hours: { start: '00:00', end: '00:00' } }
    expect(insideQuietHours(closed)).toBe(false)
  })

  it('maps every funnel state to a pipeline column', async () => {
    const { VSL_STATE_TO_COLUMN } = await load()
    expect(Object.values(VSL_STATE_TO_COLUMN)).toEqual([
      'Video sent', 'Opened page', 'Watched video', 'Clicked button', 'Checkout started', 'Paid',
    ])
  })
})

describe('routing — heyelsie.com/{slug}', () => {
  it('is host-scoped to the apex and lands before the SPA catch-all', () => {
    const i = vercel.rewrites.findIndex((r) => r.destination.startsWith('/api/vsl/page'))
    const spa = vercel.rewrites.findIndex((r) => r.destination === '/index.html')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(i).toBeLessThan(spa)
    expect(JSON.stringify(vercel.rewrites[i].has)).toContain('heyelsie.com')
  })

  it('the slug pattern refuses to swallow app routes', () => {
    const rule = vercel.rewrites.find((r) => r.destination.startsWith('/api/vsl/page'))!
    for (const path of ['api/', 'report', 'welcome', 'subscribe', 'r/', 'login']) {
      expect(rule.source).toContain(path.replace('/', ''))
    }
  })

  it('the automation cron is registered every 5 minutes', () => {
    const cron = vercel.crons.find((c) => c.path === '/api/cron/vsl-automation')
    expect(cron?.schedule).toBe('*/5 * * * *')
  })
})

describe('public page', () => {
  const page = read('api/vsl/page.ts')

  it('renders OG tags server-side for the SMS preview', () => {
    expect(page).toMatch(/og:title/)
    expect(page).toMatch(/og:image/)
    expect(page).toMatch(/noindex/)
  })

  it('unknown slugs bounce to the marketing site, never 404', () => {
    expect(page).toMatch(/heyelsie\.com\/welcome/)
    expect(page).toMatch(/302/)
  })

  it('fires the four browser beacons', () => {
    for (const b of ["'open'", 'progress', 'cta_click', 'tier_pick']) expect(page).toContain(b)
    expect(page).toMatch(/sendBeacon/)
  })

  it('escapes lead data into the HTML', () => {
    expect(page).toMatch(/const esc = /)
    // raw* strings esc()'d at emission — never double-escaped into og tags
    expect(page).toMatch(/esc\(rawBusiness\)/)
    expect(page).toMatch(/esc\(ogTitle\)/)
  })
})

describe('tracking — forward-only', () => {
  const track = read('api/vsl/track.ts')

  it('only accepts browser event types — paid/checkout are server-owned', () => {
    expect(track).toMatch(/BROWSER_TYPES/)
    expect(track).not.toMatch(/BROWSER_TYPES = new Set\(\[[^\]]*paid/)
    expect(track).not.toMatch(/BROWSER_TYPES = new Set\(\[[^\]]*checkout_start/)
  })

  it('uses the shared forward-only advance', () => {
    expect(track).toMatch(/advanceVslState/)
  })

  it('watched only fires at the configured threshold', () => {
    expect(track).toMatch(/watched_threshold_pct/)
  })
})

describe('checkout — £1 + trial', () => {
  const checkout = read('api/vsl/checkout.ts')

  it('only sells the three allow-listed reviews tiers', () => {
    expect(checkout).toMatch(/VSL_PRICES\[priceId\]/)
  })

  it('charges £1 today with the canonical trial on the subscription', () => {
    expect(checkout).toMatch(/VSL_POUND_PRICE/)
    // Trial length is no longer hardcoded per checkout — one constant drives
    // all three doors AND every line of user-facing copy.
    expect(checkout).toMatch(/trial_period_days: TRIAL_DAYS/)
    expect(checkout).toMatch(/payment_method_collection: 'always'/)
    expect(read('api/lib/review-plans.ts')).toMatch(/TRIAL_DAYS = 10/)
  })

  it('returns the session id so /continue can confirm the payment', () => {
    // Without this the buyer lands on a page that has no idea they paid and
    // asks them to retype the email they just used on Stripe.
    expect(checkout).toMatch(/session_id=\{CHECKOUT_SESSION_ID\}/)
  })

  it('carries the page identity for webhook provisioning', () => {
    expect(checkout).toMatch(/vsl_page_id: page\.id/)
    expect(checkout).toMatch(/agent_id: page\.agent_id/)
  })

  it('a paid page cannot be double-sold', () => {
    expect(checkout).toMatch(/state === 'paid'/)
    expect(checkout).toMatch(/409/)
  })
})

describe('webhook provisioning', () => {
  const hook = read('api/webhooks/stripe.ts')
  const prov = read('api/lib/vsl-provision.ts')

  it('branches on vsl_page_id without touching the business_id flow', () => {
    expect(hook).toMatch(/vsl_page_id/)
    expect(hook).toMatch(/provisionVslSale/)
    expect(hook).toMatch(/metadata\?\.business_id/)
  })

  it('NEVER mutates an existing business from the unverified Stripe email (hijack fix)', () => {
    // The email is typed on Stripe's page — unverified. An existing owner match
    // must be flagged for manual review, never auto-relinked.
    expect(prov).toMatch(/needs manual link/i)
    expect(prov).toMatch(/\.eq\('role', 'owner'\)/)
    // No .update(businesses...) on the existing-owner path.
    expect(prov).not.toMatch(/existing\?\.business_id[\s\S]{0,400}\.from\('businesses'\)\s*\.update/)
  })

  it('is idempotent AND resumable — claims the session before any write', () => {
    // The old guard was `page.state === 'paid'`, written only at the END of
    // provisioning. A crash in between left a businesses row whose slug is
    // deterministic, so every Stripe retry died on the UNIQUE constraint and
    // the paying customer was wedged permanently.
    expect(prov).toMatch(/claim_stripe_provision/)
    expect(prov).toMatch(/finish_stripe_provision/)
    expect(prov).toMatch(/fail_stripe_provision/)
    // Legacy belt-and-braces for sessions provisioned before the ledger.
    expect(prov).toMatch(/page\.state === 'paid'/)
  })

  it('every write on the resume path tolerates a conflict and is error-checked', () => {
    for (const table of ['feature_flags', 'review_settings', 'team_members']) {
      expect(prov).toMatch(new RegExp(`from\\('${table}'\\)[\\s\\S]{0,400}upsert`))
    }
    // ignoreDuplicates on review_settings is load-bearing: a plain upsert would
    // regenerate inbound_token and break any Zapier URL already issued.
    expect(prov).toMatch(/onConflict: 'business_id', ignoreDuplicates: true/)
    expect(prov).toMatch(/team member failed/)
  })

  it('queues a sender number, or the paid account can never send', () => {
    expect(prov).toMatch(/ensureNumberRequest/)
    expect(prov).toMatch(/review_number_requests/)
  })

  it('emails the buyer — never inline-only', () => {
    expect(prov).toMatch(/sendReviewsWelcome/)
    // A Resend 429 throws; letting it propagate would 500 the webhook, Stripe
    // would retry, the ledger would short-circuit, and the email would never send.
    expect(prov).toMatch(/sendReviewsWelcome\(businessId\)\.catch/)
    expect(read('api/cron/notify-drain.ts')).toMatch(/drainReviewsWelcome/)
  })

  it('recovers the user on duplicate-email instead of dropping a paid customer', () => {
    expect(prov).toMatch(/findUserByEmail/)
    expect(prov).toMatch(/listUsers/)
  })

  it('throws on unexpected failure so Stripe retries (no silent 200)', () => {
    expect(prov).toMatch(/throw new Error\(`VSL provision/)
  })

  it('new accounts get the reviews flag + review_settings like register.ts', () => {
    expect(prov).toMatch(/flag_key: 'reviews'/)
    expect(prov).toMatch(/review_settings/)
    expect(prov).toMatch(/inbound_token/)
  })

  it('only claims an UNLINKED crm contact', () => {
    expect(prov).toMatch(/\.is\('business_id', null\)/)
  })
})

describe('security fixes from adversarial review', () => {
  it('vsl-page reads the contact through the CALLER client so RLS enforces ownership', () => {
    const p = read('api/crm/vsl-page.ts')
    expect(p).toMatch(/caller\s*\n?\s*\.from\('wk_contacts'\)/)
    expect(p).toMatch(/not yours/)
  })

  it('vsl-page honours the master switch (no new pages while dark)', () => {
    expect(read('api/crm/vsl-page.ts')).toMatch(/!settings\.enabled/)
  })

  it('checkout sessions self-expire so stale tabs cannot be paid later', () => {
    expect(read('api/vsl/checkout.ts')).toMatch(/expires_at/)
  })

  it('the queued-SMS worker normalises phones to E.164', () => {
    const w = read('supabase/functions/wk-jobs-worker/index.ts')
    expect(w).toMatch(/normalizeE164\(contactRow\.phone\)/)
    expect(w).toMatch(/function normalizeE164/)
  })
})

describe('atomic state advance (concurrency fix)', () => {
  const rpc = read('supabase/migrations/20260725000002_vsl_advance_rpc.sql')
  const lib = read('api/lib/vsl-settings.ts')

  it('advances under a row lock, forward-only, in the database', () => {
    expect(rpc).toMatch(/for update/)
    expect(rpc).toMatch(/wk_vsl_rank\(p_target\) > wk_vsl_rank\(r\.state\)/)
    expect(rpc).toMatch(/greatest\(watched_pct/)
    expect(rpc).toMatch(/open_count \+ \(case when p_bump_open/)
  })

  it('advanceVslState calls the RPC, not a JS read-modify-write', () => {
    expect(lib).toMatch(/rpc\('wk_vsl_advance'/)
    expect(lib).not.toMatch(/patch\.state = target/)
  })
})

describe('cron double-text safety', () => {
  const cron = read('api/cron/vsl-automation.ts')

  it('records the nudge BEFORE enqueuing (a lost job beats a double-text)', () => {
    const bookIdx = cron.indexOf("update({ automation: auto })")
    const jobIdx = cron.indexOf("kind: 'send_sms'")
    expect(bookIdx).toBeGreaterThan(0)
    expect(bookIdx).toBeLessThan(jobIdx)
  })

  it('orders deterministically so pages past the cap are not starved', () => {
    expect(cron).toMatch(/order\('updated_at', \{ ascending: true \}\)/)
  })

  it('falls back to a workspace line when the agent has none', () => {
    // agentSmsLine moved to api/lib/vsl-settings.ts on 2026-07-27 so the nudge
    // cron and the auto-send cron resolve the same from-line — two funnel texts
    // arriving from two different numbers read as two different companies.
    expect(read('api/lib/vsl-settings.ts')).toMatch(/fallback/)
    expect(cron).toMatch(/agentSmsLine\(/)
  })
})

describe('automation cron', () => {
  const cron = read('api/cron/vsl-automation.ts')

  it('uses the Node (req,res) shape, not the edge Request API', () => {
    expect(cron).not.toMatch(/req\.headers\.get\(/)
    expect(cron).toMatch(/ServerResponse/)
  })

  it('is CRON_SECRET-gated', () => {
    expect(cron).toMatch(/CRON_SECRET/)
    expect(cron).toMatch(/401/)
  })

  it('respects master toggle, quiet hours, per-agent opt-out and max sends', () => {
    expect(cron).toMatch(/settings\.enabled/)
    expect(cron).toMatch(/insideQuietHours/)
    expect(cron).toMatch(/agent_disabled\.includes/)
    // max_sends moved into the shared schedule on 2026-07-27 (api/lib/vsl-sequence.ts)
    // so the cron and the drawer count sends the same way. See tests/vsl-sequence.test.ts.
    expect(read('api/lib/vsl-sequence.ts')).toMatch(/count >= rule\.max_sends/)
  })

  it('rides the existing send_sms job with reply-cancel', () => {
    expect(cron).toMatch(/kind: 'send_sms'/)
    expect(cron).toMatch(/skip_if_inbound_after/)
  })

  it('sends from the owning agent line when one exists', () => {
    expect(read('api/lib/vsl-settings.ts')).toMatch(/wk_number_agents/)
    expect(cron).toMatch(/await agentSmsLine\(page\.agent_id\)/)
  })
})

describe('AI replies know the funnel', () => {
  const ai = read('api/crm/ai-reply.ts')

  it('injects the lead page + stage into the system prompt', () => {
    expect(ai).toMatch(/VIDEO FUNNEL CONTEXT/)
    expect(ai).toMatch(/wk_vsl_pages/)
    expect(ai).toMatch(/hesitating at the card/)
  })

  it('never sells to someone who already paid', () => {
    expect(ai).toMatch(/do NOT sell/)
  })
})

describe('CRM UI wiring', () => {
  it('the dialer contact panel has the Send video button', () => {
    const meta = read('src/features/crm/components/live-call/ContactMetaCompact.tsx')
    expect(meta).toMatch(/<VideoLinkButton contact=\{contact\} \/>/)
  })

  it('the send flow reuses the same wk-sms-send path as manual texts', () => {
    const btn = read('src/features/crm/components/live-call/VideoLinkButton.tsx')
    expect(btn).toMatch(/wk-sms-send/)
    expect(btn).toMatch(/mark_sent: true/)
  })

  it('the funnel board route + nav item exist', () => {
    expect(read('src/features/crm/CrmApp.tsx')).toMatch(/video-funnel/)
    expect(read('src/features/crm/layout/Smsv2Sidebar.tsx')).toMatch(/Video funnel/)
  })

  it('the board subscribes to realtime page changes', () => {
    const board = read('src/features/crm/pages/VideoFunnelPage.tsx')
    expect(board).toMatch(/postgres_changes/)
    expect(board).toMatch(/wk_vsl_pages/)
    expect(board).toMatch(/WATCHING NOW/)
  })

  it('the settings drawer surfaces the draft-mode trap that killed 15 replies', () => {
    const board = read('src/features/crm/pages/VideoFunnelPage.tsx')
    expect(board).toMatch(/DRAFT mode/)
    expect(board).toMatch(/ai_reply_mode/)
  })
})

describe('migration', () => {
  const sql = read('supabase/migrations/20260725000001_vsl_funnel.sql')

  it('pages are agent-readable, service-role writable only', () => {
    expect(sql).toMatch(/agent_id = auth\.uid\(\)/)
    expect(sql).not.toMatch(/for insert/i)
    expect(sql).not.toMatch(/for update/i)
  })

  it('one page per contact', () => {
    expect(sql).toMatch(/unique index if not exists wk_vsl_pages_contact_idx/)
  })

  it('creates the six board columns idempotently', () => {
    for (const c of ['Video sent', 'Opened page', 'Watched video', 'Clicked button', 'Checkout started', "'Paid'"]) {
      expect(sql).toContain(c)
    }
    expect(sql).toMatch(/where not exists/)
  })

  it('realtime is on for the board', () => {
    expect(sql).toMatch(/alter publication supabase_realtime add table wk_vsl_pages/)
  })
})

/* ================= render pipeline (Hugo 2026-07-26) ================= */

describe('render pipeline — lib', () => {
  const load = async () => import('../api/lib/vsl-settings')

  it('maps render statuses to the two review columns (failed stays put)', async () => {
    const { VSL_RENDER_TO_COLUMN } = await load()
    expect(VSL_RENDER_TO_COLUMN.queued).toBe('Rendering')
    expect(VSL_RENDER_TO_COLUMN.rendering).toBe('Rendering')
    expect(VSL_RENDER_TO_COLUMN.ready).toBe('Ready to send')
    expect(VSL_RENDER_TO_COLUMN.failed).toBeUndefined()
  })

  it('orders the board Rendering → Ready to send → Video sent … Paid', async () => {
    const { VSL_COLUMN_ORDER } = await load()
    const i = (n: string) => VSL_COLUMN_ORDER.indexOf(n)
    expect(i('Rendering')).toBe(0)
    expect(i('Ready to send')).toBe(1)
    expect(i('Video sent')).toBe(2)
    expect(i('Rendering')).toBeLessThan(i('Paid'))
  })

  it('worker duplicates the exact same column order (lockstep guard)', async () => {
    const { VSL_COLUMN_ORDER } = await load()
    const worker = read('scripts/vsl-render-worker.mjs')
    const m = worker.match(/const COLUMN_ORDER = \[([\s\S]*?)\]/)
    expect(m).toBeTruthy()
    const workerOrder = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(workerOrder).toEqual(VSL_COLUMN_ORDER)
  })

  it('no-website SMS variant carries the free-website offer (reinstated 2026-07-27)', async () => {
    const { DEFAULT_VSL_SETTINGS, fillTemplate } = await load()
    // History, so nobody "fixes" this back: the offer shipped, was WITHDRAWN on
    // 2026-07-26, and was REINSTATED by Hugo on 2026-07-27 ("if you don't have
    // one, you can make one for free, just let us know"). It rides the
    // no-website variant only.
    expect(DEFAULT_VSL_SETTINGS.send_template_no_site).toMatch(/for free/i)
    expect(DEFAULT_VSL_SETTINGS.send_template_no_site).toMatch(/couldn't find a website/i)
    // Never on the variant for a lead who already has a site.
    expect(DEFAULT_VSL_SETTINGS.send_template).not.toMatch(/for free/i)
    const out = fillTemplate(DEFAULT_VSL_SETTINGS.send_template_no_site, {
      first: 'Kate', business: 'K Plumbing', url: 'https://heyelsie.com/k', agent: 'Pedro',
    })
    expect(out).toContain('https://heyelsie.com/k')
    expect(out).not.toMatch(/\{[a-z_]+\}/)
  })
})

describe('render pipeline — API gates', () => {
  const src = read('api/crm/vsl-page.ts')

  it('mark_sent refuses a page with nothing to play (review gate)', () => {
    expect(src).toMatch(/if \(!page\.video_url && !settings\.default_video_url\)/)
    expect(src).toMatch(/no_video/)
    // the gate sits BEFORE the state advance
    expect(src.indexOf('no_video')).toBeLessThan(src.indexOf("advanceVslState(page, 'sent')"))
  })

  it('request_render only queues from null/failed (idempotent)', () => {
    expect(src).toMatch(/!page\.render_status \|\| page\.render_status === 'failed'/)
  })

  it('dark funnel: pages/renders allowed, sending blocked', () => {
    expect(src).toMatch(/!settings\.enabled && body\.mark_sent/)
  })

  it('pages record no_website at creation and pick the SMS variant off it', () => {
    expect(src).toMatch(/no_website: noWebsite/)
    expect(src).toMatch(/page\.no_website \? settings\.send_template_no_site : settings\.send_template/)
  })

  it('response mirrors the send gate so the UI can disable the button', () => {
    expect(src).toMatch(/can_send: !!\(page\.video_url \|\| settings\.default_video_url\)/)
  })
})

describe('render pipeline — migration + worker', () => {
  const mig = read('supabase/migrations/20260726000001_vsl_render.sql')
  const worker = read('scripts/vsl-render-worker.mjs')
  const unit = read('scripts/vsl-render-worker.service')

  it('adds the render lifecycle columns with a status check', () => {
    expect(mig).toMatch(/render_status text/)
    expect(mig).toMatch(/'queued', 'rendering', 'ready', 'failed'/)
    expect(mig).toMatch(/no_website boolean not null default false/)
  })

  it('inserts Rendering + Ready to send BEFORE Video sent (two-step shift)', () => {
    expect(mig).toMatch(/'Rendering'/)
    expect(mig).toMatch(/'Ready to send'/)
    expect(mig).toMatch(/position \+ 1002/) // unique-constraint-safe shift
  })

  it('worker claims atomically and requeues stale renders', () => {
    expect(worker).toMatch(/render_status=eq\.queued/) // claim is conditional
    expect(worker).toMatch(/requeueStale/)
    // 25, not 45. A render takes 6 to 8 minutes, so 45 left a card frozen on
    // "rendering" for the best part of an hour when the worker died mid-job
    // (2026-07-27: the VPS was at load 9.4 and its own mark-failed write threw,
    // so nothing recorded the failure and only this sweep could rescue it).
    expect(worker).toMatch(/STALE_MIN = 25/)
  })

  it('worker uploads to vsl-videos and writes video_url + ready', () => {
    expect(worker).toMatch(/vsl-videos/)
    expect(worker).toMatch(/render_status: 'ready'/)
    expect(worker).toMatch(/video_url: `\$\{videoUrl\}\?v=\$\{bust\}`/) // ?v= busts the CDN on re-renders
  })

  it('systemd unit is niced so the scrapers always win', () => {
    expect(unit).toMatch(/Nice=10/)
    expect(unit).toMatch(/\/usr\/bin\/node/)
  })
})

describe('render pipeline — prep + comps', () => {
  const prep = read('video/scripts/prep-lead.mjs')
  const scroll = read('video/src/comps/GoogleScrollV.tsx')
  const flow = read('video/src/FlowVideo.tsx')

  it('prep fails loudly with no town (the search is built from it)', () => {
    expect(prep).toMatch(/lead is missing town/)
    expect(prep).toMatch(/if \(!rf\.lead\.town\) \{/)
  })

  // rank is no longer required: rank-frame places the lead by REVIEW COUNT, so
  // a stored rank from a different search can't decide whether a lead renders.
  // That's what unblocks the 207 rank-1-3 leads.
  it('no longer refuses a lead just because it has no stored rank', () => {
    expect(prep).not.toMatch(/!rf\.lead\.rank/)
    expect(prep).not.toMatch(/only plumber-import leads render/)
  })

  it('refuses to invent competitors for a trade it has no vocabulary for', () => {
    expect(prep).toMatch(/if \(!PROFILE\)/)
    expect(prep).toMatch(/no trade profile for this lead/)
  })

  it('lead lands at index 18 — five audio-locked flicks reach it', () => {
    expect(prep).toMatch(/LEAD_INDEX = 18/)
    const gen = JSON.parse(read('video/src/data/lead-gen.json'))
    expect(gen.rows.findIndex((r: { isLead?: boolean }) => r.isLead)).toBe(18)
    expect(gen.rows.length).toBe(23)
  })

  it('scroll comp derives flick targets and flyback from Y_LEAD (no constants)', () => {
    expect(scroll).toMatch(/Y_LEAD \* 0\.19/)
    expect(scroll).toMatch(/Y_LEAD \/ 2/)
    expect(scroll).not.toMatch(/to: 780 \}/)
  })

  it('no-website leads render the Google-search opening instead', () => {
    expect(flow).toMatch(/gen\.no_website \? <OpeningSearchV \/> : <OpeningWebsiteV \/>/)
  })

  it('free-website offer is fully withdrawn (Hugo 2026-07-26)', () => {
    const page = read('api/vsl/page.ts')
    expect(page).not.toMatch(/free website/i)
    const settings = read('api/lib/vsl-settings.ts')
    expect(settings).not.toMatch(/build you one free/i)
    const provision = read('api/lib/vsl-provision.ts')
    expect(provision).not.toMatch(/PROMISED: free website/)
  })
})

/* ============= adversarial-review fixes (2026-07-26) ============= */

describe('SSRF + website classification', () => {
  const load = async () => import('../video/scripts/lead-url.mjs')

  it('blocks private / loopback / metadata / non-http targets', async () => {
    const { safeWebsiteUrl } = await load()
    for (const bad of [
      'http://127.0.0.1:5050/', 'http://localhost/', 'https://169.254.169.254/latest/meta-data/',
      'http://192.168.0.1/', 'http://10.0.0.5/', 'http://172.16.3.4/', 'file:///etc/passwd',
      'http://metadata.google.internal/', 'https://box.local/', 'http://[::1]/', 'gopher://x',
    ]) {
      expect(safeWebsiteUrl(bad), bad).toBeNull()
    }
  })

  it('treats social-only / directory links as no-website', async () => {
    const { safeWebsiteUrl } = await load()
    for (const social of ['https://facebook.com/joesplumbing', 'https://www.instagram.com/x', 'https://linktr.ee/x', 'https://g.page/x', 'https://checkatrade.com/x']) {
      expect(safeWebsiteUrl(social), social).toBeNull()
    }
  })

  it('accepts a real public site and forces https', async () => {
    const { safeWebsiteUrl } = await load()
    expect(safeWebsiteUrl('theboilerclubonline.co.uk')).toBe('https://theboilerclubonline.co.uk/')
    expect(safeWebsiteUrl('http://www.wolverhamptongasplumbing.co.uk/')).toBe('https://www.wolverhamptongasplumbing.co.uk/')
  })

  it('capture script refuses unsafe URLs before launching the browser', () => {
    const cap = read('video/capture-mobile-site.mjs')
    expect(cap).toMatch(/safeWebsiteUrl\(RAW_URL\)/)
    expect(cap).toMatch(/process\.exit\(2\)/)
    // the retry must use the validated url, never RAW_URL
    expect(cap).not.toMatch(/RAW_URL\.startsWith/)
  })

  it('API classifies website with the same rule (SMS matches the video)', () => {
    const src = read('api/crm/vsl-page.ts')
    expect(src).toMatch(/isCapturableWebsite/)
    expect(src).toMatch(/noWebsite = !isCapturableWebsite/)
  })
})

describe('dark-funnel send safety', () => {
  const src = read('api/crm/vsl-page.ts')
  const btn = read('src/features/crm/components/live-call/VideoLinkButton.tsx')

  it('server returns 409 (not a 200 success) when marking sent while dark', () => {
    expect(src).toMatch(/json\(409, \{\s*error: 'funnel_off'/)
  })

  it('the in-call button re-checks enabled/can_send right before texting', () => {
    expect(btn).toMatch(/Re-check the server RIGHT BEFORE sending/)
    expect(btn).toMatch(/freshInfo\.enabled === false/)
    expect(btn).toMatch(/!freshInfo\.can_send/)
  })
})

describe('button robustness', () => {
  const btn = read('src/features/crm/components/live-call/VideoLinkButton.tsx')

  it('always clears busy on lead switch (no bricked button)', () => {
    // the contact-change effect resets busy, and finallys clear unconditionally
    expect(btn).toMatch(/setBusy\(false\);[\s\S]*?setOpen\(false\)/)
    expect(btn).not.toMatch(/if \(id === contactIdRef\.current\) setBusy\(false\)/)
  })

  it('retry after a failed mark does NOT re-text the lead', () => {
    // The guard moved from a component ref to MODULE scope on 2026-07-27, when
    // the button gained a second mount in the Messages tab — two per-instance
    // refs would each keep their own memory and the lead would get it twice.
    expect(btn).toMatch(/const smsSentByContact = new Set<string>\(\)/)
    expect(btn).toMatch(/if \(!smsSentByContact\.has\(id\)\)/)
  })

  it('marks tracking even if the agent switched leads after the SMS went out', () => {
    // no lead-guard between the send and the mark
    const send = btn.indexOf("invoke('wk-sms-send'")
    const mark = btn.indexOf('mark_sent: true')
    expect(send).toBeGreaterThan(0)
    expect(mark).toBeGreaterThan(send)
  })
})

describe('board send guard', () => {
  const board = read('src/features/crm/pages/VideoFunnelPage.tsx')
  const drawer = read('src/features/crm/components/funnel/FunnelLeadDrawer.tsx')

  it('the board no longer sends at all — the composer is the one path', () => {
    // Hugo 2026-07-27: the board's green button fired a message the agent had
    // never seen. It now opens the drawer's composer. Two send paths would also
    // mean two independent "already sent" guards, and a lead texted twice.
    expect(board).not.toMatch(/invoke\('wk-sms-send'/)
    expect(board).toMatch(/setComposeForId\(p\.id\)/)
    expect(board).toMatch(/disabled=\{sentIds\.has\(p\.id\)\}/)
  })

  it('ignores double-clicks while a send is in flight', () => {
    // Module scope, not a component ref: the drawer can be closed and reopened.
    expect(drawer).toMatch(/const sendInFlight = new Set<string>\(\)/)
    expect(drawer).toMatch(/if \(sendInFlight\.has\(id\)\) return/)
    expect(drawer).toMatch(/sendInFlight\.delete\(id\)/)
  })

  it('still re-marks without re-sending after a failed mark', () => {
    expect(drawer).toMatch(/const sentByContact = new Set<string>\(\)/)
    expect(drawer).toMatch(/if \(!sentByContact\.has\(id\)\)/)
  })
})

describe('worker robustness fixes', () => {
  const worker = read('scripts/vsl-render-worker.mjs')
  it('heartbeats every 30s during the long render', () => {
    expect(worker).toMatch(/setInterval\(\(\) => \{ heartbeat/)
  })
  it('reclaims disk after uploading', () => {
    expect(worker).toMatch(/rmSync\(mp4/)
    expect(worker).toMatch(/rmSync\(jpg/)
  })
  it('does not overwrite no_website (API owns it)', () => {
    expect(worker).not.toMatch(/no_website: !!gen/)
  })
})

describe('prep data fidelity fixes', () => {
  const prep = read('video/scripts/prep-lead.mjs')
  const scroll = read('video/src/comps/GoogleScrollV.tsx')

  it('refuses to render a mostly-fabricated SERP (thin real pack)', () => {
    expect(prep).toMatch(/realAbove\.length < 3/)
  })
  it('clamps SEL_W to the 850px name ellipsis', () => {
    expect(prep).toMatch(/Math\.min\(850,/)
  })
  it('cache-busts rank-frame so retries get fresh data', () => {
    expect(prep).toMatch(/_r=\$\{Date\.now\(\)\}/)
  })
  it('puts the lead’s REAL phone on their own card', () => {
    expect(prep).toMatch(/lead_phone: fmtReal\(\)/)
    expect(scroll).toMatch(/row\.isLead[\s\S]*?gen\.lead_phone/)
  })
  it('formats ghost phones by area-code shape (02x no longer 9-digit)', () => {
    expect(scroll).toMatch(/a\.length <= 3/)
  })
  it('hides stars on null-rating rows', () => {
    expect(scroll).toMatch(/row\.rating != null \?/)
  })
})

// Hugo 2026-07-26: the examples carousel showed "Mayfair Plumbers" TWICE on
// heyelsie.com/24-7-fast-flow-plumbing-ltd — slide 1 at 17→356, slide 3 at
// 11→356. Root cause: EXAMPLES prepended a hardcoded Mayfair, but the dedupe
// set was seeded only with the live pack names + the lead's own name, so the
// 'plumbers in London' top-up handed it straight back.
describe('examples carousel — no duplicate businesses', () => {
  const page = read('api/vsl/page.ts')

  it('seeds the dedupe set with the HERO, not just the lead', () => {
    expect(page).toMatch(/new Set\(\[normBusinessName\(HERO\.name\), normBusinessName\(rawBusiness\)\]\)/)
  })

  it('routes BOTH the live pack and the big-market top-up through one guard', () => {
    // exactly one place appends to EXAMPLES
    expect(page.match(/EXAMPLES\.push\(/g) || []).toHaveLength(1)
    expect(page).toMatch(/\.forEach\(\(p\) =>\s*\n?\s*pushExample\(/)
    expect(page).toMatch(/pushExample\(asExample\(p\)\)/)
  })

  it('dedupes loosely so "Mayfair Plumbers Ltd" is caught too', async () => {
    const { normBusinessName } = await import('../api/lib/vsl-settings')
    expect(normBusinessName('Mayfair Plumbers Ltd')).toBe(normBusinessName('Mayfair Plumbers'))
    expect(normBusinessName('The Pimlico Plumbers Limited')).toBe(normBusinessName('Pimlico Plumbers'))
    expect(normBusinessName('24/7 Fast Flow Plumbing Ltd')).toBe(normBusinessName('24/7 Fast Flow Plumbing'))
  })

  it('caps the carousel so a rich pack cannot run away', () => {
    expect(page).toMatch(/MAX_EXAMPLES = 5/)
    expect(page).toMatch(/EXAMPLES\.length >= MAX_EXAMPLES/)
  })

  it('gives Mayfair its PPTX details by identity, never by name match', () => {
    // a same-named business from Google must not inherit Mayfair's London
    // address and phone number
    expect(page).toMatch(/const isMayfair = \(x: Example\) => x === HERO/)
    expect(page).not.toMatch(/x\.name === 'Mayfair Plumbers'/)
  })

  it('rank-frame and the page share ONE name-normaliser', () => {
    const rf = read('api/leads/rank-frame.ts')
    expect(rf).toMatch(/import \{ normBusinessName \} from '\.\.\/lib\/vsl-settings\.js'/)
    expect(rf).not.toMatch(/function norm\(s: string\)/)
  })
})

// Hugo 2026-07-26: go multi-trade. The 11k list was scraped entirely from
// PLUMBER searches — every row's rank/competitors is a fact about the plumber
// SERP, even the ~950 rows Google files as Electrician or Home builder. So the
// trade has to drive the Google query, the on-screen strings and the invented
// padding, or an electrician's video shows them buried among plumbers.
describe('multi-trade', () => {
  const load = async () => import('../api/lib/trades')

  it('resolves a trade from the business name before Google’s category', async () => {
    const { resolveTrade } = await load()
    // real rows from the list: Google files these as Construction Company /
    // Bathroom Renovator, but the NAME is the stronger signal
    expect(resolveTrade({ google_category: 'Construction Company' }, 'Redruth', 'Carn Brea Plumbing').key).toBe('plumber')
    expect(resolveTrade({ google_category: 'Bathroom Renovator' }, 'Havant', 'Elite Plumbing Heating Solutions').key).toBe('plumber')
    expect(resolveTrade({ google_category: 'Electrician' }, 'Skipton', 'R J TAYLOR ELECTRICAL').key).toBe('electrician')
  })

  it('an explicit niche override beats everything', async () => {
    const { resolveTrade } = await load()
    expect(resolveTrade({ niche: 'electrician', google_category: 'Plumber' }, 'Bath', 'Bob Plumbing').key).toBe('electrician')
  })

  it('builds the search term the video puts on screen', async () => {
    const { resolveTrade } = await load()
    expect(resolveTrade({ niche: 'electrician' }, 'Basingstoke').search_term).toBe('electricians in Basingstoke')
    expect(resolveTrade({ niche: 'plumber' }, 'Glossop').search_term).toBe('plumbers in Glossop')
  })

  it('rejects a street address in the Category column (scraper column-shift)', async () => {
    const { resolveTrade } = await load()
    for (const junk of ['121 Quantock Rd', '460 Shore Rd', '3 Alison Way', '29 Kingsley Rd']) {
      const t = resolveTrade({ google_category: junk }, 'Bath')
      expect(t.label).toBeNull()
      expect(t.profile).toBeNull()
    }
  })

  it('gives merchants and shops a page but NO video', async () => {
    const { resolveTrade } = await load()
    for (const c of ["Plumbers' merchant", 'Hardware Shop', 'Tool Shop', 'Corporate office']) {
      expect(resolveTrade({ google_category: c }, 'Bath').profile).toBeNull()
    }
  })

  it('shows a truthful label for a category we have not mapped yet', async () => {
    const { resolveTrade } = await load()
    const t = resolveTrade({ google_category: 'Septic system service' }, 'Bath')
    expect(t.label).toBe('Septic system service')
    expect(t.profile).toBeNull()   // truthful page, no invented video copy
  })

  it('never returns null — callers only branch on profile', async () => {
    const { resolveTrade } = await load()
    for (const cf of [null, undefined, {}, { google_category: '' }]) {
      const t = resolveTrade(cf as never, 'Bath')
      expect(t).toBeTruthy()
      expect(t.profile).toBeNull()
    }
  })

  it('every profile fits the animation budgets it feeds', async () => {
    const { TRADE_PROFILES } = await load()
    for (const [key, p] of Object.entries(TRADE_PROFILES)) {
      // ClimbSceneV is a fixed 7-row stagger
      expect(p.jobs, key).toHaveLength(7)
      // StepsSceneV types at 1.3cps inside a 104-frame gate
      expect(p.review_long.length, key).toBeLessThanOrEqual(100)
      // OfferSceneV types at 1.6cps into a minHeight:70 box
      expect(p.owner_reply.length, key).toBeLessThanOrEqual(70)
      p.review_short.forEach((r) => expect(r.length, key).toBeLessThanOrEqual(45))
      expect(p.ghost_patterns.length, key).toBeGreaterThanOrEqual(8)
    }
  })

  it('rank-frame searches the TRADE, not a stored plumber URL', async () => {
    const rf = read('api/leads/rank-frame.ts')
    expect(rf).toMatch(/resolveTrade\(cf, lead\.town, lead\.business\)/)
    expect(rf).toMatch(/localPack\(trade\.search_term\)/)
    expect(rf).not.toMatch(/google_search_url\?\.match/)   // the plumber-only signal
    expect(rf).toMatch(/trade,/)                            // returned to page + prep-lead
  })

  it('the comps read the trade instead of hardcoding "Plumber"', () => {
    const scroll = read('video/src/comps/GoogleScrollV.tsx')
    const poster = read('video/src/comps/PosterV.tsx')
    const search = read('video/src/comps/OpeningSearchV.tsx')
    const climb = read('video/src/comps/ClimbSceneV.tsx')
    for (const [name, src] of Object.entries({ scroll, poster })) {
      expect(src, name).toMatch(/gen\.trade\.label/)
      expect(src, name).not.toMatch(/<span>· Plumber<\/span>/)
    }
    expect(scroll).toMatch(/gen\.trade\.search_term/)
    expect(scroll).toMatch(/value=\{gen\.trade\.chip\}/)
    expect(search).toMatch(/const QUERY = gen\.trade\.search_term/)
    expect(climb).toMatch(/gen\.trade\.jobs\[i\]/)
  })

  it('the committed lead-gen sample carries a trade (TS infers gen from it)', () => {
    const gen = JSON.parse(read('video/src/data/lead-gen.json'))
    expect(gen.trade).toBeTruthy()
    expect(gen.trade.jobs).toHaveLength(7)
    expect(gen.trade.search_term).toContain(gen.town)
  })
})

describe('examples carousel — the hero follows the lead’s trade', () => {
  const page = read('api/vsl/page.ts')

  it('only leads with the plumber hero for plumbing-family leads', () => {
    // Mayfair Plumbers heading an electrician's page is the same niche mismatch
    // as labelling their Google cards "· Plumber".
    expect(page).toMatch(/const heroFits = !trade \|\| trade\.profile_key === 'plumbing'/)
    expect(page).toMatch(/if \(heroFits \|\| EXAMPLES\.length < 2\) EXAMPLES\.unshift\(HERO\)/)
  })

  it('still shows the hero when the live fetch gave us nothing to stand on', () => {
    expect(page).toMatch(/EXAMPLES\.length < 2/)
  })

  it('keeps the hero in the dedupe set even when it is not shown', () => {
    expect(page).toMatch(/new Set\(\[normBusinessName\(HERO\.name\), normBusinessName\(rawBusiness\)\]\)/)
  })

  it('tops up from the LEAD’s trade, not always London plumbers', () => {
    expect(page).toMatch(/bigMarketExamples\(trade\?\.plural \|\| 'plumbers'\)/)
    expect(page).toMatch(/\$\{plural\} in London/)
  })
})

describe('render robustness', () => {
  const prep = read('video/scripts/prep-lead.mjs')

  // A lead whose site is dead / bot-walled / never settles is exactly the lead
  // most worth calling. Losing their whole video over it is the wrong trade.
  it('a failed site capture falls back to the search scene, not a dead render', () => {
    expect(prep).toMatch(/falling back to the search scene/)
    expect(prep).toMatch(/noWebsite = true/)
    // noWebsite has to be reassignable for the fallback to work
    expect(prep).toMatch(/let noWebsite = !safeSite/)
  })
})

// Hugo 2026-07-26: Google Places never returns an owner name, so a scraped
// trade list opens "Hi," instead of "Hi Dave,". Companies House fills it — but
// docs/PLUMBER_LEADS_PIPELINE.md is explicit that a WRONG first name in the
// opener is worse than none, so the matcher has to stay conservative.
describe('owner-name enrichment (Companies House)', () => {
  const enrich = read('scripts/enrich-owner-names.mjs')
  const scrape = read('scripts/scrape-trade-leads.mjs')

  it('only accepts an EXACT name match on an ACTIVE company', () => {
    expect(enrich).toMatch(/norm\(i\.title\) === target && i\.company_status === 'active'/)
  })

  it('refuses to guess between two same-named live companies', () => {
    expect(enrich).toMatch(/if \(inTown\.length !== 1\) return \{ ambiguous/)
  })

  it('skips corporate officers — a company is not a person to greet', () => {
    expect(enrich).toMatch(/o\.date_of_birth/)
    expect(enrich).toMatch(/!o\.resigned_on/)
  })

  it('never writes a low-confidence match', () => {
    expect(enrich).toMatch(/found\.filter\(\(x\) => x\.confidence !== 'low'\)/)
  })

  it('does NOT gate on the registered address matching the town', () => {
    // Small trades register at their accountant's office — ALB Electrical
    // trades in Winchester and is registered in Eastleigh. A town gate would
    // throw away most genuine matches, so the town is only consulted to break
    // a tie between two same-named live companies.
    const primaryFilter = enrich.match(/let hits = search\.items\.filter\([\s\S]*?\)\n/)?.[0] ?? ''
    expect(primaryFilter).toBeTruthy()
    expect(primaryFilter).not.toMatch(/town/i)
    // ...and the ONLY place town appears is the ambiguity tiebreak
    expect(enrich).toMatch(/const inTown = hits\.filter/)
  })

  it('the scraper MERGES custom_fields so a phone collision cannot wipe owner_name', () => {
    expect(scrape).toMatch(/\.\.\.\(existingCf\.get\(phone\) \|\| \{\}\), \.\.\.custom_fields/)
    expect(scrape).not.toMatch(/upsert\(\{ name: l\.name, phone, custom_fields \}/)
  })

  it('re-reads custom_fields immediately before writing, not the pre-run snapshot', () => {
    // Same family of bug as the scraper's clobber: custom_fields is written as
    // ONE whole column, so anything built on a stale copy reverts every key it
    // didn't know about. The lookup loop runs ~700ms a lead, so on a full list
    // the snapshot is half an hour old by the time it's written back — long
    // enough for an agent to have saved a call note that would vanish.
    const writeLoop = enrich.slice(enrich.indexOf('let wrote = 0'))
    expect(writeLoop).toMatch(/select\('custom_fields'\)\.eq\('id', f\.id\)/)
    expect(writeLoop).toMatch(/\.\.\.\(fresh\.custom_fields \|\| \{\}\)/)
    // the stale snapshot must not be the thing that gets spread
    expect(writeLoop).not.toMatch(/leads\.find/)
  })
})

// Hugo 2026-07-26: the actor circle parked mid-right for the whole video and
// sat on top of whatever each scene was pointing at — the Google-support
// highlight, the logo grid, the three step dots, the closing headline. It now
// rides the right-hand edge and re-parks per scene.
describe('actor circle — per-scene parking', () => {
  const flow = read('video/src/FlowVideo.tsx')
  const load = async () => import('../video/src/theme')
  // the scene cuts the parks are supposed to track
  const sceneStarts = [...flow.matchAll(/<Sequence from=\{(\d+)\}/g)].map((m) => Number(m[1]))

  it('re-parks on a scene cut, never mid-scene', async () => {
    const { CIRCLE_PARKS } = await load()
    expect(sceneStarts.length).toBeGreaterThan(4)
    // park 0 is where the intro slide lands; every later one must sit exactly
    // on a cut, or the circle slides while the viewer is reading
    for (const p of CIRCLE_PARKS.slice(1)) expect(sceneStarts).toContain(p.at)
  })

  it('finishes the intro slide before the first cut', async () => {
    const { CIRCLE_PARKS } = await load()
    expect(CIRCLE_PARKS[0].at).toBeLessThanOrEqual(Math.min(...sceneStarts.filter((s) => s > 0)))
  })

  it("never parks under the page's floating buy button", async () => {
    const { CIRCLE_PARKS, CIRCLE } = await load()
    // the button covers roughly the last 130px of the 1920-tall canvas
    for (const p of CIRCLE_PARKS) expect(p.y + CIRCLE / 2).toBeLessThanOrEqual(1720)
  })

  it('stays right of centre, clear of the bottom-left subtitles', async () => {
    const { CIRCLE_X, CIRCLE, W } = await load()
    expect(CIRCLE_X - CIRCLE / 2).toBeGreaterThan(W / 2)
    expect(CIRCLE_X + CIRCLE / 2).toBeLessThanOrEqual(W)
  })

  it('keeps the SERP scene HIGH — the lead\'s own card is the low one', async () => {
    // "…and there you are, near the bottom" is the single most important frame
    // in the video. A low park covers it.
    const { CIRCLE_PARKS } = await load()
    expect(CIRCLE_PARKS[0].y).toBeLessThan(1100)
  })

  it('clears the centred content the later scenes put at y~950', async () => {
    const { CIRCLE_PARKS, CIRCLE } = await load()
    for (const p of CIRCLE_PARKS.slice(1)) expect(p.y - CIRCLE / 2).toBeGreaterThan(1000)
  })

  it('glides between parks instead of jumping', async () => {
    const { CIRCLE_GLIDE } = await load()
    expect(CIRCLE_GLIDE).toBeGreaterThan(8)
    const bubble = read('video/src/comps/PedroBubbleV.tsx')
    expect(bubble).toMatch(/CIRCLE_PARKS/)
    expect(bubble).toMatch(/interpolate\(frame, PARK_FRAMES, PARK_YS/)
  })
})

// Hugo 2026-07-26: "we need the timing bar showing at all times, so user know
// how long until the end of the video".
describe('vsl player — progress bar', () => {
  const page = read('api/vsl/page.ts')

  it('never auto-hides during playback', () => {
    expect(page).not.toMatch(/classList\.add\('hid'\)/)
    expect(page).not.toMatch(/\.vbar\.hid/)
  })

  it('shows elapsed AND total, so the end is visible', () => {
    expect(page).toMatch(/fmtT\(v\.currentTime\)\+' \/ '\+fmtT\(v\.duration\)/)
  })

  it('knows the length before the first timeupdate tick', () => {
    expect(page).toMatch(/loadedmetadata/)
  })

  it('is visible on the POSTER, not only once playing', () => {
    // Hugo: "that only when i click, i want it to be there even if i dont click"
    expect(page).not.toMatch(/\.stage \.vbar\{display:none\}/)
    // and it must out-stack the poster overlay + its "Watch" badge (z-index 1),
    // or it renders underneath and is invisible anyway
    expect(page).toMatch(/\.vbar\{position:absolute;z-index:2/)
  })

  it('the always-on scrubber actually starts the video', () => {
    // over the poster the video is hidden, so a seek with no play() looks dead
    expect(page).toMatch(/if\(!stage\.classList\.contains\('playing'\)\)play\(\)/)
  })

  it('never renders NaN:NaN while the duration is unknown', () => {
    expect(page).toMatch(/function fmtT\(s\)\{if\(!isFinite\(s\)\|\|s<0\)s=0/)
  })
})
