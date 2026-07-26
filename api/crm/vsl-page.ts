// Create (or fetch) a lead's VSL page — called by the dialer's video button.
// Node runtime (the OG renderer needs sharp). Auth: any CRM agent or
// admin (their Supabase JWT), same gate as wk-schedule-send.
//
// POST { contact_id }                        → page info (creates if missing)
// POST { contact_id, request_render: true }  → queues the VPS video factory
//                                              (card moves to "Rendering")
// POST { contact_id, mark_sent: true }       → flips to 'sent' + moves the
//                                              card; REFUSED until the page
//                                              has a playable video (the
//                                              review-before-send gate)
// The UI texts sms_body through the existing wk-sms-send path (identical to
// SubscribeButton).

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  fillTemplate,
  slugifyBusiness,
  advanceVslState,
  movePipelineCardToColumn,
} from '../lib/vsl-settings.js';
import { renderVslOgCard } from '../lib/render-vsl-og.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });
}

// Mirror of video/scripts/lead-url.mjs safeWebsiteUrl (the video pipeline's
// gate) — returns true only for a safe PUBLIC http(s) website. Social-only /
// private / junk values are "no website" so the SMS + page + video all agree.
const SOCIAL_HOST = /(^|\.)(facebook|fb|instagram|twitter|x|linktr|linkedin|tiktok|youtube|youtu|wa|whatsapp|yell|checkatrade|trustpilot|google|bark|thomsonlocal|freeindex)\b/i;
function isCapturableWebsite(raw: string | undefined): boolean {
  const v = (raw || '').trim();
  if (!v) return false;
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.port && !['', '80', '443'].includes(url.port)) return false;
  const h = url.hostname.toLowerCase().replace(/\.$/, '');
  if (SOCIAL_HOST.test(h)) return false;
  if (['g.page', 'g.co', 'goo.gl', 'maps.app.goo.gl', 'business.site'].includes(h) || h.endsWith('.business.site')) return false;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return false; // IP literal
  return /\.[a-z]{2,}$/i.test(h);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const json = (status: number, payload: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  };

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Missing bearer token' });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  const agentId = userResp?.user?.id;
  if (!agentId) return json(401, { error: 'Invalid token' });

  const caller = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return json(403, { error: 'CRM access required' });

  let body: { contact_id?: string; mark_sent?: boolean; request_render?: boolean };
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const contactId = (body.contact_id || '').trim();
  if (!contactId) return json(400, { error: 'contact_id required' });

  // IDOR guard (adversarial review 2026-07-25): read the contact through the
  // CALLER-scoped client so wk_contacts RLS (owner_agent_id / active lead
  // assignment) enforces that this agent actually owns the lead. The
  // service-role client would bypass RLS and let any agent claim any lead's
  // page (+ leak its owner_name/business_name). Admins pass RLS for all rows.
  const { data: contact } = await caller
    .from('wk_contacts')
    .select('id, name, phone, custom_fields')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return json(404, { error: 'Contact not found or not yours' });

  const settings = await getVslSettings();
  const cf = (contact.custom_fields || {}) as Record<string, string>;
  const ownerFirst = (cf.owner_name || '').split(/\s+/)[0] || null;
  // Same rule as video/scripts/lead-url.mjs safeWebsiteUrl — a social-only or
  // junk "website" is treated as no-website so the SMS offer matches the video
  // scene the render pipeline actually produces. KEEP IN LOCKSTEP.
  const noWebsite = !isCapturableWebsite(cf.website);

  // One page per contact (unique index) — reuse if it exists.
  let { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle();

  // Master switch: while the funnel is dark, agents may still create pages and
  // queue renders (Hugo reviews the videos before launch) — but nothing may be
  // MARKED SENT. Return a 409 (not 200) so the UI can't mistake a blocked send
  // for success and flip the card to "sent" (adversarial review 2026-07-26).
  if (!settings.enabled && body.mark_sent) {
    return json(409, {
      error: 'funnel_off',
      page_id: page?.id ?? null,
      enabled: false,
    });
  }

  if (!page) {
    // Slug from the business name; -2, -3… on collision with other businesses.
    const base = slugifyBusiness(contact.name);
    let slug = base;
    for (let i = 2; i <= 20; i++) {
      const { data: clash } = await supabase
        .from('wk_vsl_pages')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${base}-${i}`;
    }

    // A/B assignment: even/odd of current count → deterministic round-robin.
    const { count } = await supabase
      .from('wk_vsl_pages')
      .select('id', { count: 'exact', head: true });
    const variant = (count || 0) % 2 === 0 ? 'a' : 'b';

    const og = await renderVslOgCard({
      slug,
      ownerFirst: ownerFirst || 'there',
      businessName: contact.name,
    });

    const { data: created, error } = await supabase
      .from('wk_vsl_pages')
      .insert({
        slug,
        contact_id: contactId,
        agent_id: agentId,
        business_name: contact.name,
        owner_first: ownerFirst,
        town: cf.town || null,
        og_image_url: og,
        cta_variant: variant,
        no_website: noWebsite,
      })
      .select('*')
      .single();
    if (error || !created) {
      // A concurrent "Send video" for the same contact hit the unique index
      // first — just reuse the page it created rather than 500.
      if (error?.code === '23505') {
        const { data: existing } = await supabase
          .from('wk_vsl_pages').select('*').eq('contact_id', contactId).maybeSingle();
        if (existing) { page = existing; }
        else return json(500, { error: 'Create failed' });
      } else {
        return json(500, { error: error?.message || 'Create failed' });
      }
    } else {
      page = created;
    }
  }

  const url = `https://heyelsie.com/${page.slug}`;

  // Queue the video factory (VPS worker picks it up within 30s). Idempotent:
  // an in-flight or finished render is returned as-is; only null/'failed'
  // (re)queues — the agent's Retry after a failure comes through here too.
  if (body.request_render) {
    if (!page.render_status || page.render_status === 'failed') {
      const { data: queued } = await supabase
        .from('wk_vsl_pages')
        .update({
          render_status: 'queued',
          render_requested_at: new Date().toISOString(),
          render_error: null,
        })
        .eq('id', page.id)
        .select('*')
        .single();
      if (queued) page = queued;
      await movePipelineCardToColumn(page.contact_id, 'Rendering');
    }
  }

  if (body.mark_sent) {
    // Review-before-send gate: never text a page with nothing to play.
    if (!page.video_url && !settings.default_video_url) {
      return json(409, { error: 'no_video', render_status: page.render_status ?? null });
    }
    await advanceVslState(page, 'sent');
    return json(200, { ok: true, page_id: page.id, state: 'sent' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', agentId)
    .maybeSingle();

  const sms_body = fillTemplate(
    page.no_website ? settings.send_template_no_site : settings.send_template,
    {
      first: page.owner_first,
      business: page.business_name,
      url,
      agent: profile?.name || null,
    },
  );

  return json(200, {
    page_id: page.id,
    url,
    sms_body,
    state: page.state,
    enabled: settings.enabled,
    render_status: page.render_status ?? null,
    video_url: page.video_url ?? null,
    poster_url: page.poster_url ?? null,
    no_website: !!page.no_website,
    // mirrors the mark_sent gate so the UI never offers a doomed send
    can_send: !!(page.video_url || settings.default_video_url),
  });
}
