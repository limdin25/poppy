import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface ToolAuth {
  businessId: string;
}

/**
 * Authorise a mid-call tool request. Accepts EITHER the internal tool secret
 * (how the Retell voice agent calls us — `x-tool-secret` header) OR a logged-in
 * dashboard user's Bearer JWT (so the same endpoints can be tested from the app).
 *
 * Resolves the business the call belongs to from `?bid=`, the JSON body, or the
 * authenticated user, and enforces that a JWT user can only act on their own
 * business. Returns a Response on any failure so callers can `instanceof Response`.
 */
export async function authorizeToolCall(
  req: Request,
  body: { business_id?: string },
): Promise<ToolAuth | Response> {
  const toolSecret = process.env.TOOL_SECRET;
  const headerSecret = req.headers.get('x-tool-secret') || req.headers.get('x_tool_secret');
  const validToolSecret = !!toolSecret && headerSecret === toolSecret;

  const authHeader = req.headers.get('authorization');
  const hasBearer = authHeader?.startsWith('Bearer ') ?? false;

  if (!validToolSecret && !hasBearer) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  let authedBusinessId: string | null = null;
  if (hasBearer && !validToolSecret) {
    const jwt = authHeader!.slice(7);
    const { data: { user } } = await supabase.auth.getUser(jwt);
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const { data: member } = await supabase
      .from('team_members')
      .select('business_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (!member) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    authedBusinessId = member.business_id;
  }

  const url = new URL(req.url);
  const businessId = authedBusinessId || url.searchParams.get('bid') || body.business_id || null;
  if (!businessId) {
    return new Response(JSON.stringify({ error: 'business_id required' }), { status: 400 });
  }
  if (authedBusinessId && businessId !== authedBusinessId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  return { businessId };
}
