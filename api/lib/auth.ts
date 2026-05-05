import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface AuthResult {
  userId: string;
  businessId: string;
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
