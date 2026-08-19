// One press after the call, and the builder viewing is on the house.
//
// Hugo, 2026-08-19: "build a calendar next to the call disposition. If you
// book a builder we can add the date there right after the call. UK time.
// And of course it reflects on the cockpit's calendar."
//
// NO BUILDER IS REQUIRED HERE, on purpose. The roster is empty and Hugo,
// same day: "when you book the builder I will personally start to reach out
// to the builders." The DATE is what the call produced; who attends is
// Hugo's job afterwards. Assigning a builder stays where it was, the
// cockpit's book_builder press.
//
// Writes brrr_properties.viewing_at (+ viewing_notes when the agent left a
// note), which is exactly what the cockpit calendar reads, so the booking
// appears there with the note on the card. The client converts the typed
// wall time to ISO as EUROPE/LONDON time (src/features/crm/lib/ukTime.ts):
// Pedro types from the Philippines, and a 2pm viewing must stay 2pm UK.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: { propertyId?: string; at?: string; note?: string | null };
  try { body = await req.json() as typeof body; }
  catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

  if (!body.propertyId) return Response.json({ error: 'propertyId required' }, { status: 400 });
  const atMs = Date.parse(body.at ?? '');
  if (!Number.isFinite(atMs)) return Response.json({ error: 'a valid viewing time is required' }, { status: 400 });

  const note = (body.note ?? '').trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { error } = await sb
    .from('brrr_properties')
    .update({
      viewing_at: new Date(atMs).toISOString(),
      // Only when the agent said something: never blank a note an admin
      // wrote in the Properties drawer with an empty booking.
      ...(note ? { viewing_notes: note } : {}),
    })
    .eq('id', body.propertyId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, viewingAt: new Date(atMs).toISOString(), note: note || null });
}
