// "Did the lead just say yes to seeing the website?"
//
// Called by supabase/functions/wk-sms-incoming for inbound texts that pass its
// cheap pre-gate. The classification lives HERE rather than in the Deno
// function because the word list is shared code with unit tests behind it
// (src/core/site-demo/intent.ts), and Deno edge functions cannot import from
// src/. A duplicated copy in the webhook would be the copy nothing tests.
//
// Returns the intent either way, so the caller knows whether to let its normal
// AI reply run. A lead must never get both a site link and an AI reply to the
// same message.

import { classifyReply } from '../../src/core/site-demo/intent.js';
import { generateSiteForContact, hasSiteOffer } from '../lib/site-demo-generate.js';
import { siteDemoDb as supabase } from '../lib/site-demo.js';

export const config = { runtime: 'edge' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function authorised(req: Request): boolean {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  return (
    token === process.env.SUPABASE_SERVICE_ROLE_KEY ||
    Boolean(process.env.CRM_JOBS_KEY && token === process.env.CRM_JOBS_KEY)
  );
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorised(req)) return json({ error: 'Unauthorized' }, 401);

  let body: { contact_id?: string; body?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const contactId = String(body.contact_id || '');
  const text = String(body.body || '');
  if (!contactId) return json({ error: 'contact_id required' }, 400);

  const intent = classifyReply(text);
  if (intent !== 'positive') {
    // Negative and unclear both fall through to the normal AI reply. Unclear is
    // where every money question and every "who is this" lands, on purpose:
    // those want a person, not an automated link.
    return json({ ok: true, intent, generated: false });
  }

  // Re-check the gates here, not just in the caller. This route is reachable
  // with the service key, and generating a site for a lead we never made the
  // offer to would be a cold link out of nowhere.
  const { data: existing } = await supabase
    .from('wk_site_pages')
    .select('id')
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing) return json({ ok: true, intent, generated: false, reason: 'already_has_site' });

  if (!(await hasSiteOffer(contactId))) {
    return json({ ok: true, intent, generated: false, reason: 'no_offer_sent' });
  }

  // A lead who has asked us to stop gets nothing, whatever this message says.
  const { data: dnt } = await supabase
    .from('wk_contact_tags')
    .select('tag')
    .eq('contact_id', contactId)
    .eq('tag', 'do-not-text')
    .maybeSingle();
  if (dnt) return json({ ok: true, intent, generated: false, reason: 'opted_out' });

  const result = await generateSiteForContact({ contactId, source: 'sms_reply' });
  if (!result.ok) {
    console.error('[site-demo/reply] generate failed:', result.error);
    return json({ ok: false, intent, generated: false, error: result.error }, result.status || 500);
  }

  return json({
    ok: true,
    intent,
    // Only claim we handled it if a text is actually on its way. If the funnel
    // is still disabled the caller should let its normal AI reply run, or the
    // lead gets silence after saying yes.
    generated: Boolean(result.sent),
    page_id: result.page_id,
    url: result.url,
    sent: result.sent,
    reason: result.reason,
  });
}
