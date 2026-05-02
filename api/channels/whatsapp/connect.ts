import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const UNIPILE_API_URL = process.env.UNIPILE_API_URL!;
const UNIPILE_API_KEY = process.env.UNIPILE_API_KEY!;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { businessId } = await req.json();

    if (!businessId) {
      return new Response(JSON.stringify({ error: 'businessId is required' }), { status: 400 });
    }

    // Verify business exists
    const { data: business } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('id', businessId)
      .single();

    if (!business) {
      return new Response(JSON.stringify({ error: 'Business not found' }), { status: 404 });
    }

    // Create hosted auth link via Unipile
    const res = await fetch(`${UNIPILE_API_URL}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-KEY': UNIPILE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'create',
        providers: ['WHATSAPP'],
        api_url: UNIPILE_API_URL,
        expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
        notify_url: `${process.env.APP_URL || 'https://app.poppy.ai'}/api/webhooks/unipile`,
        name: `${business.name} WhatsApp`,
        metadata: JSON.stringify({ business_id: businessId }),
      }),
    });

    const data = await res.json();

    if (!data.url) {
      return new Response(
        JSON.stringify({ error: 'Failed to create connection link' }),
        { status: 500 },
      );
    }

    return new Response(JSON.stringify({ url: data.url }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
