// The body of every page kind.
//
// WHAT MAY AND MAY NOT BE SAID HERE, ON EVERY PAGE
// The truth rules do not relax because there are now a dozen pages instead of
// one. Nothing on any page may state a certification, a membership, a price, a
// guarantee, a response time, a number of years, a team size, or an accreditation.
// A deeper site is more dangerous than a shallow one precisely because there is
// more room to fill, and filler is where invented claims come from. Every page
// below is built from the same handful of true facts plus statements about the
// ordinary scope of the trade, which is not a claim about this business.
//
// The owner replaces any of it after the sale through content.pages, which is
// why each page reads its heading and blurb through pageCopy() rather than
// hardcoding them.

import { esc, iconFor, starRow, svg } from './primitives.js';
import { pageUrl, type PageKey } from './sitemap.js';
import { slugifySite } from './slug.js';
import type { SiteArea, SiteContent } from './types.js';
import type { SitePhoto } from './photos.js';

export interface PageContext {
  content: SiteContent;
  slug: string;
  page: PageKey;
  /** The dynamic item: an area slug, a service slug, an article slug. */
  item?: string;
  photos: { hero: SitePhoto; work?: SitePhoto; outcome?: SitePhoto };
  checkoutEnabled?: boolean;
  chatEnabled?: boolean;
}

/** Owner override first, generated default second. */
function copy(c: SiteContent, key: PageKey, field: 'heading' | 'blurb'): string | undefined {
  return c.pages?.[key]?.[field];
}

export function serviceSlug(name: string): string {
  return slugifySite(name);
}

export function findService(c: SiteContent, item?: string): string | undefined {
  if (!item) return undefined;
  return c.services.find((s) => serviceSlug(s) === item);
}

export function findArea(c: SiteContent, item?: string): SiteArea | undefined {
  if (!item) return undefined;
  return (c.areas || []).find((a) => a.slug === item);
}

// ---------------------------------------------------------------------------
// Shared blocks
// ---------------------------------------------------------------------------

function photoTag(p: SitePhoto | undefined, cls: string, eager = false): string {
  if (!p) return '';
  return (
    `<img class="${cls}" src="${esc(p.src)}" alt="${esc(p.alt)}" ` +
    (eager ? 'fetchpriority="high" ' : 'loading="lazy" ') +
    `decoding="async">`
  );
}

/** The opening frame of an interior page: photograph, breadcrumb, title. */
function topFrame(
  ctx: PageContext,
  opts: { title: string; sub: string; crumbs: Array<{ label: string; href?: string }>; photo?: SitePhoto },
): string {
  const crumb = opts.crumbs
    .map((c, i) =>
      c.href && i < opts.crumbs.length - 1
        ? `<a href="${esc(c.href)}">${esc(c.label)}</a>`
        : `<span>${esc(c.label)}</span>`,
    )
    .join(' <span aria-hidden="true">/</span> ');

  return `
<section class="top">
  ${photoTag(opts.photo, 'shot', true)}
  <div class="scrim"></div>
  <div class="wrap">
    <p class="crumb">${crumb}</p>
    <h1 class="r">${esc(opts.title)}</h1>
    <p class="sub r">${esc(opts.sub)}</p>
    <div class="acts r">
      <a class="btn btn-call" href="tel:${esc(ctx.content.phoneE164)}" data-tap="1">${svg('phone', 19)}Call ${esc(ctx.content.phoneDisplay)}</a>
      <a class="btn btn-ghost" href="${esc(pageUrl(ctx.slug, 'book'))}">Book an expert</a>
    </div>
  </div>
</section>`;
}

/** The one colour rest a page is allowed. */
function territory(text: string): string {
  return `
<section class="territory">
  <div class="wrap"><div class="row"><span class="ico">${svg('pin', 26)}</span>
    <p>${esc(text)}</p></div></div>
</section>`;
}

/** The close. Every page ends on the number. */
function close(ctx: PageContext, heading?: string): string {
  const { content, slug } = ctx;
  const getStarted = ctx.checkoutEnabled
    ? `<button class="getstarted z" id="getstarted" type="button">Get started</button>`
    : `<a class="btn btn-solid z" href="${esc(pageUrl(slug, 'book'))}">Book an expert</a>`;
  return `
<section class="close">
  <div class="wrap">
    <p class="eyebrow z">${esc(heading || 'Give us a ring')}</p>
    <a class="tel z" href="tel:${esc(content.phoneE164)}" data-tap="1">${esc(content.phoneDisplay)}</a>
    <p class="where z">${esc(content.bands[0])}</p>
    ${getStarted}
  </div>
</section>`;
}

