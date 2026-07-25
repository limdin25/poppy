// Create (or fetch) a lead's VSL page — called by the dialer's "Send video"
// button. Node runtime (the OG renderer needs sharp). Auth: any CRM agent or
// admin (their Supabase JWT), same gate as wk-schedule-send.
//
// POST { contact_id } → { url, sms_body, page_id, state }
// The UI then texts sms_body through the existing wk-sms-send path (identical
// to SubscribeButton) and POSTs { contact_id, mark_sent: true } back here so
// the page flips to 'sent' + the pipeline card moves.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import {
  getVslSettings,
  fillTemplate,
  slugifyBusiness,
  advanceVslState,
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

  let body: { contact_id?: string; mark_sent?: boolean };
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

  // One page per contact (unique index) — reuse if it exists.
  let { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle();

  // Master switch: while the funnel is dark, don't mint new pages or mark them
  // sent. Existing pages can still be inspected (info only) so the agent sees
  // the "switched off" note rather than a hard error.
  if (!settings.enabled && (!page || body.mark_sent)) {
    return json(200, {
      page_id: page?.id ?? null,
      url: page ? `https://heyelsie.com/${page.slug}` : null,
      sms_body: '',
      state: page?.state ?? 'created',
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

  if (body.mark_sent) {
    await advanceVslState(page, 'sent');
    return json(200, { ok: true, page_id: page.id, state: 'sent' });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', agentId)
    .maybeSingle();

  const sms_body = fillTemplate(settings.send_template, {
    first: page.owner_first,
    business: page.business_name,
    url,
    agent: profile?.name || null,
  });

  return json(200, {
    page_id: page.id,
    url,
    sms_body,
    state: page.state,
    enabled: settings.enabled,
  });
}
