// GET / PUT the per-business reviews settings. Template edits are linted:
// incentive language is blocked (Google policy + DMCC), {review_link} required.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { lintTemplate } from '../lib/review-guards.js';
import { randomToken } from '../lib/review-send.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const EDITABLE = [
  'smart_messaging', 'sms_template', 'email_subject', 'email_template', 'followup_template',
  'owner_first_name', 'business_display_name', 'followups_enabled', 'followup_count',
  'followup_gap_days', 'drip_per_day', 'initial_delay_hours', 'quiet_start', 'quiet_end', 'timezone',
  'sending_paused', 'image_enabled', 'auto_reply_positive', 'auto_post_five_star',
] as const;

async function ensureRow(businessId: string) {
  const { data } = await supabase.from('review_settings').select('*').eq('business_id', businessId).maybeSingle();
  if (data) return data;
  const { data: created } = await supabase
    .from('review_settings')
    .insert({ business_id: businessId, inbound_token: randomToken(24) })
    .select('*')
    .single();
  return created;
}

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  if (req.method === 'GET') {
    const row = await ensureRow(auth.businessId);
    return new Response(JSON.stringify({ settings: row }), { status: 200 });
  }

  if (req.method !== 'PUT') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    await ensureRow(auth.businessId);

    const patch: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in body) patch[key] = body[key];
    }

    // PECR attestation is write-once via its own explicit action.
    if (body.attest === true) {
      const { data: member } = await supabase
        .from('team_members')
        .select('email')
        .eq('business_id', auth.businessId)
        .eq('user_id', auth.userId)
        .limit(1)
        .maybeSingle();
      patch.attested_by = member?.email ?? auth.userId;
      patch.attested_at = new Date().toISOString();
    }

    // Lint any template being saved.
    for (const t of ['sms_template', 'email_template', 'followup_template'] as const) {
      const val = patch[t];
      if (typeof val === 'string' && val.trim()) {
        const lint = lintTemplate(val);
        if (!lint.ok) return new Response(JSON.stringify({ error: `${t}: ${lint.error}` }), { status: 400 });
      }
    }
    if (typeof patch.followup_count === 'number' && (patch.followup_count < 0 || patch.followup_count > 3)) {
      return new Response(JSON.stringify({ error: 'followup_count must be 0-3' }), { status: 400 });
    }
    // Right away / few hours / 24h / 2-6 days / 1 week — the only options the UI offers
    if ('initial_delay_hours' in patch && ![0, 4, 24, 48, 72, 96, 120, 144, 168].includes(patch.initial_delay_hours as number)) {
      return new Response(JSON.stringify({ error: 'initial_delay_hours must be one of 0, 4, 24, 48, 72, 96, 120, 144, 168' }), { status: 400 });
    }
    if (typeof patch.quiet_start === 'number' && typeof patch.quiet_end === 'number'
      && (patch.quiet_end as number) - (patch.quiet_start as number) < 4) {
      return new Response(JSON.stringify({ error: 'Send window must be at least 4 hours' }), { status: 400 });
    }

    const { data, error } = await supabase
      .from('review_settings')
      .update(patch)
      .eq('business_id', auth.businessId)
      .select('*')
      .single();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ settings: data }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
