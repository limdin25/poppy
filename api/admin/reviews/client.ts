// /super Reviews — edit ONE client from the admin console: account details
// (business name, owner name, owner email), plan, and the operational review
// settings — plus password management (set a new one directly, or send the
// client a reset link). Every mutation is written to the admin audit log.

import { createClient } from '@supabase/supabase-js';
import { requireAdminAny } from '../../lib/require-admin.js';
import { sendEmail } from '../../../src/integrations/resend/client.js';
import { REVIEW_PLANS } from '../../lib/review-plans.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

// Only these review_settings columns are editable from the admin console.
const SETTINGS_FIELDS = [
  'owner_first_name',
  'business_display_name',
  'sms_from_number',
  'sending_paused',
  'timezone',
  'quiet_start',
  'quiet_end',
  'followups_enabled',
  'followup_count',
  'followup_gap_days',
  'drip_per_day',
  'initial_delay_hours',
  'smart_messaging',
  'image_enabled',
] as const;

export default async function handler(req: Request): Promise<Response> {
  const admin = await requireAdminAny(req);
  if (admin instanceof Response) return admin;

  // ── Detail for the edit dialog ──
  if (req.method === 'GET') {
    const business_id = new URL(req.url).searchParams.get('business_id');
    if (!business_id) return json({ error: 'business_id required' }, 400);

    const [{ data: biz }, { data: settings }, { data: owner }] = await Promise.all([
      supabase.from('businesses').select('id, name, plan, billing_status, owner_id').eq('id', business_id).maybeSingle(),
      supabase.from('review_settings').select(SETTINGS_FIELDS.join(', ')).eq('business_id', business_id).maybeSingle(),
      supabase.from('team_members').select('user_id, email, name').eq('business_id', business_id).eq('role', 'owner').maybeSingle(),
    ]);
    if (!biz) return json({ error: 'Business not found' }, 404);

    return json({
      business: { id: biz.id, name: biz.name, plan: biz.plan, billing_status: biz.billing_status },
      owner: { user_id: owner?.user_id ?? biz.owner_id, email: owner?.email ?? null, name: owner?.name ?? null },
      settings: settings ?? {},
      plans: REVIEW_PLANS.map((p) => ({ key: p.key, name: p.name, priceGbp: p.priceGbp })),
    });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = (await req.json()) as {
      action?: 'update' | 'set_password' | 'send_reset';
      business_id?: string;
      business_name?: string;
      plan?: string;
      owner_name?: string;
      owner_email?: string;
      password?: string;
      settings?: Record<string, unknown>;
    };
    const { action, business_id } = body;
    if (!business_id) return json({ error: 'business_id required' }, 400);

    // Resolve the owner (auth user + team_members row) for this business.
    const { data: biz } = await supabase
      .from('businesses').select('id, owner_id').eq('id', business_id).maybeSingle();
    if (!biz) return json({ error: 'Business not found' }, 404);
    const { data: ownerRow } = await supabase
      .from('team_members').select('user_id, email').eq('business_id', business_id).eq('role', 'owner').maybeSingle();
    const userId = ownerRow?.user_id ?? biz.owner_id;

    // ── Set a new password directly (internal reset) ──
    if (action === 'set_password') {
      if (!userId) return json({ error: 'No owner account for this client' }, 400);
      if (!body.password || body.password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const { error } = await supabase.auth.admin.updateUserById(userId, { password: body.password });
      if (error) return json({ error: error.message }, 400);
      await audit(admin.email, 'reviews_client_password_set', business_id, {});
      return json({ ok: true });
    }

    // ── Email the client a password-reset link (client self-serve) ──
    if (action === 'send_reset') {
      const email = (ownerRow?.email || body.owner_email || '').trim().toLowerCase();
      if (!email) return json({ error: 'No email on file for this client' }, 400);
      const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
      const { data: linkData, error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${goUrl}/dashboard` },
      });
      if (error) return json({ error: error.message }, 400);
      const actionLink = linkData?.properties?.action_link ?? null;
      let emailed = false;
      try {
        await sendEmail(email, 'Reset your HeyElsie password', `
        <div style="font-family:sans-serif;line-height:1.6;color:#1c1c28;max-width:520px;margin:0 auto;">
          <h2>Reset your password</h2>
          <p>A password reset was requested for your HeyElsie Reviews account. Click below to choose a new password:</p>
          ${actionLink ? `<p><a href="${actionLink}" style="background:#3C5A87;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Reset password</a></p>` : `<p>Log in at <a href="${goUrl}">${goUrl}</a> and use "Forgot password".</p>`}
          <p style="color:#6b7280;font-size:14px;">If you didn't request this, you can ignore this email.</p>
        </div>`);
        emailed = true;
      } catch { /* email failed — the admin still gets the copyable link below */ }
      await audit(admin.email, 'reviews_client_reset_sent', business_id, { email, emailed });
      return json({ ok: true, resetLink: actionLink, emailed });
    }

    // ── Edit account details + plan + review settings ──
    if (action === 'update') {
      const changed: string[] = [];

      // Business (company) name + plan
      const bizUpdate: Record<string, unknown> = {};
      if (typeof body.business_name === 'string' && body.business_name.trim()) {
        bizUpdate.name = body.business_name.trim();
        changed.push('business_name');
      }
      if (typeof body.plan === 'string' && body.plan) {
        bizUpdate.plan = body.plan;
        changed.push('plan');
      }
      if (Object.keys(bizUpdate).length) {
        const { error } = await supabase.from('businesses').update(bizUpdate).eq('id', business_id);
        if (error) return json({ error: error.message }, 400);
      }

      // Owner email → auth + team_members
      if (typeof body.owner_email === 'string' && body.owner_email.trim()) {
        const email = body.owner_email.trim().toLowerCase();
        if (userId) {
          const { error } = await supabase.auth.admin.updateUserById(userId, { email, email_confirm: true });
          if (error) return json({ error: error.message }, 400);
        }
        await supabase.from('team_members').update({ email }).eq('business_id', business_id).eq('role', 'owner');
        changed.push('owner_email');
      }

      // Owner name → team_members + auth metadata + review_settings first name
      if (typeof body.owner_name === 'string' && body.owner_name.trim()) {
        const name = body.owner_name.trim();
        await supabase.from('team_members').update({ name }).eq('business_id', business_id).eq('role', 'owner');
        if (userId) await supabase.auth.admin.updateUserById(userId, { user_metadata: { name } });
        changed.push('owner_name');
      }

      // Operational review settings (upsert so it works even if the row is missing)
      if (body.settings && typeof body.settings === 'object') {
        const clean: Record<string, unknown> = {};
        for (const key of SETTINGS_FIELDS) {
          if (key in body.settings && body.settings[key] !== undefined) clean[key] = body.settings[key];
        }
        // owner_name edit keeps the AI greeting first-name in sync unless explicitly overridden
        if (!('owner_first_name' in clean) && typeof body.owner_name === 'string' && body.owner_name.trim()) {
          clean.owner_first_name = body.owner_name.trim().split(/\s+/)[0];
        }
        if (Object.keys(clean).length) {
          const { error } = await supabase
            .from('review_settings')
            .upsert({ business_id, ...clean }, { onConflict: 'business_id' });
          if (error) return json({ error: error.message }, 400);
          changed.push(...Object.keys(clean).map((k) => `settings.${k}`));
        }
      }

      if (!changed.length) return json({ error: 'Nothing to update' }, 400);
      await audit(admin.email, 'reviews_client_updated', business_id, { fields: changed });
      return json({ ok: true, changed });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function audit(admin_email: string, action: string, business_id: string, metadata: Record<string, unknown>) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_email, action, target_type: 'business', target_id: business_id, metadata,
    });
  } catch { /* audit is best-effort — never fail the request on a log write */ }
}
