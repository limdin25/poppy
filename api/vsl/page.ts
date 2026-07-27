// heyelsie.com/{slug} — the per-lead VSL page. Server-rendered (Node runtime,
// report.ts pattern) so crawlers get real OG tags for the SMS link preview.
// One headline, one vertical video, ONE button (A/B label) → tier sheet →
// Stripe. Beacons: open / play / progress 10-25-50-75-90-100 / cta_click /
// tier_pick / calc. The SMS link CLICK is logged here, server-side.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { getVslSettings, VSL_PRICES, normBusinessName, advanceVslState } from '../lib/vsl-settings.js';
import { notifyFunnelEvent } from '../lib/vsl-notify.js';
import { POUND_ENTRY_GBP, CHEAPEST_PLAN_GBP, CHEAPEST_ANNUAL_GBP, TRIAL_DAYS, BADGE_LABEL } from '../lib/review-plans.js';

// Derived once — the ROI calculator used to hardcode £1,188 in two places
// (server copy + inline JS), so a price change silently broke the maths.
const ANNUAL_STR = CHEAPEST_ANNUAL_GBP.toLocaleString('en-GB');
const DEFAULT_JOB_VALUE = 300;
const INITIAL_BE = Math.ceil(CHEAPEST_ANNUAL_GBP / DEFAULT_JOB_VALUE);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

// big-market top-up for the examples carousel (lead-independent, cached per
// warm lambda): real UK plumbing businesses with 300+ reviews
const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY || process.env.VITE_GOOGLE_PLACES_KEY || '';
interface BigExample { name: string; rating: number | null; reviews: number }
const bigMarketCache = new Map<string, BigExample[]>();
async function bigMarketExamples(plural = 'plumbers'): Promise<BigExample[]> {
  const cached = bigMarketCache.get(plural);
  if (cached) return cached;
  if (!GOOGLE_KEY) return [];
  const r = await fetch(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${plural} in London`)}&region=uk&key=${GOOGLE_KEY}`,
    { headers: { Referer: 'https://poppy-henna.vercel.app/' }, signal: AbortSignal.timeout(2500) },
  );
  const j = (await r.json()) as {
    status?: string;
    results?: Array<{ name?: string; rating?: number; user_ratings_total?: number }>;
  };
  if (j.status !== 'OK' || !j.results) return [];
  const built = j.results
    .filter((x) => x.name && typeof x.user_ratings_total === 'number' && x.user_ratings_total > 300)
    .map((x) => ({
      name: x.name as string,
      rating: typeof x.rating === 'number' ? x.rating : null,
      reviews: x.user_ratings_total as number,
    }));
  bigMarketCache.set(plural, built);
  return built;
}

/** Beacon token: proves the sender actually loaded this page.
 *
 *  page_id is printed in the public HTML and slugs are guessable business
 *  names, so anyone could previously replay beacons — and a forged
 *  progress{pct:95} flips state to 'watched', which makes the automation cron
 *  text a REAL lead about a video they never opened. Bucketed by hour so a
 *  token is not a permanent key; track.ts accepts this hour or the last.
 *
 *  Deliberately not a defence against the lead themselves — only against
 *  scripted replay by someone who never opened the page. */
export function beaconToken(pageId: string, hourBucket?: number): string {
  const secret = process.env.VSL_BEACON_SECRET || '';
  if (!secret) return '';
  const bucket = hourBucket ?? Math.floor(Date.now() / 3_600_000);
  return createHmac('sha256', secret).update(`${pageId}:${bucket}`).digest('hex').slice(0, 32);
}

/** Is this request a human tapping the link, or a machine fetching a preview?
 *
 *  User-Agent is NOT enough. iMessage builds its rich preview with a stock
 *  Safari UA — indistinguishable from a real visitor — and it fires the moment
 *  the SMS is DELIVERED. Left unfiltered, Hugo would get "they clicked!"
 *  seconds after every send to an iPhone, forever, and the dedupe would burn
 *  the genuine first click permanently.
 *
 *  Real browser navigations carry Sec-Fetch-Dest: document. Apple's and
 *  Google's preview fetchers send no Sec-Fetch-* headers at all. */
