// Refer-a-friend: list my referrals, invite by email (£100/£100 gift after the
// invitee's first paid invoice — reward fulfilment is manual via /super in v1).

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { sendEmail } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
  const referralLink = `${goUrl}/onboarding?ref=${auth.businessId}`;

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('review_referrals')
      .select('id, invitee_name, invitee_email, status, created_at, rewarded_at')
      .eq('referrer_business_id', auth.businessId)
      .order('created_at', { ascending: false });
    return new Response(JSON.stringify({ referralLink, referrals: data ?? [] }), { status: 200 });
  }

  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const { name, email } = (await req.json()) as { name?: string; email?: string };
    const inviteeEmail = email?.trim().toLowerCase();
    if (!inviteeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteeEmail)) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), { status: 400 });
    }

    const { data: existing } = await supabase
      .from('review_referrals')
      .select('id')
      .eq('referrer_business_id', auth.businessId)
      .eq('invitee_email', inviteeEmail)
      .limit(1)
      .maybeSingle();
    if (existing) return new Response(JSON.stringify({ error: 'Already invited' }), { status: 400 });

    const { data: biz } = await supabase.from('businesses').select('name').eq('id', auth.businessId).single();

    const { error } = await supabase.from('review_referrals').insert({
      referrer_business_id: auth.businessId,
      referrer_user_id: auth.userId,
      invitee_name: name?.trim() || null,
      invitee_email: inviteeEmail,
      status: 'invited',
    });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const html = `
    <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
      <h2>${biz?.name || 'A business you know'} thinks you should get more Google reviews</h2>
      <p>${name ? `Hi ${name.split(/\s+/)[0]}, ` : ''}${biz?.name || 'A fellow business owner'} uses HeyElsie Reviews to turn happy customers into Google reviews automatically, and they referred you.</p>
      <p>Set up takes about 10 minutes: connect your Google profile, upload your customer list, and reviews start landing within days. You'll both receive a £100 gift card after your first month.</p>
      <p><a href="${referralLink}" style="background:#3C5A87;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Start your 14-day free trial</a></p>
      <p style="color:#9ca3af;font-size:12px;">If this isn't for you, just ignore this email. We won't contact you again.</p>
    </div>`;
    await sendEmail(inviteeEmail, `${biz?.name || 'A business you know'} recommends HeyElsie Reviews (+£100 gift card)`, html).catch(() => {});

    return new Response(JSON.stringify({ ok: true, referralLink }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
