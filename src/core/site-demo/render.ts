// Renders one page of a demo site to a standalone HTML document.
//
// WHY A STRING AND NOT REACT
// api/tsconfig.json is ES2023 + node16 with no DOM lib and no JSX, and
// react-dom/server is not a dependency anywhere in this repo. The page is also
// served by a Vercel node function that must emit real OG tags before any
// client JS runs. A string is the honest shape for both.
//
// SELF-CONTAINED, NON-NEGOTIABLE
// No CDN, no webfont, no icon package, no third-party host. Photographs are
// first-party, built by scripts/build-site-photos.mjs into public/site/ and
// referenced as relative paths.
//
// This file is now only the assembly: the chrome comes from chrome.ts, the
// body from pages.ts, and the shared bits from primitives.ts.

import { floats, footer, header, script, styles, type ChromeContext } from './chrome.js';
import { pageBody, pageMeta, serviceSlug, type PageContext } from './pages.js';
import { esc } from './primitives.js';
import { tradePhotos } from './photos.js';
import { PAGES, type PageKey } from './sitemap.js';
import type { SiteContent } from './types.js';

export { esc, ICONS, iconFor } from './primitives.js';

export interface RenderOptions {
  /** Public slug, used for every internal link and the canonical URL. */
  slug: string;
  /** wk_site_pages.id. Printed in the page so beacons can identify it. */
  pageId: string;
  /** HMAC beacon token. Empty string disables all beacons (staff view). */
  beaconToken: string;
  /** True when one of us is looking, not the lead. Suppresses every beacon. */
  staff?: boolean;
  /** Absolute origin, for canonical and OG tags. */
  origin?: string;
  ogImageUrl?: string;
  chatEnabled?: boolean;
  checkoutEnabled?: boolean;
  /** Which page to render. Defaults to the home page. */
  page?: PageKey;
  /** The dynamic segment: an area slug, a service slug, an article slug. */
  item?: string;
}

const ORIGIN = 'https://heyelsie.com';

/**
 * Render a page, or null when the requested one does not exist for this site.
 *
 * Null rather than a 404 page on purpose: the route bounces to the home page,
 * because a lead who mistypes a URL should land on the sales page, not on an
 * apology.
 */
export function renderSite(content: SiteContent, opts: RenderOptions): string | null {
  const page: PageKey = opts.page || 'home';
  if (!PAGES[page]) return null;

  const photos = content.photos ?? tradePhotos(null);
  const origin = opts.origin || ORIGIN;

  const ctx: PageContext = {
    content,
    slug: opts.slug,
    page,
    item: opts.item,
    photos,
    checkoutEnabled: opts.checkoutEnabled,
    chatEnabled: opts.chatEnabled,
  };

  const body = pageBody(ctx);
  if (body === null) return null;

  const meta = pageMeta(ctx);

  // The nav is built from the pages that actually exist for THIS site, never
  // from the full list, so a site with no resolved areas cannot render a dead
  // "Areas" dropdown.
  const present = new Set<PageKey>([
    'home',
    'emergency',
    'repair',
    'install',
    'prepare',
    'learn',
    'careers',
    'support',
    'book',
  ]);
  if ((content.areas || []).length) present.add('areas');

  const chrome: ChromeContext = {
    content,
    slug: opts.slug,
    page,
    present,
    areas: content.areas || [],
    services: content.services.map((s) => ({ name: s, slug: serviceSlug(s) })),
    whatsapp: content.whatsapp,
    chatEnabled: opts.chatEnabled,
    checkoutEnabled: opts.checkoutEnabled,
    staff: opts.staff,
  };

  const canonical = `${origin}${pagePath(opts.slug, page, opts.item)}`;

  const staffBanner = opts.staff
    ? `<div class="staffbar">Internal preview. Nothing on this view is tracked.</div>`
    : '';

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.desc)}">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="${esc(content.colours.blue)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.desc)}">
<meta property="og:url" content="${esc(canonical)}">
${opts.ogImageUrl ? `<meta property="og:image" content="${esc(opts.ogImageUrl)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${content.logoUrl ? `<link rel="icon" href="${esc(content.logoUrl)}">` : ''}
<style>${styles(content.colours.accent, content.colours.blue)}</style>
</head>
<body>
${staffBanner}
${header(chrome)}
<main>${body}</main>
${footer(chrome)}
${floats(chrome)}
${script({
  pageId: opts.pageId,
  beaconToken: opts.beaconToken,
  staff: !!opts.staff,
  chatGreeting: content.chatGreeting,
})}
</body>
</html>`;
}

/** The path for a page, without the origin. */
function pagePath(slug: string, page: PageKey, item?: string): string {
  const def = PAGES[page];
  if (page === 'home') return `/s/${slug}`;
  if (def.dynamic && item) return `/s/${slug}/${def.path}/${item}`;
  return `/s/${slug}/${def.path}`;
}

export { pagePath };