/** Services as an index of links into their own pages. */
function serviceIndex(ctx: PageContext, services: string[]): string {
  return `<ul class="index">${services
    .map(
      (s, i) =>
        `<li><a class="item r" href="${esc(pageUrl(ctx.slug, 'service', serviceSlug(s)))}">` +
        `<span class="n">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="ico">${svg(iconFor(s), 21)}</span>` +
        `<h3>${esc(s)}</h3><span class="arr">${svg('arrow', 18)}</span></a></li>`,
    )
    .join('')}</ul>`;
}

function areaPills(ctx: PageContext, areas: SiteArea[]): string {
  if (!areas.length) return '';
  return `<ul class="pills">${areas
    .map((a) => `<li><a href="${esc(pageUrl(ctx.slug, 'area', a.slug))}">${esc(a.name)}</a></li>`)
    .join('')}</ul>`;
}

function faq(items: Array<[string, string]>): string {
  return `<div class="faq">${items
    .map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`)
    .join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function proofSection(content: SiteContent, photo?: SitePhoto): string {
  if (!content.proof) return '';
  const full = Math.max(0, Math.min(5, Math.round(content.proof.rating)));
  return `
<section class="proof">
  ${photoTag(photo, '')}
  <div class="slab">
    <div class="stars" aria-hidden="true">${starRow(full, 20)}</div>
    <p class="score">${esc(content.proof.rating.toFixed(1))}</p>
    <p class="sub">${esc(content.proof.reviews)} Google reviews</p>
  </div>
</section>`;
}

function homeBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  const sentences = content.about.split(/(?<=\.)\s+/).filter(Boolean);
  const heroBlurb = sentences.length > 1 ? sentences[0] : content.about;
  const rest = sentences.length > 1 ? sentences.slice(1).join(' ') : content.about;

  const ratingRow = content.proof
    ? `<p class="rating r"><span class="stars" aria-hidden="true">${starRow(5, 14)}</span>` +
      `<b>${esc(content.proof.rating.toFixed(1))}</b>` +
      `<span>${esc(content.proof.reviews)} Google reviews</span></p>`
    : '';

  const askBtn = ctx.chatEnabled
    ? `<a class="btn btn-ghost" id="askbtn" href="#chat">Ask a question</a>`
    : '';

  return `
<section class="hero">
  <div class="wrap">
   <div class="herocopy">
    ${ratingRow}
    <p class="kicker r">${esc(content.tagline)}</p>
    <h1 class="name r">${esc(content.businessName)}</h1>
    <p class="blurb r">${esc(heroBlurb)}</p>
    <div class="acts r">
      <a class="btn btn-call" href="tel:${esc(content.phoneE164)}" data-tap="1">${svg('arrow', 18)}Call ${esc(content.phoneDisplay)}</a>
      ${askBtn}
    </div>
   </div>
  <div class="figure r">${photoTag(photos.hero, 'shot', true)}</div>
</section>

${territory(content.bands[0])}

<section class="sec">
  <div class="wrap inv">
    <div class="invshot">
      ${photoTag(photos.work, '')}
      <div class="slab bl"><p class="k">Availability</p><p>${esc(content.bands[1])}</p></div>
    </div>
    <div>
      <p class="eyebrow r">Services</p>
      <h2 class="h2 r">${esc(copy(content, 'home', 'heading') || 'What we take care of')}</h2>
      <p class="lede r">${esc(rest)}</p>
      ${serviceIndex(ctx, content.services)}
    </div>
  </div>
</section>

${proofSection(content, photos.outcome)}

<section class="sec soft">
  <div class="wrap">
    <p class="eyebrow r">How we can help</p>
    <h2 class="h2 r">Whatever kind of job it is</h2>
    <div class="grid three">
      <a class="tile r" href="${esc(pageUrl(slug, 'emergency'))}">
        <span class="ico">${svg('clock', 26)}</span>
        <h3 class="h3">Something wrong now</h3>
        <p>Tell us what is happening and we will talk it through on the phone.</p>
        <p class="go">Emergencies ${svg('arrow', 15)}</p></a>
      <a class="tile r" href="${esc(pageUrl(slug, 'repair'))}">
        <span class="ico">${svg('wrench', 26)}</span>
        <h3 class="h3">Something needs fixing</h3>
        <p>Repairs across everything listed above, big or small.</p>
        <p class="go">Repairs ${svg('arrow', 15)}</p></a>
      <a class="tile r" href="${esc(pageUrl(slug, 'install'))}">
        <span class="ico">${svg('spark', 26)}</span>
        <h3 class="h3">Something to be fitted</h3>
        <p>New work, from a single item to a whole job.</p>
        <p class="go">Installations ${svg('arrow', 15)}</p></a>
    </div>
  </div>
</section>

${
  (content.areas || []).length
    ? `<section class="sec">
  <div class="wrap">
    <p class="eyebrow r">Areas</p>
    <h2 class="h2 r">${esc(content.bands[0])}</h2>
    ${areaPills(ctx, (content.areas || []).slice(0, 10))}
  </div>
