import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_TOKEN = process.env.UNIPILE_TOKEN!;
const UNIPILE_DSN = process.env.UNIPILE_DSN!;
const APP_URL = process.env.APP_URL || 'https://poppy-henna.vercel.app';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { businessId, provider } = (await req.json()) as { businessId?: string; provider?: string };

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    const validProviders = ['WHATSAPP', 'GMAIL'] as const;
    const selectedProvider = validProviders.includes(provider) ? provider : 'WHATSAPP';
    const channelType = selectedProvider === 'GMAIL' ? 'email_gmail' : 'whatsapp';

    const { data: business } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    const expiresOn = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const notifyUrl = `${APP_URL}/api/webhooks/unipile`;
    const successUrl = `${APP_URL}/account/integrations?unipile=connected`;
    const failureUrl = `${APP_URL}/account/integrations?unipile=failed`;

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
        name: `${business.name} ${selectedProvider === 'GMAIL' ? 'Gmail' : 'WhatsApp'}`,
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
      .upsert(
        {
          business_id: businessId,
          type: channelType,
          status: 'disconnected',
          auto_reply_enabled: true,
        },
        { onConflict: 'business_id,type' },
      );

    return new Response(JSON.stringify({ url: data.url, expires_at: expiresOn }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
