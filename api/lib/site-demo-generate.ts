// Generating a site for a lead, in one place.
//
// Two routes call this: api/site-demo/generate.ts (the agent's button) and
// api/site-demo/reply.ts (the automated path, when a lead says yes by text).
// They differ only in how they authenticate and how they decide to call it.

import { resolveTrade } from './trades.js';
import { nearbyUkTowns } from './uk-areas.js';
import { fillSiteContent, firstWord, formatUkPhone } from '../../src/core/site-demo/fill.js';
import { slugifySite, dedupeSlug } from '../../src/core/site-demo/slug.js';
import { SITE_DEMO_SMS } from '../../src/core/site-demo/messages.js';
import {
  DEMO_LINE_E164,
  advanceSiteState,
  getSiteDemoSettings,
  logSiteEvent,
  siteDemoDb as supabase,
  siteUrl,
} from './site-demo.js';

export interface GenerateResult {
  ok: boolean;
  error?: string;
  status?: number;
  existing?: boolean;
  page_id?: string;
  slug?: string;
  url?: string;
  sent?: boolean;
  reason?: string;
}

export interface GenerateOptions {
  contactId: string;
  /** The caller's own id, used only when the lead has no owning agent. */
  fallbackAgentId?: string | null;
  source?: string;
  /** False returns the link without texting anything. */
  send?: boolean;
}

/**
 * Create the page (or return the existing one) and enqueue the link SMS.
 *
 * Synchronous: a token fill is sub-second, so there is no render queue and
 * there must not be one.
 */