</section>`
    : ''
}

${close(ctx, `Need ${aOrAn(content.tradeLabel)} ${content.tradeLabel.toLowerCase()}${content.town ? ` in ${content.town}` : ''}?`)}`;
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

// ---------------------------------------------------------------------------
// Category pages: emergency, repair, install, prepare
// ---------------------------------------------------------------------------

interface CategorySpec {
  key: PageKey;
  title: (c: SiteContent) => string;
  sub: (c: SiteContent) => string;
  lede: string;
  faqs: (c: SiteContent) => Array<[string, string]>;
}

const CATEGORIES: Record<string, CategorySpec> = {
  emergency: {
    key: 'emergency',
    title: (c) => `Emergencies${c.town ? ` in ${c.town}` : ''}`,
    sub: (c) => `${c.bands[1]}. Ring and tell us what is going on.`,
    lede:
      'If something has gone wrong and it cannot wait, the fastest thing is always a phone call. ' +
      'Describe what is happening and we will tell you straight what needs doing.',
    faqs: (c) => [
      [
        'What counts as an emergency?',
        'Anything you cannot safely leave until tomorrow. If you are not sure, ring and describe it, and we will tell you honestly whether it can wait.',
      ],
      [
        'What should I do before you arrive?',
        'Make the area safe and stop anything getting worse if you can do so safely. We will talk you through it on the phone.',
      ],
      [
        'Do you cover my area?',
        c.bands[0] + '. If you are just outside, ring and ask.',
      ],
    ],
  },
  repair: {
    key: 'repair',
    title: () => 'Repairs',
    sub: (c) => `Repair work across everything ${c.businessName} takes on.`,
    lede:
      'Most jobs start as a repair. Tell us what is happening and what you have already tried, ' +
      'and we will work out what actually needs doing rather than guessing at it.',
    faqs: () => [
      [
        'Can you tell me what it will cost over the phone?',
        'Not reliably, and we would rather not guess. Describe the problem and we will tell you what we would need to look at before quoting.',
      ],
      [
        'Do I need to be there?',
        'Usually yes, at least to let us in and to point at the problem. Ring and we will sort out the details.',
      ],
    ],
  },
  install: {
    key: 'install',
    title: () => 'Installations',
    sub: (c) => `New work fitted by ${c.businessName}.`,
    lede:
      'New work is easier to price than a repair, because we can see what is going in before we start. ' +
      'Tell us what you are thinking of and we will talk through what it involves.',
    faqs: () => [
      [
        'Can you supply as well as fit?',
        'Ring and ask. What we can supply depends on the job, and it is a quick conversation.',
      ],
      [
        'How far ahead do you book?',
        'It varies. The phone is the fastest way to find out what is free.',
      ],
    ],
  },
  prepare: {
    key: 'prepare',
    title: () => 'Prepare',
    sub: () => 'The work that stops the emergency call happening in the first place.',
    lede:
      'Most of the jobs we get called out to at the worst possible moment were visible months earlier. ' +
      'Preparing properly is cheaper than repairing in a hurry, and a lot less disruptive.',
    faqs: () => [
      [
        'Is this worth doing?',
        'It depends on the property and what is already there. Ring and describe the place, and we will tell you honestly whether it is worth it.',
      ],
      [
        'How often should it be looked at?',
        'That depends on the job and the age of what is installed. It is worth asking on the phone rather than working to a rule of thumb.',
      ],
    ],
  },
};

