// Start the Google Business Profile connection for the signed-in client.
// Creates their Zernio profile (one per business) and returns the Zernio-hosted
// Google OAuth URL. Zernio handles the OAuth + location picker, then redirects
// the browser back to our app with profileId + accountId query params.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { createProfile, getGoogleConnectUrl } from '../../src/integrations/zernio/client.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { return_to } = (await req.json().catch(() => ({}))) as { return_to?: string };
    const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
    const path = return_to && return_to.startsWith('/') ? return_to : '/onboarding';
    const redirectUrl = `${goUrl}${path}`;

    // Reuse the existing Zernio profile for this business, or create one.
    const { data: existing } = await supabase
      .from('gbp_connections')
      .select('zernio_profile_id')
      .eq('business_id', auth.businessId)
      .maybeSingle();

    let profileId = existing?.zernio_profile_id as string | undefined;
    if (!profileId) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', auth.businessId)
        .single();
      const profile = await createProfile(`${biz?.name || 'Business'} (${auth.businessId.slice(0, 8)})`);
      profileId = profile._id;
      await supabase.from('gbp_connections').upsert({
        business_id: auth.businessId,
        zernio_profile_id: profileId,
        status: 'pending',
      });
    }

    const authUrl = await getGoogleConnectUrl(profileId!, redirectUrl);
    return new Response(JSON.stringify({ authUrl }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
