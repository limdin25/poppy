import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface AuthResult {
  userId: string;
  businessId: string;
  /** Set when an admin is acting on another business via x-impersonate-business. */
  impersonating?: boolean;
}

export async function requireAuth(req: Request): Promise<AuthResult | Response> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  }

  // Admin impersonation ("view as client"): API routes act on the impersonated
  // business, verified against the admin allow-list and audit-logged. Without
  // this header every route resolves to the caller's own membership.
  const impersonateId = req.headers.get('x-impersonate-business');
  if (impersonateId) {
    const { data: admin } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', user.email ?? '')
      .maybeSingle();
    if (!admin) {
      return new Response(JSON.stringify({ error: 'Impersonation requires admin' }), { status: 403 });
    }
    const { data: target } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', impersonateId)
      .maybeSingle();
    if (!target) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }
    supabase.from('admin_audit_log').insert({
      admin_email: user.email,
      action: 'impersonate_api',
      target_type: 'business',
      target_id: impersonateId,
      metadata: { path: new URL(req.url).pathname },
    }).then(() => {}, () => {});
    return { userId: user.id, businessId: impersonateId, impersonating: true };
  }

  // Resolve the caller's active business. The common (single-business, incl. all
  // receptionist/CRM) case takes a zero-extra-query fast path identical to the old
  // behaviour. Multi-business (Reviews) users get their active choice from
  // profiles.active_business_id, ignoring unfinished draft businesses.
  const { data: memberships } = await supabase
    .from('team_members')
    .select('business_id')
    .eq('user_id', user.id);

  const memberIds = [...new Set((memberships ?? []).map((m) => m.business_id))];
  if (!memberIds.length) {
    return new Response(JSON.stringify({ error: 'No business found' }), { status: 403 });
  }
  if (memberIds.length === 1) {
    return { userId: user.id, businessId: memberIds[0] };
  }

  const [{ data: profile }, { data: bizRows }] = await Promise.all([
    supabase.from('profiles').select('active_business_id').eq('id', user.id).maybeSingle(),
    supabase.from('businesses').select('id, status').in('id', memberIds),
  ]);
  const nonDraft = (bizRows ?? []).filter((b) => b.status !== 'draft').map((b) => b.id);
  let businessId = nonDraft[0] ?? memberIds[0];
  if (profile?.active_business_id && nonDraft.includes(profile.active_business_id)) {
    businessId = profile.active_business_id;
  }

  return { userId: user.id, businessId };
}
