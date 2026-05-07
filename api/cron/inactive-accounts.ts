import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const INACTIVE_DAYS = 30;

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - INACTIVE_DAYS);

    const { data: inactive } = await supabase
      .from('businesses')
      .select('id, name, owner_id, last_inbound_at, active_channels')
      .eq('channels_paused', false)
      .eq('billing_active', true)
      .or(`last_inbound_at.is.null,last_inbound_at.lt.${cutoffDate.toISOString()}`);

    if (!inactive || inactive.length === 0) {
      return new Response(JSON.stringify({ ok: true, paused: 0 }), { status: 200 });
    }

    let paused = 0;

    for (const biz of inactive) {
      const channels = biz.active_channels || [];
      if (channels.length === 0 && !biz.last_inbound_at) continue;

      await supabase.from('businesses').update({
        channels_paused: true,
        channels_paused_at: new Date().toISOString(),
      }).eq('id', biz.id);

      await notifyOwner(biz);
      paused++;
    }

    return new Response(JSON.stringify({ ok: true, paused }), { status: 200 });
  } catch (err: any) {
    console.error('[inactive-accounts] error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

async function notifyOwner(business: { id: string; name: string | null; owner_id: string }) {
  if (!RESEND_API_KEY) return;

  const { data: profile } = await supabase.auth.admin.getUserById(business.owner_id);
  const email = profile?.user?.email;
  if (!email) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Elsie <notifications@heyelsie.com>',
        to: [email],
        subject: `Elsie paused — no enquiries in 30 days`,
        html: `
          <p>Hi,</p>
          <p>Elsie hasn't received any customer enquiries for <strong>${business.name || 'your business'}</strong> in the past 30 days. To save resources, we've paused your connected channels.</p>
          <p>This doesn't affect your account — you can reconnect anytime from your dashboard.</p>
          <p><a href="https://app.heyelsie.com/account/integrations" style="background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Reconnect Channels</a></p>
          <p>If you're expecting enquiries again soon, just hit the button above and Elsie will be ready.</p>
          <p>— Elsie</p>
        `,
      }),
    });
  } catch (err: any) {
    console.error(`[inactive-accounts] failed to email ${email}:`, err.message);
  }
}