function categoryBody(ctx: PageContext, spec: CategorySpec): string {
  const { content, slug, photos } = ctx;
  const photo = spec.key === 'install' ? photos.outcome || photos.hero : photos.work || photos.hero;
  const title = copy(content, spec.key, 'heading') || spec.title(content);
  const sub = copy(content, spec.key, 'blurb') || spec.sub(content);

  return `
${topFrame(ctx, {
  title,
  sub,
  photo,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: title }],
})}

<section class="sec">
  <div class="wrap">
    <p class="lede r">${esc(spec.lede)}</p>
    <h2 class="h2 r">What this covers</h2>
    ${serviceIndex(ctx, content.services)}
  </div>
</section>

${territory(content.bands[1])}

<section class="sec">
  <div class="wrap">
    <h2 class="h2 r">Common questions</h2>
    ${faq(spec.faqs(content))}
  </div>
</section>

${close(ctx)}`;
}

// ---------------------------------------------------------------------------
// Service detail
// ---------------------------------------------------------------------------

function serviceBody(ctx: PageContext, service: string): string {
  const { content, slug, photos } = ctx;
  const where = content.town ? ` in ${content.town}` : '';
  const others = content.services.filter((s) => s !== service);

  return `
${topFrame(ctx, {
  title: `${service}${where}`,
  sub: `Part of the work ${content.businessName} takes on. Ring and describe what is happening.`,
  photo: photos.work || photos.hero,
  crumbs: [
    { label: 'Home', href: pageUrl(slug, 'home') },
    { label: 'Repairs', href: pageUrl(slug, 'repair') },
    { label: service },
  ],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid two">
      <div class="r">
        <h2 class="h2">What to expect</h2>
        <div class="prose">
          <p>The honest answer on any job of this kind is that it depends on what we find.
            What we can do on the phone is listen to what is happening, tell you what it
            usually turns out to be, and say what we would need to look at before quoting.</p>
          <p>${esc(content.bands[1])}.</p>
        </div>
      </div>
      <div class="r">
        <h2 class="h2">Before you ring</h2>
        <div class="prose">
          <p>It helps to know roughly when it started, whether anything changed just before,
            and whether it is getting worse. None of it is essential, so do not worry if you
            are not sure.</p>
          <p>${esc(content.bands[0])}.</p>
        </div>
      </div>
    </div>
  </div>
</section>

${territory(`${service}${where}`)}

<section class="sec soft">
  <div class="wrap">
    <p class="eyebrow r">Also handled</p>
    <h2 class="h2 r">Other work we take on</h2>
    ${serviceIndex(ctx, others)}
  </div>
</section>

${close(ctx)}`;
}

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

function areasBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  const areas = content.areas || [];
  return `
${topFrame(ctx, {
  title: copy(content, 'areas', 'heading') || 'Areas we cover',
  sub: copy(content, 'areas', 'blurb') || `${content.bands[0]}. If you are just outside, ring and ask.`,
  photo: photos.outcome || photos.hero,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: 'Areas we cover' }],
})}

<section class="sec">
  <div class="wrap">
    <p class="lede r">Pick the nearest place to you, or just ring the number and tell us where you are.</p>
    <div class="grid three">
      ${areas
        .map(
          (a) =>
            `<a class="tile r" href="${esc(pageUrl(slug, 'area', a.slug))}">` +
            `<span class="ico">${svg('pin', 24)}</span><h3 class="h3">${esc(a.name)}</h3>` +
            `<p>${esc(content.tradeLabel)} work in ${esc(a.name)} and around it.</p>` +
            `<p class="go">See ${esc(a.name)} ${svg('arrow', 15)}</p></a>`,
        )
        .join('')}
    </div>
  </div>
</section>

${close(ctx)}`;
}

