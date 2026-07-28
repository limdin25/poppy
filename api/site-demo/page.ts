// The public per-lead demo site: heyelsie.com/s/{slug}
//
// Node runtime, not edge: this is the page a crawler and an SMS preview fetch,
// and it has to emit real OG tags before any client JS runs.
//
// Written fresh rather than shared with api/vsl/page.ts. The two funnels are
// separate experiments; the bot gate and the staff gate are each a dozen lines
// and copying the reasoning is cheaper than coupling the two.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { tradeByKey } from '../lib/trades.js';
import { beaconToken } from '../lib/site-beacon.js';
import { fillSiteContent } from '../../src/core/site-demo/fill.js';
import { tradePhotos } from '../../src/core/site-demo/photos.js';
import { renderSite } from '../../src/core/site-demo/render.js';
import type { SiteContent } from '../../src/core/site-demo/types.js';
import {
  DEMO_LINE_E164,
  advanceSiteState,
  getSiteDemoSettings,
  logSiteEvent,
  siteDemoDb as supabase,
  siteUrl,
} from '../lib/site-demo.js';

/**
 * Is this a person, or something a machine fetched on their behalf?
 *
 * GATED ON REQUEST HEADERS, NOT USER AGENT. iMessage fetches a link preview the
 * instant the SMS is delivered, using a stock Safari user agent, so a UA
 * allowlist would report every single delivery as "they opened it" and trip a
 * nudge at a lead who has not looked yet. Apple and Google preview fetchers
 * send no Sec-Fetch headers at all, which is the signal we actually use.
 */
function isHumanNavigation(req: IncomingMessage): boolean {
  const h = req.headers;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';
  // A scanner's HEAD request is not a visit.
  if ((req.method || 'GET').toUpperCase() !== 'GET') return false;
  if (one(h['sec-fetch-dest']).toLowerCase() !== 'document') return false;
  const purpose = `${one(h['sec-purpose'])} ${one(h['purpose'])} ${one(h['x-purpose'])}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return false;
  const ua = one(h['user-agent']).toLowerCase();
  if (
    /bot|crawl|spider|facebookexternalhit|whatsapp|twitterbot|slackbot|discordbot|curl|wget|headlesschrome|preview/.test(
      ua,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Is this us, or the lead?
 *
 * Opening a lead's page from the board must never burn their first touch or
 * tell us they looked when it was our own agent looking. The `?p=1` flag alone
 * is not enough because links get copied and pasted without it, so the first
 * staff visit drops a long-lived cookie and every later visit from that
 * browser is recognised as internal.
 */
const STAFF_COOKIE = 'elsie_staff';
const INTERNAL_REFERRERS = ['app.heyelsie.com', 'go.heyelsie.com'];

function isStaffView(req: IncomingMessage, url: URL): boolean {
  if (url.searchParams.get('p') === '1') return true;
  if (new RegExp(`(?:^|;\\s*)${STAFF_COOKIE}=1`).test(String(req.headers.cookie || ''))) return true;
  const ref = String(req.headers.referer || (req.headers as Record<string, unknown>).referrer || '');
  return INTERNAL_REFERRERS.some((h) => ref.includes(h));
}

interface SitePageRow {
  id: string;
  slug: string;
  contact_id: string;
  state: string;
  content: SiteContent | Record<string, never>;
  first_click_at: string | null;
  business_name: string;
  trade_label: string | null;
  town: string | null;
  phone_display: string | null;
  phone_e164: string | null;
  logo_url: string | null;
  [k: string]: unknown;
}

/**
 * The page request IS the click: there is no redirect hop, because Hugo kept
 * the pretty link. Awaited before the response ends, since there is no
 * waitUntil in this stack and the container freezes the moment the response
 * completes, so a fire and forget promise may simply never run.
 */
async function logLinkClick(req: IncomingMessage, url: URL, page: SitePageRow, staff: boolean) {
  const human = isHumanNavigation(req);
  const ua = String(
    Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent'] || '',
  );
  const from = url.searchParams.get('from') || undefined;

  if (staff) {
    await logSiteEvent(page.id, 'link_click', { internal: true });
    return;
  }

  // Bots are logged but never counted. Keeping them visible is how the gate
  // above gets tuned; meta.bot shows up in the lead drawer.
  await logSiteEvent(page.id, 'link_click', {
    bot: !human || undefined,
    from,
    ua: ua.slice(0, 200),
  });

  if (!human) return;
  // Coming back from an abandoned Stripe tab is a return, not an arrival.
  if (from === 'stripe') return;
  // Only the first click writes the page row. Bumping updated_at on every
  // render would starve this page at the back of the ladder cron's queue.
  if (page.first_click_at) return;

  await advanceSiteState(page, 'opened', { link_click: true });
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

  const { data } = await supabase.from('wk_site_pages').select('*').eq('slug', slug).maybeSingle();
  const page = data as SitePageRow | null;
  if (!page) return bounce();

  const staff = isStaffView(req, url);
  if (staff) {
    res.setHeader('Set-Cookie', `${STAFF_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
  }

  // Tracking must never be able to blank a live sales page.
  await logLinkClick(req, url, page, staff).catch((e) =>
    console.error('[site-demo/page] click log failed:', e),
  );

  const settings = await getSiteDemoSettings();

  // The stored document is the source of truth, because the post-sale editor
  // writes to it and the page must show those edits immediately. Rebuilding
  // from the denormalised columns is only a fallback for a row written before
  // the fill step ran.
  const stored = page.content as SiteContent;
  let content: SiteContent;
  if (stored && stored.v === 1) {
    content = stored;
    // Documents written before the photographs existed carry none, and the
    // renderer's last-resort fallback is the NEUTRAL set: a paintbrush on a
    // plumber's page. Backfill from the trade instead, so no data migration is
    // needed and a stored document can never be worse than a fresh one.
    if (!content.photos) {
      const trade = tradeByKey(page.trade_key as string | null, page.town || undefined);
      content = { ...content, photos: tradePhotos(trade.profile_key) };
    }
  } else {
    // Only reachable for a row written before the fill step ran. Resolve the
    // trade properly rather than guessing: profile_key is not a column, it is
    // derived, and without it every fallback page would render the neutral
    // service list.
    const trade = tradeByKey(page.trade_key as string | null, page.town || undefined);
    content = fillSiteContent({
      businessName: page.business_name,
      tradeKey: trade.key,
      tradeLabel: trade.label || '',
      tradePlural: trade.plural,
      profileKey: trade.profile_key,
      town: page.town || undefined,
      phoneDisplay: page.phone_display || '',
      phoneE164: page.phone_e164 || DEMO_LINE_E164,
    });
  }

  const html = renderSite(content, {
    slug: page.slug,
    pageId: page.id,
    // Staff views carry no token at all, so the page cannot beacon even if
    // something in the client script forgets to check the flag.
    beaconToken: staff ? '' : beaconToken(page.id),
    staff,
    canonicalUrl: siteUrl(page.slug),
    chatEnabled: settings.chat_enabled,
    checkoutEnabled: settings.checkout_enabled && page.state !== 'converted',
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(html);
}