function isHumanNavigation(req: IncomingMessage): boolean {
  const h = req.headers;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
  // No req.method check existed here at all — a scanner's HEAD would have counted.
  if ((req.method || 'GET').toUpperCase() !== 'GET') return false;
  if (one(h['sec-fetch-dest']).toLowerCase() !== 'document') return false;
  const purpose = `${one(h['sec-purpose'])} ${one(h['purpose'])} ${one(h['x-purpose'])}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return false;
  // Belt and braces on top of the header gate — the loud self-identifiers.
  const ua = one(h['user-agent']).toLowerCase();
  if (/bot|crawl|spider|facebookexternalhit|whatsapp|twitterbot|slackbot|discordbot|curl|wget|headlesschrome|preview/.test(ua)) return false;
  return true;
}

/** Record the SMS link being tapped. Hugo kept the pretty link (no redirect
 *  hop), so the page request IS the click. Awaited before res.end(): there is
 *  no waitUntil in this stack and the container freezes once the response
 *  completes, so a fire-and-forget promise may never run. */
/** Is this us, or the lead?
 *
 *  Hugo 2026-07-26: opening a lead's page from the funnel board moved their
 *  card to "Opened" — the board was reporting our own staff on it. `?p=1`
 *  alone wasn't enough, because the link gets copied, pasted and shared
 *  without it. So the FIRST staff visit drops a long-lived cookie and every
 *  later visit from that browser is recognised as internal, flag or no flag. */
const STAFF_COOKIE = 'elsie_staff';

/** Hosts that only WE are ever on. A lead arrives from an SMS (no referrer) or
 *  types the address; they never arrive from inside the CRM. */
const INTERNAL_REFERRERS = ['app.heyelsie.com', 'go.heyelsie.com'];

function isStaffView(req: IncomingMessage, url: URL): boolean {
  // 1. The explicit flag the board's own links carry.
  if (url.searchParams.get('p') === '1') return true;
  // 2. This browser has previewed before — covers a copied link pasted later.
  if (new RegExp(`(?:^|;\\s*)${STAFF_COOKIE}=1`).test(String(req.headers.cookie || ''))) return true;
  // 3. Clicked through from the CRM itself. Catches a device with no cookie
  //    yet — a phone, a second laptop, an incognito window — which would
  //    otherwise be counted as the lead.
  const ref = String(req.headers.referer || req.headers.referrer || '');
  return INTERNAL_REFERRERS.some((h) => ref.includes(h));
}

async function logLinkClick(
  req: IncomingMessage,
  url: URL,
  page: { id: string; contact_id: string; state: string } & Record<string, unknown>,
  staff: boolean,
): Promise<void> {
  // Staff views are recorded but NEVER advance the funnel — the drawer shows
  // them greyed, like a link-preview bot, so "did anyone look at this?" is
  // still answerable without the board lying about the lead.
  if (staff) {
    await supabase.from('wk_vsl_events').insert({
      page_id: page.id,
      type: 'link_click',
      meta: { internal: true },
    });
    return;
  }

  const human = isHumanNavigation(req);
  const from = url.searchParams.get('from') || undefined;

  const { error } = await supabase.from('wk_vsl_events').insert({
    page_id: page.id,
    type: 'link_click',
    // Bots are logged, not counted — keeping them visible is how we tune the gate.
    meta: { bot: !human || undefined, from, ua: String(req.headers['user-agent'] || '').slice(0, 200) },
  });
  if (error) console.error('[vsl/page] link_click insert failed:', error);
  if (!human) return;

  // Stripe's cancel_url re-enters this page; that is a return, not an arrival.
  if (from === 'stripe') return;

  // Only the FIRST click writes the page row. wk_vsl_pages has a before-update
  // trigger on updated_at, and vsl-automation orders by updated_at ASC so that
  // pages past its cap are not starved — bumping on every render would push a
  // heavily-previewed page permanently to the back of its own nudge queue.
  if (page.first_click_at) return;
  const r = await advanceVslState(page, null, { link_click: true });
  if (r?.first_click) {
    await notifyFunnelEvent({ page, kind: 'vsl_link_click' });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'https://heyelsie.com');
  const slug = (url.searchParams.get('slug') || '').toLowerCase();

  const bounce = () => {
    res.statusCode = 302;
    res.setHeader('Location', 'https://heyelsie.com/welcome');
    res.end();
  };
  if (!slug) return bounce();

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (!page) return bounce();

  const staff = isStaffView(req, url);
  if (staff) {
    // Remember this browser so a copied link opened later is still recognised
    // as ours. Lax + a year; it carries no identity, only "don't count me".
    res.setHeader('Set-Cookie',
      `${STAFF_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
  }

  // The click, before anything slow. Never let tracking break the page for a
  // prospect — a thrown error here would blank a live sales page.
  await logLinkClick(req, url, page, staff).catch((e) => console.error('[vsl/page] click log failed:', e));

  const settings = await getVslSettings();
  const videoUrl = page.video_url || settings.default_video_url;
  // Real first name, or nothing — the business name personalises the no-name
  // case (a fake "there" reads like spam). See fillTemplate for the SMS side.
  // raw* feed strings that get esc()'d at emission (og/title) — escaping the
  // ingredients AND the result double-encoded "&" names in SMS link previews.
  const rawFirst = String(page.owner_first || '').split(' ')[0];
  const rawBusiness = String(page.business_name ?? '');
  const first = esc(rawFirst);
  const business = esc(rawBusiness);
  const town = esc(page.town || 'your area');
  const ctaLabel = esc(
    page.cta_variant === 'b' ? settings.cta_labels.b : settings.cta_labels.a,
  );

  const ogTitle = rawFirst ? `${rawFirst}, I made this video for ${rawBusiness}` : `I made this video for ${rawBusiness}`;
  const ogDesc = `A 2-minute look at where ${rawBusiness} sits on Google, and how to climb.`;
  const ogImage = page.og_image_url || '';
  // player poster: the render's own first frame beats the OG card
  const poster = page.poster_url || ogImage;

  // "Examples of businesses that invest in reviews" — Hugo 2026-07-26:
  // wording is everything. These are EXAMPLES, never client claims. Mayfair
  // (his PPTX pair) leads; then up to 5 REAL same-niche businesses from the
  // lead's own live Google pack (rank-frame, edge-cached 24h), 300+ reviews
  // only, real names + real current counts. The small "before" count and the
  // "≈N% more calls" line are deterministic per name (illustrative). A failed
  // fetch just means Mayfair stands alone.
  // Dedupe is name-based and LOOSE (normBusinessName strips Ltd/Limited/plc),
  // because the same company reaches us from three sources — the hardcoded
  // hero, the lead's own live pack, and the big-market top-up — under slightly
  // different names. The `seen` set is seeded with the HERO and the lead: not
  // seeding the hero is what put "Mayfair Plumbers" on the page twice, once at
  // 17→356 and again at 11→356 (Hugo spotted it 2026-07-26).
  interface Example { name: string; rating: number | null; before: number; after: number; pct: number }
  const hash = (s: string) => [...s].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7);
  const HERO: Example = { name: 'Mayfair Plumbers', rating: 4.8, before: 17, after: 356, pct: 40 };
  const MAX_EXAMPLES = 5;
  const EXAMPLES: Example[] = [];
  // seeded with the hero even when we may not show it, so a Mayfair coming back
  // from Google can't sit next to the hardcoded one
  const seen = new Set([normBusinessName(HERO.name), normBusinessName(rawBusiness)]);
  const pushExample = (x: Example) => {
    const n = normBusinessName(x.name);
    if (!n || seen.has(n) || EXAMPLES.length >= MAX_EXAMPLES) return;
    seen.add(n);
    EXAMPLES.push(x);
  };
  // The lead's trade, resolved by rank-frame (same source the video uses, so
  // the page and the video can never disagree). A failed/timed-out fetch leaves
  // it null and the Google cards simply omit the category line — a Google card
  // with no category still looks like a Google card.
  let trade: { label: string | null; plural: string; profile_key?: string | null } | null = null;
  const asExample = (p: { name: string; rating: number | null; reviews: number }): Example => {
    const h = hash(p.name);
    return { name: p.name, rating: p.rating, before: 9 + (h % 20), after: p.reviews, pct: 30 + (h % 5) * 5 };
  };
  try {
    const r = await fetch(
      `https://app.heyelsie.com/api/leads/rank-frame?contact=${encodeURIComponent(page.contact_id)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (r.ok) {
      const d = (await r.json()) as {
        pack?: Array<{ name?: string; rating?: number | null; reviews?: number | null; isLead?: boolean }>;
        trade?: { label: string | null; plural: string; profile_key?: string | null };
      };
      if (d.trade) trade = d.trade;
      (d.pack || [])
        .filter((p) => !p.isLead && p.name && typeof p.reviews === 'number' && p.reviews > 300)
        .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))
        .forEach((p) =>
          pushExample(asExample({ name: p.name as string, rating: p.rating ?? null, reviews: p.reviews as number })),
        );
    }
  } catch { /* Mayfair-only fallback */ }
  // top up from the big-market list (Hugo: "add 3 more") when the lead's own
  // town is thin on 300+ businesses. Same pushExample guard, so a London lead
  // whose pack already contains Mayfair can't get it a second time here.
  if (EXAMPLES.length < 4) {
    try {
      for (const p of await bigMarketExamples(trade?.plural || 'plumbers')) {
        if (EXAMPLES.length >= 4) break;
        pushExample(asExample(p));
      }
    } catch { /* fine — show what we have */ }
  }
  // Mayfair is a PLUMBER. Leading an electrician's page with a plumber is the
  // same niche mismatch we just fixed on the Google cards, and by this point we
  // usually have 3-4 real businesses from the lead's own trade. So the hero only
  // leads for plumbing-family leads — or when the live fetch gave us too little
  // to stand on its own.
  const heroFits = !trade || trade.profile_key === 'plumbing';
  if (heroFits || EXAMPLES.length < 2) EXAMPLES.unshift(HERO);
  EXAMPLES.splice(MAX_EXAMPLES);

  // urgency: 3 of 5 spots when the page goes out, one fewer every 24h,
  // never below 1 (Hugo 2026-07-26)
  const anchorTs = new Date(page.sent_at || page.created_at || Date.now()).getTime();
  const spotsLeft = Math.max(1, 3 - Math.floor((Date.now() - anchorTs) / 86_400_000));

  const stars = (size: number) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fbbc04"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`.repeat(5);
  const GLOBE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#1a73e8"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
  const DIRECTIONS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#1a73e8"><path d="M21.71 11.29l-9-9c-.39-.39-1.02-.39-1.41 0l-9 9c-.39.39-.39 1.02 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9c.39-.38.39-1.01 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>';

  // one FULL Google card (stars, lines, Website/Directions buttons — Hugo:
  // keep all the information, the pair just has to FIT side by side).
  // Mayfair carries its PPTX details; real businesses get real facts only.
  // Identity, not name-equality: only the hardcoded hero carries its PPTX
  // details. A same-named business arriving from Google would otherwise
  // inherit Mayfair's London address and phone number.
  const isMayfair = (x: Example) => x === HERO;
  // Mayfair IS a plumber, so it keeps that label whatever the lead does. Real
  // businesses pulled from the lead's own pack get the lead's trade.
  const labelFor = (x: Example) => (x === HERO ? 'Plumber' : trade?.label ?? null);
  const gFull = (x: Example, after: boolean) => `<div class="gcard">
    <p class="gname">${esc(x.name)}</p>
    <p class="gmeta"><b>${after && x.rating != null ? Number(x.rating).toFixed(1) : '5.0'}</b><span class="gstars">${stars(10)}</span><span>(${after ? x.after.toLocaleString('en-GB') : x.before})</span>${labelFor(x) ? `<span>· ${esc(labelFor(x))}</span>` : ''}</p>
    <p class="gsub">${isMayfair(x) ? '5+ years in business · London' : `Serves ${town} and nearby areas`}</p>
    ${isMayfair(x) ? `<p class="gsub"><span class="gopen">Open 24 hours</span> · 020 3633 1526</p>` : ''}
    <div class="gbtns">
      <div class="gbtn"><span class="gcirc">${GLOBE}</span>Website</div>
      <div class="gbtn"><span class="gcirc">${DIRECTIONS}</span>Directions</div>
    </div>
    ${after ? `<p class="gpill">≈${x.pct}% more calls a month</p>` : ''}
  </div>`;

  // one business = one carousel slide: BEFORE | AFTER side by side; dots
  // below the track page through the other examples
  const exSlide = (x: Example) => `<div class="baslide"><div class="barow">
    ${gFull(x, false)}
    <div class="baarr"><svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg></div>
    ${gFull(x, true)}
  </div></div>`;

  const ctaButton = (extra = '') =>
    `<button class="cta${extra}" onclick="cta()"><span class="ctamain">${ctaLabel}</span><span class="ctasub">£${POUND_ENTRY_GBP} today · then from £${CHEAPEST_PLAN_GBP}/month</span></button>`;

  const tiers = Object.entries(VSL_PRICES)
    .map(
      ([priceId, t]) => `
      <button class="tier${t.popular ? ' rec' : ''}" onclick="pick('${priceId}','${esc(t.label)}')">
        <span class="tl">${esc(t.label)}${t.popular ? `<em class="recpill">${BADGE_LABEL}</em>` : ''}</span>
        <span class="tr">${esc(t.requests)}</span>
        <span class="tp">${esc(t.monthly)}/month after your ${TRIAL_DAYS} days</span>
      </button>`,
    )
    .join('');

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(ogTitle)}</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta property="og:url" content="https://heyelsie.com/${esc(slug)}">
<meta name="twitter:card" content="summary_large_image">
<style>
*{box-sizing:border-box;margin:0}
/* white + blue (Hugo 2026-07-26): white predominates, blue for actions */
body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:#fff;color:#1A1A1A}
.stripe{background:#1a73e8;color:#fff;text-align:center;font-size:12.5px;font-weight:800;letter-spacing:.2px;padding:8px 14px}
.wrap{width:100%;max-width:460px;margin:0 auto;padding:14px 16px 40px}
h1{font-weight:900;font-size:clamp(18px,5vw,23px);line-height:1.25;margin:2px 0 3px;text-wrap:balance}
.sub{color:#6B7280;font-size:clamp(12px,3.4vw,14px);margin-bottom:10px}
/* The video is a compact RECTANGULAR preview (the poster shows the lead's
   site — or their Google card — behind the actor). Pressing play expands it
   IN PLACE to the vertical player (Hugo 2026-07-26: no popup — people scroll
   the page while they listen), with our custom slim controls — the native
   overlay's dark scrim never appears. */
.stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#111;box-shadow:0 12px 34px rgba(0,0,0,.16);cursor:pointer;max-height:28vh}
/* expanded: almost the whole screen, slightly squarer than 9:16, so the buy
   button still peeks below (Hugo 2026-07-26) */
/* expanded: the ENTIRE screen (Hugo 2026-07-26) — full-bleed 100dvh in the
   page flow; contain + white ground means nothing is ever cropped, and the
   glowing buy button floats over the bottom band */
.stage.playing{width:100vw;margin-left:calc(50% - 50vw);height:100vh;height:100dvh;aspect-ratio:auto;max-height:none;border-radius:0;box-shadow:none;background:#fff}
.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;display:none}
.stage.playing video{display:block}
.stage.playing .thumb{display:none}
/* the bar shows on the POSTER too (Hugo 2026-07-26: "i want it to be there
   even if i dont click") — knowing the length is what decides whether they
   press play, so it has to be readable before they do */
/* center 28% is a no-op for the exact-fit 16:9 PosterV art, but keeps the
   face framed if a legacy/fallback 9:16 frame-grab poster ever shows here */
.thumb{position:absolute;inset:0;background-size:cover;background-position:center 28%;display:flex;align-items:center;justify-content:center}
.thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.14),rgba(0,0,0,.44))}
.play{position:relative;z-index:1;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.96);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.play svg{margin-left:6px}
/* lifted clear of the always-on timing bar below it */
.badge{position:absolute;z-index:1;left:12px;bottom:60px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px}
.ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:13px}
/* custom player chrome (inside the stage) */
.vpause{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
.vpause span{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.94);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.vpause svg{margin-left:4px}
/* z-index 2 clears BOTH the poster overlay and its "Watch" badge (z-index 1) —
   without it the bar renders under the poster and is invisible until play */
.vbar{position:absolute;z-index:2;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.55);border-radius:999px;padding:0 14px;height:40px}
/* Stays up for the whole video (Hugo 2026-07-26) — a 2:35 VSL with no visible
   end in sight is a reason to leave. It sits just ABOVE the burnt-in subtitle
   band, not over it. */
