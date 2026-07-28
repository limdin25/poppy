// The site map: which pages a demo site has, how they nest, and how the nav
// is built from them.
//
// WHY VERB-BASED AND NOT "SERVICES / ABOUT / CONTACT"
// A person with a leak is not browsing, they are trying to work out whether
// this firm handles their problem today. Grouping by what the customer WANTS
// DONE (something is broken now, I need it fixed, I need it fitted, I want it
// looked after) beats grouping by what the business calls itself. The same
// structure carries every trade, which is the requirement: one template, any
// trade, no redesign.
//
// EVERY PAGE IS OPTIONAL AT RENDER TIME.
// A trade with no maintenance offering drops "prepare"; a lead with no
// resolved nearby towns drops "areas" and its children. Nothing else moves.
// The nav is built from the pages that actually exist, never from this list
// directly, so a dropped page can never leave a dead link in the header.

/** Every page kind the generator knows how to build. */
export type PageKey =
  | 'home'
  | 'emergency'
  | 'repair'
  | 'install'
  | 'prepare'
  | 'areas'
  | 'area'
  | 'service'
  | 'learn'
  | 'article'
  | 'careers'
  | 'support'
  | 'book';

export interface PageDef {
  key: PageKey;
  /** Path segment under /s/{slug}. Empty for the home page. */
  path: string;
  /** Label in navigation and breadcrumbs. */
  label: string;
  /** Which photo role the page's opening frame uses. */
  photo: 'hero' | 'work' | 'outcome';
  /** True for pages generated per item rather than once. */
  dynamic?: boolean;
}

export const PAGES: Record<PageKey, PageDef> = {
  home: { key: 'home', path: '', label: 'Home', photo: 'hero' },
  emergency: { key: 'emergency', path: 'emergency', label: 'Emergencies', photo: 'hero' },
  repair: { key: 'repair', path: 'repair', label: 'Repairs', photo: 'work' },
  install: { key: 'install', path: 'install', label: 'Installations', photo: 'outcome' },
  prepare: { key: 'prepare', path: 'prepare', label: 'Prepare', photo: 'work' },
  areas: { key: 'areas', path: 'areas', label: 'Areas we cover', photo: 'outcome' },
  area: { key: 'area', path: 'areas', label: 'Area', photo: 'outcome', dynamic: true },
  service: { key: 'service', path: 'services', label: 'Service', photo: 'work', dynamic: true },
  learn: { key: 'learn', path: 'advice', label: 'Advice', photo: 'work' },
  article: { key: 'article', path: 'advice', label: 'Article', photo: 'work', dynamic: true },
  careers: { key: 'careers', path: 'careers', label: 'Careers', photo: 'hero' },
  support: { key: 'support', path: 'support', label: 'Support', photo: 'hero' },
  book: { key: 'book', path: 'book', label: 'Book an expert', photo: 'outcome' },
};

/**
 * Build a URL for a page.
 *
 * Root-relative and always trailing-slash free, so the same string works in
 * the nav, in a canonical tag and in a sitemap without three sets of rules.
 */
export function pageUrl(slug: string, key: PageKey, item?: string): string {
  const base = `/s/${slug}`;
  const def = PAGES[key];
  if (key === 'home') return base;
  if (def.dynamic) {
    if (!item) return `${base}/${def.path}`;
    return `${base}/${def.path}/${item}`;
  }
  return `${base}/${def.path}`;
}

/**
 * Resolve a request path back to a page.
 *
 * Returns null for anything unrecognised so the route can 302 rather than
 * render an empty page. The dynamic segment is returned separately because
 * the caller has to look it up before it knows whether the page exists at all.
 */
export function resolvePage(segments: string[]): { key: PageKey; item?: string } | null {
  if (!segments.length) return { key: 'home' };
  const [first, second, ...rest] = segments;
  if (rest.length) return null; // nothing nests three deep

  if (first === 'areas') return second ? { key: 'area', item: second } : { key: 'areas' };
  if (first === 'services') return second ? { key: 'service', item: second } : null;
  if (first === 'advice') return second ? { key: 'article', item: second } : { key: 'learn' };
  if (second) return null;

  const match = (Object.values(PAGES) as PageDef[]).find((p) => !p.dynamic && p.path === first);
  return match ? { key: match.key } : null;
}

export interface NavChild {
  label: string;
  href: string;
}

