// /super referral payout queue. v1 fulfilment is manual: when an invitee's
// first paid invoice lands, the row shows here as 'paid'; Hugo sends the two
// £100 gift cards and marks it rewarded.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../../lib/require-admin.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  if (req.method === 'GET') {
    const { data: referrals } = await supabase
      .from('review_referrals')
      .select('id, referrer_business_id, invitee_name, invitee_email, invitee_business_id, status, created_at, rewarded_at, reward_note')
      .order('created_at', { ascending: false })
      .limit(200);
    const ids = [...new Set((referrals ?? []).flatMap((r) => [r.referrer_business_id, r.invitee_business_id]).filter(Boolean))] as string[];
    const { data: businesses } = ids.length
      ? await supabase.from('businesses').select('id, name').in('id', ids)
      : { data: [] as Array<{ id: string; name: string }> };
    const nameById = new Map((businesses ?? []).map((b) => [b.id, b.name]));
    return new Response(JSON.stringify({
      referrals: (referrals ?? []).map((r) => ({
        ...r,
        referrer_name: nameById.get(r.referrer_business_id) ?? r.referrer_business_id,
        invitee_business_name: r.invitee_business_id ? nameById.get(r.invitee_business_id) ?? null : null,
      })),
    }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  const { referral_id, note } = (await req.json()) as { referral_id?: string; note?: string };
  if (!referral_id) return new Response(JSON.stringify({ error: 'referral_id required' }), { status: 400 });

  const { data: row } = await supabase.from('review_referrals').select('id, status').eq('id', referral_id).maybeSingle();
  if (!row) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (row.status !== 'paid') return new Response(JSON.stringify({ error: `Referral is ${row.status}, not paid` }), { status: 400 });

  await supabase.from('review_referrals').update({
    status: 'rewarded',
    rewarded_at: new Date().toISOString(),
    reward_note: note?.slice(0, 500) ?? `Marked rewarded by ${admin.email}`,
  }).eq('id', referral_id);

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
