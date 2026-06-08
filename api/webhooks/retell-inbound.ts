import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

// Retell inbound-call webhook. Retell calls this the instant a call arrives and
// waits for the response to decide which agent answers. We use it to alternate
// strictly between the A/B voices configured on the dialled number (one each, in
// turn). The pick is an atomic counter increment in Postgres (ab_pick_agent), so
// alternation stays clean even when two calls land at the same moment — unlike
// flipping the line after each call, which raced and jammed.
//
// Fail-safe by design: any error / no config returns an empty body, so Retell
// falls back to the number's default inbound agent and the call still connects.
export default async function handler(req: Request): Promise<Response> {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  try {
    if (req.method !== 'POST') return ok({});

    const payload = await req.json().catch(() => ({} as any));
    if (payload?.event !== 'call_inbound') return ok({});

    const toNumber: string | undefined = payload?.call_inbound?.to_number;
    if (!toNumber) return ok({});

    const { data: overrideAgentId, error } = await supabase.rpc('ab_pick_agent', { p_to: toNumber });
    if (error || !overrideAgentId) return ok({});

    return ok({ call_inbound: { override_agent_id: overrideAgentId } });
  } catch {
    return ok({});
  }
}