export interface NavGroup {
  label: string;
  /** Present for a group that is itself a page, e.g. Emergencies. */
  href?: string;
  children: NavChild[];
}

export interface NavContext {
  slug: string;
  /** Page keys that actually exist for this site. */
  present: Set<PageKey>;
  /** Resolved nearby areas, already slugged. */
  areas: Array<{ name: string; slug: string }>;
  /** Service lines, already slugged. */
  services: Array<{ name: string; slug: string }>;
}

/**
 * The header navigation, built from the pages that exist.
 *
 * A group with no surviving children is dropped entirely rather than rendered
 * empty, which is the only way a nav can stay honest when the page set varies
 * per lead.
 */
export function buildNav(ctx: NavContext): NavGroup[] {
  const { slug, present } = ctx;
  const has = (k: PageKey) => present.has(k);
  const groups: NavGroup[] = [];

  if (has('emergency')) {
    groups.push({ label: PAGES.emergency.label, href: pageUrl(slug, 'emergency'), children: [] });
  }

  const work: NavChild[] = [];
  if (has('repair')) work.push({ label: PAGES.repair.label, href: pageUrl(slug, 'repair') });
  if (has('install')) work.push({ label: PAGES.install.label, href: pageUrl(slug, 'install') });
  if (has('prepare')) work.push({ label: PAGES.prepare.label, href: pageUrl(slug, 'prepare') });
  for (const s of ctx.services.slice(0, 6)) {
    work.push({ label: s.name, href: pageUrl(slug, 'service', s.slug) });
  }
  if (work.length) groups.push({ label: 'What we do', children: work });

  if (has('areas') && ctx.areas.length) {
    const children = ctx.areas
      .slice(0, 8)
      .map((a) => ({ label: a.name, href: pageUrl(slug, 'area', a.slug) }));
    children.push({ label: 'All areas', href: pageUrl(slug, 'areas') });
    groups.push({ label: 'Areas', children });
  }

  const more: NavChild[] = [];
  if (has('learn')) more.push({ label: PAGES.learn.label, href: pageUrl(slug, 'learn') });
  if (has('careers')) more.push({ label: PAGES.careers.label, href: pageUrl(slug, 'careers') });
  if (has('support')) more.push({ label: PAGES.support.label, href: pageUrl(slug, 'support') });
  if (more.length) groups.push({ label: 'More', children: more });

  return groups;
}

/**
 * Footer columns. Wider than the header on purpose: the footer is where a
 * visitor looks for the page the nav did not surface, so every generated page
 * appears in it exactly once.
 */
export function buildFooter(ctx: NavContext): NavGroup[] {
  const { slug, present } = ctx;
  const has = (k: PageKey) => present.has(k);
  const cols: NavGroup[] = [];

  const work: NavChild[] = [];
  if (has('emergency')) work.push({ label: PAGES.emergency.label, href: pageUrl(slug, 'emergency') });
  if (has('repair')) work.push({ label: PAGES.repair.label, href: pageUrl(slug, 'repair') });
  if (has('install')) work.push({ label: PAGES.install.label, href: pageUrl(slug, 'install') });
  if (has('prepare')) work.push({ label: PAGES.prepare.label, href: pageUrl(slug, 'prepare') });
  if (work.length) cols.push({ label: 'What we do', children: work });

  if (ctx.services.length) {
    cols.push({
      label: 'Services',
      children: ctx.services
        .slice(0, 6)
        .map((s) => ({ label: s.name, href: pageUrl(slug, 'service', s.slug) })),
    });
  }

  if (has('areas') && ctx.areas.length) {
    cols.push({
      label: 'Areas',
      children: [
        ...ctx.areas.slice(0, 5).map((a) => ({ label: a.name, href: pageUrl(slug, 'area', a.slug) })),
        { label: 'All areas', href: pageUrl(slug, 'areas') },
      ],
    });
  }

  const company: NavChild[] = [];
  if (has('learn')) company.push({ label: PAGES.learn.label, href: pageUrl(slug, 'learn') });
  if (has('careers')) company.push({ label: PAGES.careers.label, href: pageUrl(slug, 'careers') });
  if (has('support')) company.push({ label: PAGES.support.label, href: pageUrl(slug, 'support') });
  if (has('book')) company.push({ label: PAGES.book.label, href: pageUrl(slug, 'book') });
  if (company.length) cols.push({ label: 'Company', children: company });

  return cols;
}