.vtime{color:#fff;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.vseek{-webkit-appearance:none;appearance:none;flex:1;height:26px;background:transparent;cursor:pointer;min-width:0}
.vseek::-webkit-slider-runnable-track{height:5px;border-radius:999px;background:linear-gradient(90deg,#fff var(--p,0%),rgba(255,255,255,.35) var(--p,0%))}
.vseek::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;margin-top:-4.5px}
.vseek::-moz-range-track{height:5px;border-radius:999px;background:rgba(255,255,255,.35)}
.vseek::-moz-range-progress{height:5px;border-radius:999px;background:#fff}
.vseek::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:0}
/* the button carries the offer; one quiet trust line under it */
.cta{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;margin-top:22px;padding:17px 16px;border:0;border-radius:14px;background:#1a73e8;color:#fff;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(26,115,232,.3)}
.cta:active{transform:scale(.985)}
.ctamain{font-size:17.5px;font-weight:800}
.ctasub{font-size:12.5px;font-weight:700;opacity:.85}
.trust{text-align:center;font-size:12.5px;font-weight:700;color:#6B7280;margin-top:12px}
/* mobile: the main CTA sticks to the bottom of the screen and the
   calculator's duplicate disappears (Hugo 2026-07-26) */
@keyframes ctaglow{0%,100%{box-shadow:0 0 14px rgba(26,115,232,.45)}50%{box-shadow:0 0 32px rgba(26,115,232,.95)}}
@media(max-width:719px){
  .cta{position:fixed;left:12px;right:12px;bottom:calc(10px + env(safe-area-inset-bottom));width:auto;margin-top:0;z-index:50;padding:11px 16px;gap:2px;animation:ctaglow 2.4s ease-in-out infinite}
  .cta .ctamain{font-size:16px}
  .cta .ctasub{font-size:11.5px}
  .wrap{padding-bottom:120px}
  .trust{margin-top:16px}
  /* keep the slim bar clear of the floating button on the fullscreen video */
  .stage.playing .vbar{bottom:calc(92px + env(safe-area-inset-bottom))}
}
.proof{margin-top:22px}
.prooflabel{text-align:center;font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#6B7280;margin-bottom:8px}
.proof img{width:100%;border-radius:14px;border:1px solid #E5E7EB;display:block;box-shadow:0 6px 18px rgba(0,0,0,.08)}
/* before/after examples — FULL Google cards side by side (even at 360px),
   one business per slide, swipe or tap the dots for more (Hugo 2026-07-26) */
.ba{margin-top:48px}
.bahead{display:grid;grid-template-columns:1fr 22px 1fr;gap:8px;margin-bottom:6px}
.batag{display:block;text-align:center;font-size:11px;font-weight:900;letter-spacing:1.6px;color:#5F6368}
.batag.blue{color:#1a73e8}
.batrack{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.batrack::-webkit-scrollbar{display:none}
.baslide{flex:0 0 100%;scroll-snap-align:start;scroll-snap-stop:always}
.barow{display:grid;grid-template-columns:1fr 22px 1fr;gap:8px;align-items:stretch}
.baarr{display:flex;align-items:center;justify-content:center}
.gcard{background:#fff;border:1px solid #dadce0;border-radius:12px;padding:11px 12px;font-family:Arial,Roboto,sans-serif;box-shadow:0 3px 10px rgba(32,33,36,.06);min-width:0}
.gname{font-size:12.5px;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmeta{display:flex;align-items:center;gap:3px;font-size:10.5px;color:#5F6368;margin-top:4px;flex-wrap:wrap}
.gmeta b{color:#202124;font-weight:400}
.gstars{display:inline-flex;gap:1px}
.gsub{font-size:10.5px;color:#5F6368;margin-top:3px}
.gopen{color:#188038}
.gbtns{display:flex;gap:18px;margin-top:9px}
.gbtn{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:9.5px;font-weight:600;color:#1a73e8}
.gcirc{width:30px;height:30px;border-radius:50%;background:#fff;border:1px solid #dadce0;display:flex;align-items:center;justify-content:center}
.gpill{display:inline-block;margin-top:7px;font-size:10px;font-weight:800;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:3px 8px;font-family:Inter,-apple-system,'Segoe UI',sans-serif}
.badots{display:flex;justify-content:center;margin-top:4px}
.badot{position:relative;width:26px;height:26px;border:0;background:transparent;padding:0;cursor:pointer}
.badot::after{content:"";position:absolute;inset:9px;border-radius:50%;background:#D1D5DB}
.badot.on::after{background:#1A1A1A}
/* the value calculator — compact card that fits whole above the sticky
   button on a phone (Hugo 2026-07-26: it was showing half) */
.calc{margin-top:24px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px 16px 12px;box-shadow:0 6px 18px rgba(0,0,0,.05)}
.calchead{font-weight:900;font-size:16px;text-align:center}
.calcrow{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:10px;flex-wrap:wrap}
.calclbl{font-size:12.5px;font-weight:700;color:#6B7280;line-height:1.3}
.calclbl2{font-size:12px;font-weight:700;color:#6B7280;margin-top:10px;line-height:1.35}
.calclbl2 b{color:#1A1A1A;font-size:13.5px}
.jobval{display:flex;align-items:center;gap:8px}
.jvb{width:36px;height:36px;border-radius:50%;border:1px solid #E5E7EB;background:#F8FAFD;font-size:18px;font-weight:800;color:#1a73e8;cursor:pointer;flex-shrink:0}
.jvb:active{transform:scale(.94)}
.jvwrap{display:flex;align-items:baseline;font-weight:900;font-size:22px;font-variant-numeric:tabular-nums}
.jvwrap input{width:3.5ch;border:0;background:transparent;font:inherit;color:#1A1A1A;padding:0;outline:none;-moz-appearance:textfield}
.jvwrap input::-webkit-outer-spin-button,.jvwrap input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.njs{width:100%;margin-top:2px;height:36px;-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer;outline:none}
.njs::-webkit-slider-runnable-track{height:8px;border-radius:999px;background:linear-gradient(90deg,#1a73e8 var(--p,44%),#E5E7EB var(--p,44%))}
.njs::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;border-radius:50%;background:#1a73e8;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);margin-top:-8px}
.njs::-moz-range-track{height:8px;border-radius:999px;background:#E5E7EB}
.njs::-moz-range-progress{height:8px;border-radius:999px;background:#1a73e8}
.njs::-moz-range-thumb{width:24px;height:24px;border-radius:50%;background:#1a73e8;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.calcout{text-align:center;margin-top:6px;font-weight:900;font-size:27px;font-variant-numeric:tabular-nums}
.cvyr{font-size:14px;color:#6B7280;font-weight:800}
.calcnote{text-align:center;font-size:11.5px;font-weight:600;color:#6B7280;margin-top:4px;line-height:1.4}
/* wrappers are always flow-transparent — the desktop grid places the pieces */
.cols,.colL,.colR{display:contents}
/* extra desktop-landing CTAs (after calculator / after examples) — never on
   mobile, where the single sticky button is the one call to action */
.cta.ctad{display:none}
.foot{margin-top:52px;padding-top:18px;border-top:1px solid #E5E7EB;text-align:center}
.footlove{font-size:12.5px;font-weight:700;color:#6B7280}
.footnote{font-size:10.5px;color:#9CA3AF;margin-top:6px;line-height:1.55;max-width:640px;margin-left:auto;margin-right:auto}
/* desktop */
@media(min-width:720px){
  .wrap{max-width:680px;padding:36px 24px 64px}
  h1{font-size:27px}
  .sub{font-size:15px;margin-bottom:16px}
  .stage{max-height:42vh}
  /* desktop expanded: tall centred vertical player, back in the column */
  .stage.playing{width:auto;aspect-ratio:9/16;height:min(82vh,780px);margin-left:auto;margin-right:auto;border-radius:18px;box-shadow:0 12px 34px rgba(0,0,0,.16)}
  .cta{max-width:460px;margin-left:auto;margin-right:auto}
  .gname{font-size:14.5px}
  .gmeta{font-size:13px}
  .gpill{font-size:12px}
  .calc{padding:24px 26px}
}
/* wide desktop: a structured landing (Hugo 2026-07-26) — hero text + CTA
   LEFT, hero-sized video RIGHT; then big calculator → CTA → examples → CTA
   → footer, all centred */
@media(min-width:1024px){
  .wrap{max-width:1180px;display:grid;grid-template-columns:minmax(0,1fr) 580px;column-gap:70px;grid-template-rows:auto auto auto 1fr;grid-template-areas:"h1 stage" "sub stage" "cta stage" "trust stage" "calc calc" "cd1 cd1" "ba ba" "cd2 cd2" "foot foot";align-items:start;padding-top:56px}
  h1{grid-area:h1;font-size:44px;line-height:1.12;margin-top:8px}
  .sub{grid-area:sub;font-size:19px;margin:12px 0 26px}
  .stage{grid-area:stage;max-height:none;aspect-ratio:16/9;width:100%}
  .stage.playing{height:min(82vh,780px);width:auto;justify-self:center}
  .cta{grid-area:cta;margin:0;max-width:420px}
  .trust{grid-area:trust;text-align:left;margin-top:14px}
  .calc{grid-area:calc;width:100%;max-width:780px;margin:64px auto 0;padding:36px 44px 30px}
  .calchead{font-size:25px}
  .calclbl{font-size:15.5px}
  .calclbl2{font-size:15px;margin-top:16px}
  .calclbl2 b{font-size:17px}
  .jvb{width:44px;height:44px;font-size:21px}
  .jvwrap{font-size:30px}
  .calcout{font-size:46px;margin-top:12px}
  .cvyr{font-size:19px}
  .calcnote{font-size:14px;margin-top:8px}
  .cta.ctad{display:flex;max-width:520px;margin:30px auto 0}
  .cta.cd1{grid-area:cd1}
  .cta.cd2{grid-area:cd2}
  .ba{grid-area:ba;width:100%;max-width:880px;margin:64px auto 0}
  .proof{grid-area:ba;width:100%;max-width:880px;margin:64px auto 0}
  .foot{grid-area:foot;margin-top:64px}
}
/* z 70/71 so the tier sheet also opens above the video popup (its CTA) */
.sheetbg{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s}
.sheet{position:fixed;left:0;right:0;bottom:-100%;z-index:71;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px 30px;transition:bottom .25s;max-width:460px;margin:0 auto}
.open .sheetbg{opacity:1;pointer-events:auto}
.open .sheet{bottom:0}
.sh{font-weight:900;font-size:18px;margin-bottom:2px}
.ss{color:#6B7280;font-size:13px;margin-bottom:14px}
.tier{display:flex;flex-direction:column;width:100%;text-align:left;background:#F8FAFD;border:1.5px solid #E5E7EB;border-radius:14px;padding:14px;margin:8px 0;cursor:pointer;font-family:inherit}
.tier:active{border-color:#1a73e8}
.tier.rec{border-color:#1a73e8;background:#F3F8FF}
.recpill{display:inline-block;margin-left:8px;font-style:normal;font-size:10.5px;font-weight:800;letter-spacing:.3px;color:#fff;background:#1a73e8;border-radius:999px;padding:2px 9px;vertical-align:2px}
.tl{font-weight:800;font-size:15px}
.tr{font-size:13px;color:#374151;margin-top:2px}
.tp{font-size:12px;color:#9CA3AF;margin-top:4px}
.pound{margin-top:10px;text-align:center;font-size:13px;font-weight:700;color:#16A34A}
</style></head><body>
${staff ? `<div style="background:#1A1A1A;color:#fff;font:600 12px/1.5 system-ui,sans-serif;padding:7px 12px;text-align:center">👁 Staff preview — nothing here is tracked, this lead's card will not move</div>` : ''}
<div class="stripe spots">⏳ ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left in ${town}</div>
<div class="wrap">
  <h1>Hi ${first ? first + ' ' : ''}👋<br>I made a 2-minute video for ${business}</h1>
  <p class="sub">Where you rank on Google, and how to fix it.</p>
  <div class="cols"><div class="colL">
  <div class="stage" id="stage" onclick="stageTap()">${
    videoUrl
      ? `<video id="v" src="${esc(videoUrl)}" ${poster ? `poster="${esc(poster)}"` : ''} playsinline preload="metadata"></video>
      <div class="vpause" id="vp"><span><svg width="22" height="26" viewBox="0 0 26 30"><polygon points="0,0 26,15 0,30" fill="#14161a"/></svg></span></div>
      <div class="vbar" onclick="event.stopPropagation()">
        <span class="vtime" id="vt">0:00</span>
        <input class="vseek" id="vs" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
      </div>
      <div class="thumb"${poster ? ` style="background-image:url('${esc(poster)}')"` : ''}>
        <div class="play"><svg width="26" height="30" viewBox="0 0 26 30"><polygon points="0,0 26,15 0,30" fill="#14161a"/></svg></div>
        <div class="badge">▶ Watch · 2 min</div>
      </div>`
      : `<div class="ph">Video coming shortly</div>`
  }</div>
  ${ctaButton()}
  <p class="trust">⭐ Trusted by UK trades · Cancel anytime in your first ${TRIAL_DAYS} days</p>
  </div><div class="colR">
  <div class="calc">
    <p class="calchead">What's it worth to you?</p>
    <div class="calcrow">
      <span class="calclbl">An average job is worth</span>
      <div class="jobval">
        <button class="jvb" onclick="jvStep(-50)" aria-label="Less">−</button>
        <div class="jvwrap">£<input id="jv" type="number" inputmode="numeric" value="300" min="50" max="5000" step="50"></div>
        <button class="jvb" onclick="jvStep(50)" aria-label="More">+</button>
      </div>
    </div>
    <p class="calclbl2">If more reviews and a higher rank brought you <b id="nj">5</b> more jobs a month</p>
    <input id="njs" class="njs" type="range" min="1" max="10" step="1" value="5" aria-label="Extra jobs a month">
    <p class="calcout"><span id="cv">£18,000</span><span class="cvyr"> a year</span></p>
    <p class="calcnote" id="cn">HeyElsie costs £${ANNUAL_STR} a year. ${INITIAL_BE} extra jobs in a year covers it${INITIAL_BE <= 4 ? " — that's one every three months." : "."}</p>
  </div>
  ${ctaButton(' ctad cd1')}
  ${settings.proof_image_url ? `<div class="proof">
    ${settings.proof_caption ? `<p class="prooflabel">${esc(settings.proof_caption)}</p>` : ''}
    <img src="${esc(settings.proof_image_url)}" alt="Before and after results">
  </div>` : `<div class="ba">
    <p class="prooflabel">${esc(settings.proof_caption || 'Examples of businesses that invest in reviews')}</p>
    <div class="bahead"><span class="batag">BEFORE</span><span></span><span class="batag blue">AFTER</span></div>
    <div class="batrack" id="batrack">${EXAMPLES.map(exSlide).join('')}</div>
    ${EXAMPLES.length > 1 ? `<div class="badots">${EXAMPLES.map((_, i) => `<button class="badot${i === 0 ? ' on' : ''}" onclick="baGo(${i})" aria-label="Example ${i + 1}"></button>`).join('')}</div>` : ''}
  </div>`}
  ${ctaButton(' ctad cd2')}
  </div></div>
  <footer class="foot">
    <p class="footlove">Made with ❤️ in the United Kingdom · © 2026 HeyElsie</p>
    <p class="footnote">This site is not part of, or endorsed by, Facebook or Google. Facebook is a trademark of Meta Platforms, Inc. Google is a trademark of Google LLC. Example figures are illustrations, not guarantees.</p>
  </footer>
</div>
<div class="sheetbg" onclick="closeSheet()"></div>
<div class="sheet">
  <p class="sh">Pick your size</p>
  <p class="ss">Every plan starts with £${POUND_ENTRY_GBP} for your first ${TRIAL_DAYS} days — cancel anytime.</p>
  ${tiers}
  <p class="pound">£${POUND_ENTRY_GBP} today. Nothing else until day ${TRIAL_DAYS}.</p>
</div>
<script>
var ANNUAL=${CHEAPEST_ANNUAL_GBP};
var PAGE='${esc(page.id)}',VARIANT='${esc(page.cta_variant)}',TOKEN='${staff ? '' : esc(beaconToken(page.id))}',STAFF=${staff ? 'true' : 'false'};
/* Staff viewing their own lead's page must not move that lead's card. Every
   beacon — open, play, the watch milestones, the button click — goes through
   here, so one guard covers the lot. The token is blank too, so even a
   hand-crafted beacon from this page would be rejected. */
function send(t,extra){if(STAFF)return;try{var p=Object.assign({page_id:PAGE,type:t,variant:VARIANT,token:TOKEN},extra||{});
navigator.sendBeacon('/api/vsl/track',new Blob([JSON.stringify(p)],{type:'application/json'}))}catch(e){}}
send('open');
/* custom player — the native controls overlay (with its dark scrim) never
   appears; we draw our own slim bar. The stage expands IN PLACE so the page
   keeps scrolling while they listen. */
var v=document.getElementById('v'),stage=document.getElementById('stage'),vt=document.getElementById('vt'),
vs=document.getElementById('vs'),vp=document.getElementById('vp'),fired={};
function fmtT(s){if(!isFinite(s)||s<0)s=0;var m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x}
/* COVERAGE, not playhead. v.played is the set of ranges actually decoded, so
   dragging the seek bar to the end reports ~0 instead of 100. The seek bar
   below is wired to v.currentTime — without this, one drag would register a
   full watch, trip completed_at, move the card to "Watched" and fire the
   "saw you watched the video" nudge at someone who watched nothing. */
function cov(){if(!v||!v.duration)return 0;var played=v.played,t=0;
/* every range, not just the first — they may watch, skip back and rewatch */
for(var i=0;i<played.length;i++){t+=played.end(i)-played.start(i)}
return Math.max(0,Math.min(100,Math.round(t/v.duration*100)))}
var sentPct=0,playSent=0;
function mark(){var c=cov();
[10,25,50,75,90,100].forEach(function(m){if(c>=m&&!fired[m]){fired[m]=1;sentPct=m;send('progress',{pct:m})}});
return c}
if(v){v.addEventListener('timeupdate',function(){if(!v.duration)return;var pct=v.currentTime/v.duration*100;
/* elapsed / total — "how long until the end" is the question being asked */
if(vt)vt.textContent=fmtT(v.currentTime)+' / '+fmtT(v.duration);
if(vs){vs.value=String(Math.round(pct*10));vs.style.setProperty('--p',pct+'%')}
mark()});
/* show the full length BEFORE they press play, not after the first tick —
   knowing it's 2:35 up front is the whole point */
v.addEventListener('loadedmetadata',function(){if(vt)vt.textContent='0:00 / '+fmtT(v.duration)});
if(v.readyState>0&&vt)vt.textContent='0:00 / '+fmtT(v.duration);
v.addEventListener('play',function(){if(vp)vp.style.display='none';
if(!playSent){playSent=1;send('play')}});
/* watching to the end may never tick timeupdate at exactly 100 */
v.addEventListener('ended',function(){mark();if(!fired[100]){fired[100]=1;sentPct=100;send('progress',{pct:100})}});
v.addEventListener('pause',function(){if(vp&&stage.classList.contains('playing'))vp.style.display='flex'})}
/* Final flush: the EXACT coverage, so watched_pct is a real number rather than
   whichever marker they happened to cross. One beacon, on the way out. */
function flush(){if(!v||!v.duration)return;var c=cov();if(c>sentPct){sentPct=c;send('progress',{pct:c})}}
window.addEventListener('pagehide',flush);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')flush()});
if(vs){vs.addEventListener('input',function(){if(!v||!v.duration)return;
v.currentTime=Number(vs.value)/1000*v.duration;vs.style.setProperty('--p',(Number(vs.value)/10)+'%');
/* now the bar is visible over the POSTER, a drag there has to actually start
   the video — otherwise it seeks a frame still hidden behind the poster and
   reads as a broken control */
if(!stage.classList.contains('playing'))play()})}
function togglePlay(){if(!v)return;if(v.paused){try{v.play()}catch(e){}}else{v.pause()}}
function stageTap(){if(!v)return;if(stage.classList.contains('playing')){togglePlay()}else{play()}}
function play(){if(!v)return;stage.classList.add('playing');try{v.play()}catch(e){}
setTimeout(function(){stage.scrollIntoView({behavior:'smooth',block:'center'})},60)}
/* before/after carousel dots */
var bat=document.getElementById('batrack');
function baGo(i){if(!bat)return;bat.scrollTo({left:bat.clientWidth*i,behavior:'smooth'})}
if(bat){bat.addEventListener('scroll',function(){var i=Math.round(bat.scrollLeft/bat.clientWidth);
var ds=document.querySelectorAll('.badot');
for(var j=0;j<ds.length;j++){ds[j].className='badot'+(j===i?' on':'')}},{passive:true})}
/* ---- the value calculator ---- */
var jv=document.getElementById('jv'),njs=document.getElementById('njs'),njEl=document.getElementById('nj'),
cv=document.getElementById('cv'),cn=document.getElementById('cn'),calcSent=0,cvShown=18000,cvAnim=0;
function calcTouched(){if(!calcSent){calcSent=1;send('calc')}}
function fmtPounds(n){return '£'+Math.round(n).toLocaleString('en-GB')}
function cvTween(to){cancelAnimationFrame(cvAnim);var from=cvShown,t0=null;
if(from===to){cv.textContent=fmtPounds(to);return}
function step(ts){if(!t0)t0=ts;var k=Math.min(1,(ts-t0)/350);var e=1-Math.pow(1-k,3);
cvShown=from+(to-from)*e;cv.textContent=fmtPounds(cvShown);if(k<1)cvAnim=requestAnimationFrame(step);else cvShown=to}
cvAnim=requestAnimationFrame(step)}
function calcRender(touched){if(!jv||!njs)return;
var val=parseInt(jv.value,10);if(!isFinite(val)||val<1)val=1;
jv.style.width=(String(val).length+0.5)+'ch';
var n=parseInt(njs.value,10)||5;
njEl.textContent=n;
njs.style.setProperty('--p',((n-1)/9*100)+'%');
cvTween(val*n*12);
var be=Math.ceil(ANNUAL/val);
cn.textContent='HeyElsie costs £'+ANNUAL.toLocaleString('en-GB')+' a year. '+be+' extra jobs in a year covers it'+(be<=4?' — that\\'s one every three months.':'.');
if(touched)calcTouched()}
function jvStep(d){if(!jv)return;var x=(parseInt(jv.value,10)||300)+d;if(x<50)x=50;if(x>5000)x=5000;jv.value=x;calcRender(true)}
if(jv){jv.addEventListener('input',function(){calcRender(true)})}
if(njs){njs.addEventListener('input',function(){calcRender(true)})}
calcRender(false);
function cta(){send('cta_click');document.body.classList.add('open')}
function closeSheet(){document.body.classList.remove('open')}
function pick(priceId,label){send('tier_pick',{pct:0});
fetch('/api/vsl/checkout',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({page_id:PAGE,price_id:priceId})})
.then(function(r){return r.json()})
.then(function(d){if(d.url)location.href=d.url;else alert('Something went wrong — try again.')})
.catch(function(){alert('Something went wrong — try again.')})}
</script>
</body></html>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(html);
}
