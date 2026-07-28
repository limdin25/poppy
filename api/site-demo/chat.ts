// The chat widget on the demo site.
//
// Public and unauthenticated by design: it lives on a page a lead opens from an
// SMS with no login. That makes the guards below the only thing standing
// between this route and someone using it as a free LLM, so they are not
// optional.

import { createClient } from '@supabase/supabase-js';
import { callLLM } from '../lib/llm.js';
import { buildChatPrompt, chatCloseOffer } from '../../src/core/site-demo/chat-prompt.js';
import type { SiteContent } from '../../src/core/site-demo/types.js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export const config = { runtime: 'edge' };

/** Abuse limits. A demo receptionist has no reason to exceed any of these. */
const MAX_MESSAGE_CHARS = 500;
const MAX_MESSAGES_PER_SESSION = 20;
const MAX_MESSAGES_PER_PAGE_PER_DAY = 200;
const HISTORY_TURNS = 10;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Same HMAC the page mints. Without it the page_id in public HTML is an open door. */
async function tokenValid(pageId: string, token: string): Promise<boolean> {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return true; // fails open when unset, matching the beacon sink
  if (!token) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bucket = Math.floor(Date.now() / 3_600_000);
  for (const b of [bucket, bucket - 1]) {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${pageId}:${b}`));
    const hex = Array.from(new Uint8Array(sig))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    if (hex === token) return true;
  }
  return false;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { page_id?: string; token?: string; session_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const pageId = String(body.page_id || '');
  const sessionId = String(body.session_id || '').slice(0, 64);
  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!pageId || !message) return json({ error: 'Bad request' }, 400);
  if (!(await tokenValid(pageId, String(body.token || '')))) return json({ error: 'Bad token' }, 403);

  const { data: page } = await supabase
    .from('wk_site_pages')
    .select('id, slug, content, chat_prompt, business_name, state')
    .eq('id', pageId)
    .maybeSingle();
  if (!page) return json({ error: 'Not found' }, 404);

  // Rate limits, counted from the events we already write. Cheap, and it means
  // there is no separate store to keep in sync.
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data: recent } = await supabase
    .from('wk_site_events')
    .select('meta, created_at')
    .eq('page_id', pageId)
    .eq('type', 'chat_message')
    .gte('created_at', dayAgo)
    .order('created_at', { ascending: true })
    .limit(MAX_MESSAGES_PER_PAGE_PER_DAY + 1);

  const all = recent || [];
  if (all.length >= MAX_MESSAGES_PER_PAGE_PER_DAY) {
    return json({ reply: 'Sorry, the chat is busy right now. Give the number on this page a ring.' });
  }

  const session = all.filter(
    (e) => (e.meta as Record<string, unknown> | null)?.session === sessionId,
  );
  if (session.length >= MAX_MESSAGES_PER_SESSION * 2) {
    return json({
      reply: `That is about all I can help with over chat. Ring the number on this page and we will pick it up from there.`,
    });
  }

  const content = page.content as SiteContent;
  if (!content || content.v !== 1) return json({ error: 'Not ready' }, 409);

  // Log the visitor's message BEFORE calling the model. If the model call fails
  // or times out we still have a record that a real person typed something,
  // which is the signal an agent actually cares about.
  await supabase
    .from('wk_site_events')
    .insert({ page_id: pageId, type: 'chat_message', meta: { role: 'user', text: message, session: sessionId } });

  // Chat is engagement. First message advances the page and stands the whole
  // nudge ladder down, because a lead in a conversation must not also be
  // getting automated chasers.
  const { error: advErr } = await supabase.rpc('wk_site_advance', {
    p_page_id: pageId,
    p_target: 'engaged',
    p_bump_open: false,
    p_link_click: false,
    p_phone_tap: false,
    p_chat: true,
    p_call: false,
    p_nudge: false,
    p_outbound_call: false,
  });
  if (advErr) console.error('[site-demo/chat] advance failed:', advErr.message);

  const checkoutUrl =
    process.env.SITE_DEMO_PRICE_ID && page.state !== 'converted'
      ? `https://heyelsie.com/s/${page.slug}`
      : null;

  const history = session
    .slice(-HISTORY_TURNS * 2)
    .map((e) => {
      const m = (e.meta || {}) as { role?: string; text?: string };
      return {
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: String(m.text || ''),
      };
    })
    .filter((m) => m.content);

  const systemPrompt =
    (page.chat_prompt as string | null) || buildChatPrompt(content, { checkoutUrl });

  let reply = '';
  try {
    reply = await callLLM(
      'claude-sonnet-4-6',
      systemPrompt,
      [...history, { role: 'user', content: message }],
      300,
    );
  } catch (e) {
    console.error('[site-demo/chat] llm threw:', e);
  }

  // Never leave a visitor staring at nothing. The fallback is also the best
  // outcome for the business: it sends them to the phone.
  if (!reply.trim()) {
    reply = `Sorry, I did not catch that. Give ${content.phoneDisplay} a ring and we will sort it out.`;
  }

  // A conversation that has run its course gets the close, once.
  const turns = session.filter((e) => (e.meta as { role?: string } | null)?.role === 'user').length + 1;
  if (checkoutUrl && turns >= 4 && !session.some((e) => (e.meta as { close?: boolean } | null)?.close)) {
    reply = `${reply}\n\n${chatCloseOffer(content.businessName, checkoutUrl)}`;
  }

  await supabase.from('wk_site_events').insert({
    page_id: pageId,
    type: 'chat_message',
    meta: {
      role: 'assistant',
      text: reply,
      session: sessionId,
      close: checkoutUrl && turns >= 4 ? true : undefined,
    },
  });

  return json({ reply });
}
