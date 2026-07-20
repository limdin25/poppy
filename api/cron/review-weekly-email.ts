// Weekly stats email — the anti-churn weapon. Every Monday morning each
// reviews client gets "You got N new reviews this week, rating now X.X".
// Review Harvest sends nothing like this; clients cancel when they can't SEE
// results, so we make sure they see them.

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '../../src/integrations/resend/client.js';
import { capForPlan } from '../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

function stars(n: number): string {
  return '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
}

export default async function handler(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';

  const { data: conns } = await supabase
    .from('gbp_connections')
    .select('business_id, avg_rating, total_reviews, location_name')
    .eq('status', 'connected');

  let sent = 0;
  for (const conn of conns ?? []) {
    try {
      const businessId = conn.business_id as string;

      const [{ count: newReviews }, { count: requestsSent }, { count: clicks }, { data: biz }, { data: owner }, { data: usage }] = await Promise.all([
        supabase.from('gbp_reviews').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).gte('review_created_at', weekAgo),
        supabase.from('review_events').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('type', 'request_sent').gte('created_at', weekAgo),
        supabase.from('review_events').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('type', 'clicked').gte('created_at', weekAgo),
        supabase.from('businesses').select('name, plan').eq('id', businessId).single(),
        supabase.from('team_members').select('email, name').eq('business_id', businessId).eq('role', 'owner').limit(1).maybeSingle(),
        supabase.from('review_usage').select('requests_sent').eq('business_id', businessId)
          .eq('period_start', `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}-01`).maybeSingle(),
      ]);
      if (!owner?.email) continue;

      const rating = conn.avg_rating ? Number(conn.avg_rating) : null;
      const cap = capForPlan(biz?.plan) ?? 50;
      const used = usage?.requests_sent ?? 0;
      const nearCap = used >= cap * 0.8;

      const subject = newReviews
        ? `${biz?.name}: ${newReviews} new Google review${newReviews === 1 ? '' : 's'} this week 🎉`
        : `${biz?.name}: your weekly review report`;

      const html = `
      <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
        <h2 style="margin-bottom:4px;">Your week in reviews</h2>
        <p style="color:#6b7280;margin-top:0;">${conn.location_name || biz?.name || ''}</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr>
            <td style="padding:16px;background:#f3f6fb;border-radius:12px;text-align:center;">
              <div style="font-size:32px;font-weight:700;color:#3C5A87;">${newReviews ?? 0}</div>
              <div style="color:#6b7280;font-size:13px;">new reviews</div>
            </td>
            <td style="width:8px;"></td>
            <td style="padding:16px;background:#f3f6fb;border-radius:12px;text-align:center;">
              <div style="font-size:32px;font-weight:700;color:#3C5A87;">${rating ? rating.toFixed(1) : '—'}</div>
              <div style="color:#6b7280;font-size:13px;">${rating ? stars(rating) : 'rating'} · ${conn.total_reviews ?? 0} total</div>
            </td>
          </tr>
          <tr><td colspan="3" style="height:8px;"></td></tr>
          <tr>
            <td style="padding:16px;background:#f3f6fb;border-radius:12px;text-align:center;">
              <div style="font-size:32px;font-weight:700;color:#3C5A87;">${requestsSent ?? 0}</div>
              <div style="color:#6b7280;font-size:13px;">requests sent</div>
            </td>
            <td style="width:8px;"></td>
            <td style="padding:16px;background:#f3f6fb;border-radius:12px;text-align:center;">
              <div style="font-size:32px;font-weight:700;color:#3C5A87;">${clicks ?? 0}</div>
              <div style="color:#6b7280;font-size:13px;">link clicks</div>
            </td>
          </tr>
        </table>
        ${nearCap ? `<p style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;color:#9a3412;font-size:14px;">You've used ${used} of your ${cap} monthly requests. <a href="${goUrl}/billing" style="color:#9a3412;font-weight:600;">Upgrade your plan</a> so requests never pause.</p>` : ''}
        <p><a href="${goUrl}/dashboard" style="background:#3C5A87;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Open your dashboard</a></p>
        <p style="color:#9ca3af;font-size:12px;">HeyElsie Reviews — you're receiving this as the account owner.</p>
      </div>`;

      await sendEmail(owner.email, subject, html);
      sent++;
    } catch (err) {
      console.error('[weekly-email]', conn.business_id, (err as Error).message);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { status: 200 });
}
