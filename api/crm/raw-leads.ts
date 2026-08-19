// The raw data command center's one door.
//
// GET  -> the pending raw leads, newest first, for the tab.
// POST -> {action: 'push' | 'reject', ids: [raw lead ids]}
//
// ADMIN ONLY, deliberately narrower than every other CRM route: approving
// which deals reach Pedro is the owner's job (Hugo, 2026-08-19: "so Hugo
// can manually approve and push specific deals directly to the Pedro
// dialer"). Agents meet a lead only after the press.
//
// THE PUSH TOUCHES EXACTLY ONE THING: wk_dialer_queue rows in status
// 'review' become 'pending'. The contacts, facts, redial holds and dedupe
// were all done by the overnight assign scripts when the review row was
// written, so approving cannot half-create anything. A raw lead whose
// queue row is missing (assign refused it: redial hold, do-not-call) is
// reported back as no_queue_row rather than silently marked pushed.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireAdmin(req: Request): Promise<{ userId: string } | Response> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: isAdmin } = await caller.rpc('wk_is_admin');
  if (!isAdmin) return Response.json({ error: 'Admin only' }, { status: 403 });
  return { userId: userResp.user.id };
}

export default async function handler(req: Request): Promise<Response> {
  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  if (req.method === 'GET') {
    const status = new URL(req.url).searchParams.get('status') ?? 'pending_review';
    const { data, error } = await sb
      .from('wk_raw_leads')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ leads: data ?? [] });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: { action?: string; ids?: string[] };
  try { body = await req.json() as typeof body; }
  catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const ids = (body.ids ?? []).filter(Boolean).slice(0, 200);
  if (!ids.length) return Response.json({ error: 'ids required' }, { status: 400 });
  if (body.action !== 'push' && body.action !== 'reject') {
    return Response.json({ error: 'action must be push or reject' }, { status: 400 });
  }

  const { data: rows, error: readErr } = await sb
    .from('wk_raw_leads')
    .select('id, contact_id, status')
    .in('id', ids);
  if (readErr) return Response.json({ error: readErr.message }, { status: 500 });

  const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
  for (const r of (rows ?? []) as Array<{ id: string; contact_id: string | null; status: string }>) {
    if (!r.contact_id) {
      results.push({ id: r.id, ok: false, reason: 'no_queue_row' });
      continue;
    }
    if (body.action === 'push') {
      // Only rows still under review move. A done, dialing or missed row is
      // a call that already happened and must never be resurrected by an
      // approval press.
      const { data: flipped, error } = await sb
        .from('wk_dialer_queue')
        .update({ status: 'pending' })
        .eq('contact_id', r.contact_id)
        .eq('status', 'review')
        .select('id');
      if (error) { results.push({ id: r.id, ok: false, reason: error.message }); continue; }
      if (!flipped?.length) { results.push({ id: r.id, ok: false, reason: 'no_queue_row' }); continue; }
      await sb.from('wk_raw_leads').update({
        status: 'pushed', pushed_at: new Date().toISOString(), pushed_by: gate.userId,
      }).eq('id', r.id);
      results.push({ id: r.id, ok: true });
    } else {
      await sb.from('wk_dialer_queue')
        .update({ status: 'skipped' })
        .eq('contact_id', r.contact_id)
        .eq('status', 'review');
      await sb.from('wk_raw_leads').update({ status: 'rejected' }).eq('id', r.id);
      results.push({ id: r.id, ok: true });
    }
  }

  return Response.json({
    ok: results.every((r) => r.ok),
    pushed: results.filter((r) => r.ok).length,
    results,
  });
}
