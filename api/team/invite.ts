import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { sendInviteEmail } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * Invite a teammate: create the pending team_members row AND email the invitee
 * via Resend with a link to join. The email is best-effort — the invite row is
 * still created if the email fails (we report `emailed: false`).
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { email, role } = (await req.json()) as { email?: string; role?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return new Response(JSON.stringify({ error: 'A valid email is required' }), { status: 400 });
    }

    // Don't double-invite someone already on the team
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('business_id', auth.businessId)
      .eq('email', cleanEmail)
      .limit(1);
    if (existing && existing.length) {
      return new Response(JSON.stringify({ error: 'That email is already on the team' }), { status: 409 });
    }

    const { data: member, error: insErr } = await supabase
      .from('team_members')
      .insert({
        business_id: auth.businessId,
        email: cleanEmail,
        name: cleanEmail,
        role: role === 'admin' ? 'admin' : 'member',
        invited_at: new Date().toISOString(),
      })
      .select('id, name, email, role, user_id, joined_at')
      .single();

    if (insErr || !member) {
      return new Response(JSON.stringify({ error: insErr?.message || 'Failed to create invite' }), { status: 500 });
    }

    // Send the invite email via Resend (best-effort)
    let emailed = false;
    try {
      const [{ data: biz }, { data: inviter }] = await Promise.all([
        supabase.from('businesses').select('name').eq('id', auth.businessId).single(),
        supabase.from('team_members').select('name').eq('business_id', auth.businessId).eq('user_id', auth.userId).maybeSingle(),
      ]);
      const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
      const businessName = biz?.name || 'your team';
      const inviterName = inviter?.name || 'A teammate';
      await sendInviteEmail(cleanEmail, businessName, inviterName, `${appUrl}/register`);
      emailed = true;
    } catch (err) {
      console.error('[team/invite] email failed:', err);
    }

    return new Response(JSON.stringify({ ok: true, member, emailed }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
