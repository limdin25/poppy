// /super Reviews — all review clients in one view: plan, usage vs cap, GBP
// connection health, pending approvals, pending number requests.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../../lib/require-admin.js';
import { REVIEW_PLANS, capForPlan } from '../../lib/review-plans.js';
import { currentPeriodStart } from '../../lib/review-guards.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  // Every business with the reviews flag on
  const { data: flags } = await supabase
    .from('feature_flags')
    .select('business_id')
    .eq('flag_key', 'reviews')
    .eq('enabled', true);
  const ids = (flags ?? []).map((f) => f.business_id);
  if (!ids.length) {
    return new Response(JSON.stringify({ clients: [], plans: REVIEW_PLANS }), { status: 200 });
  }

  const period = currentPeriodStart();
  const [{ data: businesses }, { data: conns }, { data: usage }, { data: settings }, { data: pendingReplies }, { data: pendingNumbers }, { data: owners }] = await Promise.all([
    supabase.from('businesses').select('id, name, plan, billing_status, created_at, stripe_customer_id').in('id', ids),
    supabase.from('gbp_connections').select('business_id, status, avg_rating, total_reviews, location_name, last_synced_at').in('business_id', ids),
    supabase.from('review_usage').select('business_id, requests_sent').in('business_id', ids).eq('period_start', period),
    supabase.from('review_settings').select('business_id, sms_from_number, sending_paused, attested_at').in('business_id', ids),
    supabase.from('gbp_reviews').select('business_id').in('business_id', ids).eq('ai_draft_status', 'pending_approval'),
    supabase.from('review_number_requests').select('business_id').in('business_id', ids).eq('status', 'pending'),
    supabase.from('team_members').select('business_id, email, name').in('business_id', ids).eq('role', 'owner'),
  ]);

  const by = <T extends { business_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) {
      if (!m.has(r.business_id)) m.set(r.business_id, []);
      m.get(r.business_id)!.push(r);
    }
    return m;
  };
  const connBy = by(conns);
  const usageBy = by(usage);
  const settingsBy = by(settings);
  const repliesBy = by(pendingReplies);
  const numbersBy = by(pendingNumbers);
  const ownersBy = by(owners);

  const clients = (businesses ?? []).map((b) => {
    const conn = connBy.get(b.id)?.[0];
    const s = settingsBy.get(b.id)?.[0];
    return {
      id: b.id,
      name: b.name,
      owner: ownersBy.get(b.id)?.[0] ?? null,
      plan: b.plan,
      billing_status: b.billing_status,
      created_at: b.created_at,
      cap: capForPlan(b.plan) ?? 50,
      used: usageBy.get(b.id)?.[0]?.requests_sent ?? 0,
      gbp_status: conn?.status ?? 'not_connected',
      rating: conn?.avg_rating ?? null,
      total_reviews: conn?.total_reviews ?? null,
      location: conn?.location_name ?? null,
      sms_from_number: s?.sms_from_number ?? null,
      sending_paused: s?.sending_paused ?? false,
      attested: !!s?.attested_at,
      pending_replies: repliesBy.get(b.id)?.length ?? 0,
      pending_number_request: (numbersBy.get(b.id)?.length ?? 0) > 0,
    };
  });

  return new Response(JSON.stringify({ clients, plans: REVIEW_PLANS }), { status: 200 });
}
