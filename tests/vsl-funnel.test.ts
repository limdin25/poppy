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
    expect(fillTemplate('Hi {first}', {})).toBe('Hi there')
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
    expect(page).toMatch(/esc\(page\.business_name\)/)
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

  it('charges £1 today with a 10-day trial on the subscription', () => {
    expect(checkout).toMatch(/VSL_POUND_PRICE/)
    expect(checkout).toMatch(/trial_period_days: 10/)
    expect(checkout).toMatch(/payment_method_collection: 'always'/)
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

  it('is idempotent — a duplicate delivery for a paid page is a no-op', () => {
    expect(prov).toMatch(/page\.state === 'paid'\) return/)
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
    expect(cron).toMatch(/fallback/)
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
    expect(cron).toMatch(/count >= rule\.max_sends/)
  })

  it('rides the existing send_sms job with reply-cancel', () => {
    expect(cron).toMatch(/kind: 'send_sms'/)
    expect(cron).toMatch(/skip_if_inbound_after/)
  })

  it('sends from the owning agent line when one exists', () => {
    expect(cron).toMatch(/wk_number_agents/)
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
