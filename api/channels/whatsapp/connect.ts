import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const APP_URL = process.env.APP_URL || 'https://app.heyelsie.com';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { businessId, provider } = (await req.json()) as { businessId?: string; provider?: string };

    if (businessId && businessId !== auth.businessId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    const isGmail = provider === 'GMAIL';
    const isOutlook = provider === 'OUTLOOK';
    const isInstagram = provider === 'INSTAGRAM';
    const selectedProvider = isGmail ? 'GOOGLE' : isOutlook ? 'MICROSOFT' : isInstagram ? 'INSTAGRAM' : 'WHATSAPP';
    const channelType = isGmail ? 'email_gmail' : isOutlook ? 'email_outlook' : isInstagram ? 'instagram' : 'whatsapp';
    const providerLabel = isGmail ? 'Gmail' : isOutlook ? 'Outlook' : isInstagram ? 'Instagram' : 'WhatsApp';

    const { data: business } = await supabase
      .from('businesses')
      .select('id, name, channel_limits')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    const limits = (business.channel_limits as Record<string, number>) || { whatsapp: 1, email: 1, sms: 1, voice: 1 };
    const limitKey = channelType.startsWith('email') ? 'email' : channelType;
    const maxAllowed = limits[limitKey] ?? 1;

    const typeFilter = channelType.startsWith('email')
      ? ['email_gmail', 'email_outlook', 'email_smtp']
      : [channelType];
    const { count } = await supabase
      .from('channels')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('status', 'connected')
      .in('type', typeFilter);

    if ((count ?? 0) >= maxAllowed) {
      return new Response(JSON.stringify({ error: `Maximum ${maxAllowed} ${limitKey} channel(s) allowed. Contact admin to increase your limit.` }), { status: 403 });
    }

    // Clear leftover non-connected rows for this type so we don't accumulate orphaned
    // "disconnected" channels (and so a stale row never blocks a fresh connect).
    await supabase
      .from('channels')
      .delete()
      .eq('business_id', businessId)
      .neq('status', 'connected')
      .in('type', typeFilter);

    const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const notifyUrl = `${APP_URL}/api/webhooks/unipile`;
    const successUrl = `${APP_URL}/connections?unipile=connected`;
    const failureUrl = `${APP_URL}/connections?unipile=failed`;

    const res = await fetch(`https://${UNIPILE_DSN}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_TOKEN,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        type: 'create',
        providers: [selectedProvider],
        api_url: `https://${UNIPILE_DSN}`,
        expiresOn,
        success_redirect_url: successUrl,
        failure_redirect_url: failureUrl,
        notify_url: notifyUrl,
        name: `${business.name} ${providerLabel}`,
      }),
    });

    const data = (await res.json()) as { url?: string };

    if (!data.url) {
      return new Response(
        JSON.stringify({ error: 'Failed to create connection link', detail: data }),
        { status: 500 },
      );
    }

    await supabase
      .from('channels')
      .insert({
        business_id: businessId,
        type: channelType,
        status: 'disconnected',
        auto_reply_enabled: true,
      });

    return new Response(JSON.stringify({ url: data.url, expires_at: expiresOn }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
