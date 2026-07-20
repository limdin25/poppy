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

  const { data: member } = await supabase
    .from('team_members')
    .select('business_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!member) {
    return new Response(JSON.stringify({ error: 'No business found' }), { status: 403 });
  }

  return { userId: user.id, businessId: member.business_id };
}