function areaBody(ctx: PageContext, area: SiteArea): string {
  const { content, slug, photos } = ctx;
  const others = (content.areas || []).filter((a) => a.slug !== area.slug);
  return `
${topFrame(ctx, {
  title: `${content.tradeLabel} in ${area.name}`,
  sub: `${content.businessName} covers ${area.name} and the area around it.`,
  photo: photos.outcome || photos.hero,
  crumbs: [
    { label: 'Home', href: pageUrl(slug, 'home') },
    { label: 'Areas', href: pageUrl(slug, 'areas') },
    { label: area.name },
  ],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid two">
      <div class="r">
        <h2 class="h2">Working in ${esc(area.name)}</h2>
        <div class="prose">
          <p>${esc(content.businessName)} takes on work in ${esc(area.name)} and the
            surrounding area. Ring the number on this page, say where you are and what is
            happening, and you will get a straight answer.</p>
          <p>${esc(content.bands[1])}.</p>
        </div>
      </div>
      <div class="r">
        <h2 class="h2">What we take on here</h2>
        ${serviceIndex(ctx, content.services.slice(0, 4))}
      </div>
    </div>
  </div>
</section>

${territory(`Covering ${area.name} and nearby`)}

${
  others.length
    ? `<section class="sec soft">
  <div class="wrap">
    <p class="eyebrow r">Nearby</p>
    <h2 class="h2 r">Other places we cover</h2>
    ${areaPills(ctx, others)}
  </div>
</section>`
    : ''
}

${close(ctx, `Need ${aOrAn(content.tradeLabel)} ${content.tradeLabel.toLowerCase()} in ${area.name}?`)}`;
}

// ---------------------------------------------------------------------------
// Advice
// ---------------------------------------------------------------------------

/**
 * Advice articles are generated from the service list, so they are always
 * about work this trade actually does. The body is deliberately about what to
 * check and when to ring, never a set of instructions that could get somebody
 * hurt or void something.
 */
export function articlesFor(c: SiteContent): Array<{ title: string; slug: string; service: string }> {
  return c.services.slice(0, 6).map((s) => ({
    title: `What to do about ${s.toLowerCase()}`,
    slug: serviceSlug(s),
    service: s,
  }));
}

function learnBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  const arts = articlesFor(content);
  return `
${topFrame(ctx, {
  title: copy(content, 'learn', 'heading') || 'Advice',
  sub: copy(content, 'learn', 'blurb') || 'Straight answers about the jobs we get asked about most.',
  photo: photos.work || photos.hero,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: 'Advice' }],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid two">
      ${arts
        .map(
          (a) =>
            `<a class="tile r" href="${esc(pageUrl(slug, 'article', a.slug))}">` +
            `<span class="ico">${svg(iconFor(a.service), 24)}</span>` +
            `<h3 class="h3">${esc(a.title)}</h3>` +
            `<p>What usually causes it, what to check, and when it is worth ringing.</p>` +
            `<p class="go">Read ${svg('arrow', 15)}</p></a>`,
        )
        .join('')}
    </div>
  </div>
</section>

${close(ctx)}`;
}

function articleBody(ctx: PageContext, service: string): string {
  const { content, slug, photos } = ctx;
  return `
${topFrame(ctx, {
  title: `What to do about ${service.toLowerCase()}`,
  sub: 'What usually causes it, what to check first, and when it is worth ringing somebody.',
  photo: photos.work || photos.hero,
  crumbs: [
    { label: 'Home', href: pageUrl(slug, 'home') },
    { label: 'Advice', href: pageUrl(slug, 'learn') },
    { label: service },
  ],
})}

<section class="sec">
  <div class="wrap prose">
    <h2 class="h2 r">The short version</h2>
    <p class="r">If it is getting worse, or you are not confident about it, ring somebody rather
      than working on it yourself. Most of what makes these jobs expensive is not the original
      fault, it is the damage done while it was left alone or while somebody had a go at it.</p>
    <h2 class="h2 r">What is worth checking</h2>
    <p class="r">Note when it started, whether anything changed just before, and whether it is
      steady or getting worse. Those three answers tell whoever comes out more than anything
      else you can tell them, and they are quick to gather.</p>
    <h2 class="h2 r">When to ring</h2>
    <p class="r">If it is getting worse, if it involves water or power, or if you are not sure,
      that is the point to stop and ring. ${esc(content.bands[1])}.</p>
    <p class="r"><a class="btn btn-solid" href="${esc(pageUrl(slug, 'service', serviceSlug(service)))}">
      More about ${esc(service.toLowerCase())} ${svg('arrow', 16)}</a></p>
  </div>
</section>

${close(ctx)}`;
}

// ---------------------------------------------------------------------------
// Careers, support, book
// ---------------------------------------------------------------------------

function careersBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  return `
${topFrame(ctx, {
  title: copy(content, 'careers', 'heading') || 'Careers',
  sub:
    copy(content, 'careers', 'blurb') ||
    `Interested in working with ${content.businessName}? Get in touch.`,
  photo: photos.hero,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: 'Careers' }],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid two">
      <div class="r prose">
        <h2 class="h2">Working here</h2>
        <p>We are always glad to hear from people who do this work properly and turn up when
          they say they will. If that is you, ring the number on this page or send a message
          and tell us a bit about what you do.</p>
        <p>${esc(content.bands[0])}.</p>
      </div>
      <div class="r">
        <div class="tile">
          <span class="ico">${svg('people', 26)}</span>
          <h3 class="h3">Get in touch</h3>
          <p>Ring ${esc(content.phoneDisplay)} or use the booking form and mark it as a
            careers enquiry.</p>
          <p class="go"><a href="${esc(pageUrl(slug, 'book'))}">Send a message ${svg('arrow', 15)}</a></p>
        </div>
      </div>
    </div>
  </div>
</section>

${close(ctx, 'Rather just ring?')}`;
}

function supportBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  return `
${topFrame(ctx, {
  title: copy(content, 'support', 'heading') || 'Support',
  sub: copy(content, 'support', 'blurb') || 'Getting hold of us, and what to expect when you do.',
  photo: photos.hero,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: 'Support' }],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid three">
      <div class="tile r"><span class="ico">${svg('phone', 26)}</span>
        <h3 class="h3">Phone</h3>
        <p><a href="tel:${esc(content.phoneE164)}" data-tap="1">${esc(content.phoneDisplay)}</a></p>
        <p class="go">Usually the fastest</p></div>
      <div class="tile r"><span class="ico">${svg('calendar', 26)}</span>
        <h3 class="h3">Book a visit</h3>
        <p>Send the details and we will come back to you.</p>
        <p class="go"><a href="${esc(pageUrl(slug, 'book'))}">Booking form ${svg('arrow', 15)}</a></p></div>
      <div class="tile r"><span class="ico">${svg('pin', 26)}</span>
        <h3 class="h3">Where we work</h3>
        <p>${esc(content.bands[0])}.</p>
        ${
          (content.areas || []).length
            ? `<p class="go"><a href="${esc(pageUrl(slug, 'areas'))}">All areas ${svg('arrow', 15)}</a></p>`
            : ''
        }</div>
    </div>
  </div>
</section>

<section class="sec soft">
  <div class="wrap">
    <h2 class="h2 r">Common questions</h2>
    ${faq([
      ['How do I get hold of you fastest?', 'Ring the number on this page. It is quicker than any form.'],
      [
        'Do you cover my area?',
        `${content.bands[0]}. If you are just outside it, ring and ask rather than assuming not.`,
      ],
      [
        'Can you give me a price over the phone?',
        'For most jobs, no, and we would rather say so than guess. Describe it and we will tell you what we would need to see first.',
      ],
    ])}
  </div>
</section>

${close(ctx)}`;
}

