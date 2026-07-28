// The client's own site, for the editor on go.heyelsie.com.
//
// GET   -> their site's content document
// PATCH -> save it
//
// AUTHORISED BY BUSINESS OWNERSHIP, NOT BY PAGE ID. The page id is printed in
// public HTML, so trusting one from the request body would let anyone who
// opened a demo site edit it. The caller's JWT decides which business they are
// in, and the row must already belong to that business, which only happens at
// conversion.

import { createClient } from '@supabase/supabase-js';
import type { SiteContent } from '../../src/core/site-demo/types.js';
import { siteDemoDb as supabase, siteUrl } from '../lib/site-demo.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Resolve the caller to the businesses they actually belong to. */
async function callerBusinesses(req: Request): Promise<string[] | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await client.auth.getUser();
  if (!data?.user) return null;
  const { data: rows } = await client
    .from('team_members')
    .select('business_id')
    .eq('user_id', data.user.id);
  const ids = (rows || []).map((r: { business_id: string }) => r.business_id).filter(Boolean);
  return ids.length ? ids : [];
}

/**
 * Only these fields may be written, and each is bounded.
 *
 * An allowlist rather than a merge of whatever arrives: the content document is
 * rendered straight into a public HTML page, so accepting arbitrary keys would
 * let a client add whatever they liked to it. Escaping happens at render time,
 * but shape control belongs here.
 */
function sanitiseContent(existing: SiteContent, patch: Record<string, unknown>): SiteContent {
  const str = (v: unknown, max: number, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
  const colour = (v: unknown, fallback: string) =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback;

  const services = Array.isArray(patch.services)
    ? (patch.services as unknown[])
        .filter((s) => typeof s === 'string' && s.trim())
        .slice(0, 12)
        .map((s) => String(s).trim().slice(0, 80))
    : existing.services;

  const bands = Array.isArray(patch.bands)
    ? (existing.bands.map((b, i) => str((patch.bands as unknown[])[i], 120, b)) as [string, string, string])
    : existing.bands;

  return {
    ...existing,
    v: 1,
    businessName: str(patch.businessName, 80, existing.businessName),
    tradeLabel: str(patch.tradeLabel, 60, existing.tradeLabel),
    town: typeof patch.town === 'string' ? patch.town.trim().slice(0, 60) || undefined : existing.town,
    tagline: str(patch.tagline, 140, existing.tagline),
    phoneDisplay: str(patch.phoneDisplay, 32, existing.phoneDisplay),
    phoneE164: str(patch.phoneE164, 20, existing.phoneE164),
    address: typeof patch.address === 'string' ? patch.address.trim().slice(0, 160) || undefined : existing.address,
    about: str(patch.about, 900, existing.about),
    contactHeading: str(patch.contactHeading, 60, existing.contactHeading),
    chatGreeting: str(patch.chatGreeting, 240, existing.chatGreeting),
    services: services.length ? services : existing.services,
    bands,
    colours: {
      accent: colour((patch.colours as Record<string, unknown> | undefined)?.accent, existing.colours.accent),
      blue: colour((patch.colours as Record<string, unknown> | undefined)?.blue, existing.colours.blue),
    },
    logoUrl: typeof patch.logoUrl === 'string' ? patch.logoUrl.slice(0, 500) || undefined : existing.logoUrl,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const businesses = await callerBusinesses(req);
  if (businesses === null) return json({ error: 'Unauthorized' }, 401);
  if (!businesses.length) return json({ error: 'No site on this account' }, 404);

  const { data: page } = await supabase
    .from('wk_site_pages')
    .select('id, slug, content, chat_prompt, business_id, state')
    .in('business_id', businesses)
    .maybeSingle();
  if (!page) return json({ error: 'No site on this account' }, 404);

  if (req.method === 'GET') {
    return json({
      page_id: page.id,
      slug: page.slug,
      url: siteUrl(page.slug),
      content: page.content,
      chat_prompt: page.chat_prompt,
    });
  }

  if (req.method === 'PATCH') {
    let body: { content?: Record<string, unknown>; chat_prompt?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Bad JSON' }, 400);
    }

    const existing = page.content as SiteContent;
    if (!existing || existing.v !== 1) return json({ error: 'This site cannot be edited yet' }, 409);

    const content = body.content ? sanitiseContent(existing, body.content) : existing;
    const chatPrompt =
      typeof body.chat_prompt === 'string' ? body.chat_prompt.slice(0, 4000) : page.chat_prompt;

    const { error } = await supabase
      .from('wk_site_pages')
      .update({ content, chat_prompt: chatPrompt })
      .eq('id', page.id);
    if (error) {
      console.error('[site-demo/site] save failed:', error.message);
      return json({ error: 'Could not save' }, 500);
    }

    // The public page renders from this document on every request, so the
    // change is live the moment this returns. No republish step, and nothing
    // to get out of sync.
    return json({ ok: true, content, chat_prompt: chatPrompt });
  }

  return json({ error: 'Method not allowed' }, 405);
}