export async function generateSiteForContact(opts: GenerateOptions): Promise<GenerateResult> {
  const { contactId } = opts;
  const shouldSend = opts.send !== false;

  // Already has one. A lead who says "yes" twice must not end up with two
  // different links, and wk_site_pages has a unique index on contact_id.
  const { data: existing } = await supabase
    .from('wk_site_pages')
    .select('id, slug')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) {
    return { ok: true, existing: true, page_id: existing.id, slug: existing.slug, url: siteUrl(existing.slug) };
  }

  const { data: contact } = await supabase
    .from('wk_contacts')
    .select('id, name, phone, owner_agent_id, custom_fields')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return { ok: false, error: 'Contact not found', status: 404 };

  const cf = (contact.custom_fields || {}) as Record<string, string | undefined>;
  const town = cf.town || undefined;
  const trade = resolveTrade(cf, town, contact.name);

  // A page needs an agent_id: RLS keys the whole board off it, so a page with
  // the wrong one is invisible to the person actually working the lead.
  const agentId = contact.owner_agent_id || opts.fallbackAgentId;
  if (!agentId) return { ok: false, error: 'No owning agent for this lead', status: 409 };

  const ownerFirst = firstWord(cf.owner_name);

  // Nearby towns for the areas pages. Resolved from Google's geocoder, hard
  // filtered to GB, and NEVER invented: an empty list simply deletes the areas
  // pages rather than substituting plausible-sounding names. A failure here
  // must not stop a site being generated, so it is caught.
  const areas = town
    ? await nearbyUkTowns(town).catch((e) => {
        console.error('[site-demo] nearby towns failed:', e);
        return [];
      })
    : [];

  // The number the SITE shows is the shared demo line, because the demo is the
  // owner ringing it and hearing their own AI answer for their own business.
  // Their real mobile stays on the contact row, where the caller-ID lookup in
  // retell-inbound.ts needs it to recognise them.
  const content = fillSiteContent({
    businessName: contact.name,
    ownerFirst,
    tradeKey: trade.key,
    tradeLabel: trade.label || '',
    tradePlural: trade.plural,
    profileKey: trade.profile_key,
    town,
    areas,
    // NO ADDRESS ON PURPOSE. cf.registered_address is the Companies House
    // registered office, which for a one-van trader is very often his
    // accountant's office in another county. It shipped once as "Brentwood,
    // Essex" on a Middlesbrough plumber's own website, under the heading
    // "Where we are". The town carries the place claim instead, and the owner
    // types a real address into the editor after the sale.
    phoneDisplay: formatUkPhone(DEMO_LINE_E164),
    phoneE164: DEMO_LINE_E164,
    rating: cf.rating ? Number(cf.rating) : null,
    reviews: cf.reviews ? Number(cf.reviews) : null,
    reviewsSource: cf.reviews_source,
  });

  // This read cannot settle a collision on its own: two leads with the same
  // company name arriving in the same instant would both see the name free.
  // The unique index is the arbiter and the retry loop below handles the loss.
  const base = slugifySite(contact.name);
  const { data: taken } = await supabase.from('wk_site_pages').select('slug').like('slug', `${base}%`);
  const takenSlugs = (taken || []).map((r: { slug: string }) => r.slug);
  let slug = dedupeSlug(base, takenSlugs);

  const row = {
    contact_id: contactId,
    agent_id: agentId,
    template_key: 'tableau',
    business_name: contact.name,
    owner_first: ownerFirst || null,
    trade_key: trade.key,
    trade_label: trade.label,
    town: town || null,
    phone_display: content.phoneDisplay,
    phone_e164: content.phoneE164,
    address: null,
    content,
  };

  let page: { id: string; slug: string } | null = null;
  const tried: string[] = [];
  for (let attempt = 0; attempt < 5 && !page; attempt++) {
    const { data, error } = await supabase
      .from('wk_site_pages')
      .insert({ ...row, slug })
      .select('id, slug')
      .single();
    if (!error && data) {
      page = data;
      break;
    }
    if (error?.code === '23505') {
      // Lost a race on contact_id: return the winner's page, not a second site.
      const { data: other } = await supabase
        .from('wk_site_pages')
        .select('id, slug')
        .eq('contact_id', contactId)
        .maybeSingle();
      if (other) {
        return { ok: true, existing: true, page_id: other.id, slug: other.slug, url: siteUrl(other.slug) };
      }
      tried.push(slug);
      slug = dedupeSlug(base, [...takenSlugs, ...tried]);
      continue;
    }
    console.error('[site-demo] insert failed:', error?.message);
    return { ok: false, error: 'Could not create the site', status: 500 };
  }
  if (!page) return { ok: false, error: 'Could not allocate a slug', status: 500 };

  const url = siteUrl(page.slug);
  const base_ = { ok: true as const, page_id: page.id, slug: page.slug, url };

  if (!shouldSend) return { ...base_, sent: false };

  // Master switch. The page exists and an agent can copy the link, but nothing
  // reaches a real lead until Hugo arms the funnel at go-live.
  const settings = await getSiteDemoSettings();
  if (!settings.enabled) return { ...base_, sent: false, reason: 'disabled' };

  // THE SEND GOES THROUGH THE CRM JOB PATH, NEVER THE TWILIO API DIRECTLY.
  // The worker owns E.164 normalisation, the wk_outbound_sms_allowed kill
  // switch, and the wk_sms_messages row that puts this text in the lead's
  // thread. A direct send lands as an orphan with no thread, and the
  // one-agent-per-lead lock never sets.
  const smsBody = SITE_DEMO_SMS.initial({
    ownerFirst,
    businessName: contact.name,
    url,
    demoNumber: content.phoneDisplay,
  });

  const { error: jobErr } = await supabase.from('wk_jobs').insert({
    kind: 'send_sms',
    status: 'pending',
    payload: {
      contact_id: contactId,
      agent_id: agentId,
      body: smsBody,
      source: `site_demo:${opts.source || 'manual'}`,
    },
  });
  if (jobErr) {
    console.error('[site-demo] send enqueue failed:', jobErr.message);
    return { ...base_, sent: false, reason: 'enqueue_failed' };
  }

  await logSiteEvent(page.id, 'sent', { source: opts.source || 'manual', url });
  await advanceSiteState(page, 'sent');

  return { ...base_, sent: true };
}

/**
 * Did we actually text this lead the website offer?
 *
 * The gate that stops a lead saying "yes" to something else entirely from
 * getting a site. Kept here so the reply route and the Deno webhook agree.
 */
export async function hasSiteOffer(contactId: string): Promise<boolean> {
  const { data } = await supabase
    .from('wk_sms_messages')
    .select('body')
    .eq('contact_id', contactId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(25);
  if (!data?.length) return false;
  const { looksLikeSiteOffer } = await import('../../src/core/site-demo/intent.js');
  return data.some((m: { body: string | null }) => looksLikeSiteOffer(m.body || ''));
}