function bookBody(ctx: PageContext): string {
  const { content, slug, photos } = ctx;
  const options = content.services.map((s) => `<option>${esc(s)}</option>`).join('');
  const areaOptions = (content.areas || [])
    .map((a) => `<option>${esc(a.name)}</option>`)
    .join('');

  return `
${topFrame(ctx, {
  title: copy(content, 'book', 'heading') || 'Book an expert',
  sub:
    copy(content, 'book', 'blurb') ||
    'Send the details and we will come back to you. If it is urgent, ring instead.',
  photo: photos.outcome || photos.hero,
  crumbs: [{ label: 'Home', href: pageUrl(slug, 'home') }, { label: 'Book an expert' }],
})}

<section class="sec">
  <div class="wrap">
    <div class="grid two">
      <div class="r">
        <h2 class="h2">Tell us what is happening</h2>
        <div id="bookmsg" class="formmsg" role="status"></div>
        <form class="form" id="bookform" autocomplete="on">
          <div class="row2">
            <div class="field"><label for="bk-name">Your name</label>
              <input id="bk-name" name="name" required maxlength="80"></div>
            <div class="field"><label for="bk-phone">Phone</label>
              <input id="bk-phone" name="phone" type="tel" required maxlength="30"></div>
          </div>
          <div class="row2">
            <div class="field"><label for="bk-job">What do you need</label>
              <select id="bk-job" name="job"><option>Not sure yet</option>${options}</select></div>
            <div class="field"><label for="bk-area">Where are you</label>
              ${
                areaOptions
                  ? `<select id="bk-area" name="area"><option>${esc(content.town || 'Nearby')}</option>${areaOptions}</select>`
                  : `<input id="bk-area" name="area" maxlength="60">`
              }</div>
          </div>
          <div class="field"><label for="bk-note">Anything else</label>
            <textarea id="bk-note" name="note" maxlength="1000"></textarea></div>
          <button class="btn btn-solid" id="booksend" type="submit">Request a visit</button>
          <p class="formnote">We will only use this to get back to you about the job.</p>
        </form>
      </div>
      <div class="r">
        <div class="tile">
          <span class="ico">${svg('clock', 26)}</span>
          <h3 class="h3">Urgent?</h3>
          <p>A form is never the fastest way to reach anybody. If it cannot wait, ring.</p>
          <p class="go"><a href="tel:${esc(content.phoneE164)}" data-tap="1">${esc(content.phoneDisplay)}</a></p>
        </div>
        <div class="tile" style="margin-top:16px">
          <span class="ico">${svg('pin', 26)}</span>
          <h3 class="h3">Where we work</h3>
          <p>${esc(content.bands[0])}.</p>
        </div>
      </div>
    </div>
  </div>
</section>

${close(ctx)}`;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** The body of whichever page was asked for, or null if it does not exist. */
export function pageBody(ctx: PageContext): string | null {
  const { content, page, item } = ctx;

  switch (page) {
    case 'home':
      return homeBody(ctx);
    case 'emergency':
    case 'repair':
    case 'install':
    case 'prepare':
      return categoryBody(ctx, CATEGORIES[page]);
    case 'service': {
      const s = findService(content, item);
      return s ? serviceBody(ctx, s) : null;
    }
    case 'areas':
      return (content.areas || []).length ? areasBody(ctx) : null;
    case 'area': {
      const a = findArea(content, item);
      return a ? areaBody(ctx, a) : null;
    }
    case 'learn':
      return learnBody(ctx);
    case 'article': {
      const s = findService(content, item);
      return s ? articleBody(ctx, s) : null;
    }
    case 'careers':
      return careersBody(ctx);
    case 'support':
      return supportBody(ctx);
    case 'book':
      return bookBody(ctx);
    default:
      return null;
  }
}

/** Title and description for the document head. */
export function pageMeta(ctx: PageContext): { title: string; desc: string } {
  const { content, page, item } = ctx;
  const where = content.town ? ` in ${content.town}` : '';
  const brand = content.businessName;
  const service = findService(content, item);
  const area = findArea(content, item);

  switch (page) {
    case 'home':
      return {
        title: content.town
          ? `${brand} | ${content.tradeLabel} in ${content.town}`
          : `${brand} | ${content.tradeLabel}`,
        desc: content.about.slice(0, 180),
      };
    case 'service':
      return {
        title: service ? `${service}${where} | ${brand}` : brand,
        desc: `${service || content.tradeLabel}${where} from ${brand}. ${content.bands[1]}.`.slice(0, 180),
      };
    case 'area':
      return {
        title: area ? `${content.tradeLabel} in ${area.name} | ${brand}` : brand,
        desc: `${brand} covers ${area?.name || content.town || 'the local area'}. ${content.bands[1]}.`.slice(0, 180),
      };
    case 'article':
      return {
        title: service ? `What to do about ${service.toLowerCase()} | ${brand}` : brand,
        desc: `What usually causes it, what to check, and when to ring. From ${brand}.`.slice(0, 180),
      };
    default: {
      const label =
        page === 'emergency'
          ? `Emergencies${where}`
          : page === 'repair'
            ? 'Repairs'
            : page === 'install'
              ? 'Installations'
              : page === 'prepare'
                ? 'Prepare'
                : page === 'areas'
                  ? 'Areas we cover'
                  : page === 'learn'
                    ? 'Advice'
                    : page === 'careers'
                      ? 'Careers'
                      : page === 'support'
                        ? 'Support'
                        : 'Book an expert';
      return {
        title: `${label} | ${brand}`,
        desc: `${label} from ${brand}. ${content.bands[0]}.`.slice(0, 180),
      };
    }
  }
}
