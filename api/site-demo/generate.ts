// Create a demo site for a lead and text them the link.
//
// Two callers, one route:
//   1. supabase/functions/wk-sms-incoming, the moment a lead replies "yeah
//      show me". Authenticates with the service key.
//   2. the "Send site" button in the dialer. Authenticates with the agent's
//      own Supabase JWT.
//
// Generation is synchronous because a token fill is sub-second. There is no
// render queue and there must not be one.

import { createClient } from '@supabase/supabase-js';
import { resolveTrade } from '../lib/trades.js';
import { fillSiteContent } from '../../src/core/site-demo/fill.js';
import { firstWord, formatUkPhone } from '../../src/core/site-demo/fill.js';
import { slugifySite, dedupeSlug } from '../../src/core/site-demo/slug.js';
import { SITE_DEMO_SMS } from '../../src/core/site-demo/messages.js';
import {
  DEMO_LINE_E164,
  advanceSiteState,
  getSiteDemoSettings,
  logSiteEvent,
  siteDemoDb as supabase,
  siteUrl,
} from '../lib/site-demo.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Service key (automation) or a real agent JWT (the button). */
async function authorise(req: Request): Promise<{ agentId: string | null } | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  if (
    token === process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (process.env.CRM_JOBS_KEY && token === process.env.CRM_JOBS_KEY)
  ) {
    return { agentId: null };
  }

  const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await caller.auth.getUser();
  if (!data?.user) return null;
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return null;
  return { agentId: data.user.id };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const who = await authorise(req);
  if (!who) return json({ error: 'Unauthorized' }, 401);

  let body: { contact_id?: string; source?: string; send?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const contactId = String(body.contact_id || '');
  if (!contactId) return json({ error: 'contact_id required' }, 400);
  const shouldSend = body.send !== false;

  const settings = await getSiteDemoSettings();

  // Already has one. Return it rather than minting a second site for the same
  // lead: wk_site_pages has a unique index on contact_id, and a lead who says
  // "yes" twice must not get two different links.
  const { data: existing } = await supabase
    .from('wk_site_pages')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) {
    return json({ ok: true, existing: true, page_id: existing.id, slug: existing.slug, url: siteUrl(existing.slug) });
  }

  const { data: contact } = await supabase
    .from('wk_contacts')
    .select('id, name, phone, owner_agent_id, custom_fields')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return json({ error: 'Contact not found' }, 404);

  const cf = (contact.custom_fields || {}) as Record<string, string | undefined>;
  const town = cf.town || undefined;
  const trade = resolveTrade(cf, town, contact.name);

  // The agent who owns the lead. The button passes its own caller, but the
  // automated path has no session, so fall back to the lead's owner. A page
  // needs an agent_id: RLS keys the whole board off it, and a page with the
  // wrong one would be invisible to the person working the lead.
  const agentId = contact.owner_agent_id || who.agentId;
  if (!agentId) return json({ error: 'No owning agent for this lead' }, 409);

  // The number the SITE shows is the shared demo line, because the demo is the
  // owner ringing it and hearing their own AI answer. Their real mobile stays
  // on the contact row, where the caller-ID lookup needs it.
  const content = fillSiteContent({
    businessName: contact.name,
    ownerFirst: firstWord(cf.owner_name),
    tradeKey: trade.key,
    tradeLabel: trade.label || '',
    tradePlural: trade.plural,
    profileKey: trade.profile_key,
    town,
    address: cf.registered_address,
    phoneDisplay: formatUkPhone(DEMO_LINE_E164),
    phoneE164: DEMO_LINE_E164,
    rating: cf.rating ? Number(cf.rating) : null,
    reviews: cf.reviews ? Number(cf.reviews) : null,
    reviewsSource: cf.reviews_source,
  });

  // Slug collisions are settled by the unique index, not by this read: two
  // leads with the same company name landing in the same instant would both
  // see the name free. The retry loop below is the arbiter.
  const base = slugifySite(contact.name);
  const { data: taken } = await supabase
    .from('wk_site_pages')
    .select('slug')
    .like('slug', `${base}%`);
  let slug = dedupeSlug(base, (taken || []).map((r: { slug: string }) => r.slug));

  const row = {
    contact_id: contactId,
    agent_id: agentId,
    template_key: 'tableau',
    business_name: contact.name,
    owner_first: firstWord(cf.owner_name) || null,
    trade_key: trade.key,
    trade_label: trade.label,
    town: town || null,
    phone_display: content.phoneDisplay,
    phone_e164: content.phoneE164,
    address: cf.registered_address || null,
    content,
    chat_prompt: null,
  };

  let page: { id: string; slug: string } | null = null;
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
    // 23505 on contact_id means a concurrent call won; return their page.
    if (error?.code === '23505' && String(error.message).includes('contact')) {
      const { data: other } = await supabase
        .from('wk_site_pages')
        .select('id, slug')
        .eq('contact_id', contactId)
        .maybeSingle();
      if (other) {
        return json({ ok: true, existing: true, page_id: other.id, slug: other.slug, url: siteUrl(other.slug) });
      }
    }
    if (error?.code === '23505') {
      slug = dedupeSlug(base, [...(taken || []).map((r: { slug: string }) => r.slug), slug]);
      continue;
    }
    console.error('[site-demo/generate] insert failed:', error?.message);
    return json({ error: 'Could not create the site' }, 500);
  }
  if (!page) return json({ error: 'Could not allocate a slug' }, 500);

  const url = siteUrl(page.slug);

  if (!shouldSend) {
    return json({ ok: true, page_id: page.id, slug: page.slug, url, sent: false });
  }

  // Master switch. The page exists and the agent can copy the link, but nothing
  // is texted to a real lead until Hugo arms the funnel at go-live.
  if (!settings.enabled) {
    return json({ ok: true, page_id: page.id, slug: page.slug, url, sent: false, reason: 'disabled' });
  }

  // THE SEND GOES THROUGH THE CRM JOB PATH, NEVER THE TWILIO API DIRECTLY.
  // The worker owns E.164 normalisation, the wk_outbound_sms_allowed kill
  // switch, and the wk_sms_messages row that puts this text in the lead's
  // thread. A direct send lands as an orphan with no thread, and the
  // one-agent-per-lead lock never sets.
  const smsBody = SITE_DEMO_SMS.initial({
    ownerFirst: row.owner_first,
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
      source: `site_demo:${body.source || 'manual'}`,
    },
  });
  if (jobErr) {
    console.error('[site-demo/generate] send enqueue failed:', jobErr.message);
    return json({ ok: true, page_id: page.id, slug: page.slug, url, sent: false, reason: 'enqueue_failed' });
  }

  await logSiteEvent(page.id, 'sent', { source: body.source || 'manual', url });
  await advanceSiteState(page, 'sent');

  return json({ ok: true, page_id: page.id, slug: page.slug, url, sent: true });
}
