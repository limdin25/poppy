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

    const fromNumber: string | undefined = payload?.call_inbound?.from_number;
    const toNumber: string | undefined = payload?.call_inbound?.to_number;

    // Expose the caller's number to the agent as {{from_number}}/{{to_number}}.
    // Retell does NOT auto-populate these on SIP-trunk (custom telephony) numbers,
    // so we inject them here — this is what lets the agent "see" the caller's
    // number without asking. Harmless on numbers that don't use it.
    const dynamic_variables: Record<string, string> = {};
    if (fromNumber) { dynamic_variables.from_number = fromNumber; dynamic_variables.caller_number = fromNumber; }
    if (toNumber) dynamic_variables.to_number = toNumber;

    // Optional A/B agent rotation (only affects numbers with ab config configured).
    let overrideAgentId: string | null = null;
    if (toNumber) {
      const { data } = await supabase.rpc('ab_pick_agent', { p_to: toNumber });
      overrideAgentId = data || null;
    }

    const call_inbound: Record<string, unknown> = {};
    if (Object.keys(dynamic_variables).length) call_inbound.dynamic_variables = dynamic_variables;
    if (overrideAgentId) call_inbound.override_agent_id = overrideAgentId;
    return ok({ call_inbound });
  } catch {
    return ok({});
  }
}
