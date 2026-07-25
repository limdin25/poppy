// Start a Facebook/Instagram connection for the signed-in client, through the
// SAME Zernio profile already used for Google Business Profile (one profile per
// business). Returns the Zernio-hosted OAuth URL; Zernio handles OAuth + the
// page/account picker, then redirects back to /social with
// ?connected={platform}&profileId=…&accountId=…&username=…

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';
import { createProfile, getSocialConnectUrl, type SocialPlatform } from '../../../src/integrations/zernio/client.js';

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
    const { platform } = (await req.json().catch(() => ({}))) as { platform?: SocialPlatform };
    if (platform !== 'facebook' && platform !== 'instagram') {
      return new Response(JSON.stringify({ error: 'platform must be facebook or instagram' }), { status: 400 });
    }
    const goUrl = process.env.GO_APP_URL || 'https://go.heyelsie.com';
    const redirectUrl = `${goUrl}/social`;

    // Reuse the business's Zernio profile (created at GBP connect), or make one.
    const { data: existing } = await supabase
      .from('gbp_connections')
      .select('zernio_profile_id')
      .eq('business_id', auth.businessId)
      .maybeSingle();

    let profileId = existing?.zernio_profile_id as string | undefined;
    if (!profileId) {
      const { data: biz } = await supabase.from('businesses').select('name').eq('id', auth.businessId).single();
      const profile = await createProfile(`${biz?.name || 'Business'} (${auth.businessId.slice(0, 8)})`);
      profileId = profile._id;
      await supabase.from('gbp_connections').upsert({
        business_id: auth.businessId,
        zernio_profile_id: profileId,
        status: 'pending',
      });
    }

    const authUrl = await getSocialConnectUrl(platform, profileId!, redirectUrl);
    return new Response(JSON.stringify({ authUrl }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
