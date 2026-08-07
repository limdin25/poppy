// What the HeyPubli reply brain DID about each thread, for the CRM inbox.
//
// Problem B, 07 Aug 2026: refusals, deliberate silences and handovers send no
// outbound message, so in the inbox the thread's last message stays inbound
// forever and "we deliberately stopped" is indistinguishable from "nobody has
// looked". Hugo read that as leads being ignored, and for some of them he was
// right, which is exactly why the two must never share a pixel again.
//
// Same shape as api/crm/heypubli-journey.ts, which is the pattern for reading
// the OTHER Supabase project (the funnel, oouwidqeipibalkjubvw): staff gate
// with the caller's own token, RLS-scoped wk_contacts check on whose numbers
// these are, then a service-role read of funnel_replies, keyed by phone digits.
//
// THREE ANSWERS, NEVER TWO. `configured:false` / `ok:false` mean "we could not
// check"; a phone absent from `states` after ok:true means "checked, the brain
// has never acted on this thread". They must render differently: an empty
// result and a failed lookup look identical otherwise.

import { createClient } from '@supabase/supabase-js';
import { phoneKey } from '../../src/core/heypubli/journey.js';

export const config = { runtime: 'edge' };

const MAX_PHONES = 300;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface BrainStateRow {
  /** The newest funnel_replies row for this phone. */
  kind: 'reply' | 'check_in' | 'handover' | 'refusal' | 'silence';
  reason: string | null;
  status: string;
  at: string;
  /** Whether the lead is opted out on the funnel side (their silence is policy). */
  optedOut: boolean;
}

async function caller(req: Request) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await client.auth.getUser();
  if (!data?.user) return null;
  const { data: staff } = await client.rpc('wk_is_agent_or_admin');
  if (!staff) return null;
  return { client, userId: data.user.id };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const who = await caller(req);
  if (!who) return json({ error: 'Unauthorized' }, 401);

  const url = process.env.HEYPUBLI_SUPABASE_URL;
  const key = process.env.HEYPUBLI_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[heypubli-brain] HEYPUBLI_SUPABASE_URL / _SERVICE_ROLE_KEY not set');
    return json({ ok: false, configured: false, states: {} });
  }

  let phones: string[] = [];
  try {
    const body = (await req.json()) as { phones?: unknown };
    phones = Array.isArray(body.phones) ? body.phones.map(String) : [];
  } catch {
    return json({ error: 'Bad request' }, 400);
  }

  const wanted = new Set(phones.map(phoneKey).filter(Boolean));
  if (wanted.size === 0) return json({ ok: true, configured: true, states: {} });
  if (wanted.size > MAX_PHONES) return json({ error: `Too many phones (max ${MAX_PHONES})` }, 400);

  const shapes = (digits: string) => [`+${digits}`, digits];

  // Whose numbers are these? Asked with the caller's own token so wk_contacts
  // RLS answers it, exactly like heypubli-journey. Never widened.
  const { data: mineRows, error: mineErr } = await who.client
    .from('wk_contacts')
    .select('phone')
    .in('phone', [...wanted].flatMap(shapes));
  if (mineErr) {
    console.error('[heypubli-brain] wk_contacts scope query failed', mineErr.message);
    return json({ ok: false, configured: true, states: {}, error: 'lookup failed' });
  }
  const allowed = new Set<string>();
  for (const r of (mineRows ?? []) as Array<{ phone: string | null }>) {
    const k = phoneKey(r.phone);
    if (k && wanted.has(k)) allowed.add(k);
  }
  if (allowed.size === 0) return json({ ok: true, configured: true, states: {} });

  const hp = createClient(url, key, { auth: { persistSession: false } });
  const variants = [...allowed].flatMap(shapes);

  // Newest action per phone. 500 rows covers 300 phones with headroom because
  // only the newest per phone is kept; anything older is history, not state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: replyRows, error: replyErr } = await (hp.from('funnel_replies') as any)
    .select('phone, kind, reason, status, created_at')
    .in('phone', variants)
    .order('created_at', { ascending: false })
    .limit(500);
  if (replyErr) {
    console.error('[heypubli-brain] funnel_replies query failed', replyErr.message);
    return json({ ok: false, configured: true, states: {}, error: 'lookup failed' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: optRows } = await (hp.from('signup_leads') as any)
    .select('whatsapp, whatsapp_e164')
    .not('whatsapp_opted_out_at', 'is', null)
    .or(
      [...allowed]
        .flatMap((d) => [`whatsapp.eq.+${d}`, `whatsapp_e164.eq.+${d}`])
        .join(','),
    );
  const optedOut = new Set<string>();
  for (const r of (optRows ?? []) as Array<{ whatsapp: string | null; whatsapp_e164: string | null }>) {
    for (const p of [r.whatsapp, r.whatsapp_e164]) {
      const k = phoneKey(p);
      if (k) optedOut.add(k);
    }
  }

  const states: Record<string, BrainStateRow> = {};
  for (const r of (replyRows ?? []) as Array<{
    phone: string;
    kind: BrainStateRow['kind'];
    reason: string | null;
    status: string;
    created_at: string;
  }>) {
    const k = phoneKey(r.phone);
    if (!k || !allowed.has(k) || states[k]) continue;
    states[k] = {
      kind: r.kind,
      reason: r.reason,
      status: r.status,
      at: r.created_at,
      optedOut: optedOut.has(k),
    };
  }
  // An opted-out thread with no action row is still a policy silence, not a miss.
  for (const k of allowed) {
    if (!states[k] && optedOut.has(k)) {
      states[k] = { kind: 'silence', reason: 'opted out', status: 'done', at: '', optedOut: true };
    }
  }

  return json({ ok: true, configured: true, states });
}
