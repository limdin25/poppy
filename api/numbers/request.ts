import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { sendNotification } from '../../src/integrations/resend/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/**
 * "Request a number" — the self-serve add for Voice/SMS. We don't auto-buy a
 * Twilio number (that costs money); instead we email the ops inbox so a number
 * is provisioned deliberately.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { kind, note } = await req.json().catch(() => ({})) as { kind?: string; note?: string };

    const { data: biz } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', auth.businessId)
      .single();

    const to = process.env.SUPPORT_EMAIL || 'hello@heyelsie.com';
    const label = kind === 'sms' ? 'SMS number' : 'phone number';
    await sendNotification(
      to,
      `New ${label} request`,
      [
        `${biz?.name || 'A business'} has requested a new ${label}.`,
        note ? `Note: ${note}` : null,
        `Business ID: ${auth.businessId}`,
      ].filter(Boolean).join('\n'),
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
