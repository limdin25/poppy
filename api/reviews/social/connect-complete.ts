// Finish an FB/IG connection after Zernio redirects back to /social with
// ?connected={platform}&profileId=…&accountId=…&username=…. Verifies the profile
// belongs to THIS business, resolves the connected account via Zernio (to enrich
// name/handle and confirm it exists), and upserts it into social_connections.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth.js';
import { listAccounts, type SocialPlatform } from '../../../src/integrations/zernio/client.js';

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
    const { platform, profileId, accountId, username } = (await req.json()) as {
      platform?: SocialPlatform; profileId?: string; accountId?: string; username?: string;
    };
    if ((platform !== 'facebook' && platform !== 'instagram') || !profileId) {
      return new Response(JSON.stringify({ error: 'platform and profileId are required' }), { status: 400 });
    }

    // The redirect's profileId must match the Zernio profile for THIS business.
    const { data: conn } = await supabase
      .from('gbp_connections')
      .select('zernio_profile_id')
      .eq('business_id', auth.businessId)
      .maybeSingle();
    if (!conn || conn.zernio_profile_id !== profileId) {
      return new Response(JSON.stringify({ error: 'Connection mismatch. Restart the connect step' }), { status: 400 });
    }

    // Resolve the connected account. The redirect's accountId is authoritative
    // (it's the account the user just authorised); only fall back to the first
    // listed account when the redirect didn't carry one. listAccounts is used to
    // enrich the display name/handle — never to override a provided accountId.
    let acctId = accountId;
    let name: string | undefined;
    let handle = username;
    let avatar: string | undefined;
    try {
      const accounts = await listAccounts(profileId, platform);
      if (!acctId) acctId = accounts[0]?._id;
      const info = accounts.find((a) => a._id === acctId);
      if (info) {
        name = info.displayName;
        handle = handle || info.username;
        avatar = info.avatarUrl;
      }
    } catch { /* fall back to redirect params below */ }

    if (!acctId) {
      return new Response(JSON.stringify({ error: `No connected ${platform} account found. Please try connecting again.` }), { status: 400 });
    }

    await supabase.from('social_connections').upsert({
      business_id: auth.businessId,
      platform,
      zernio_account_id: acctId,
      account_name: name ?? null,
      username: handle ?? null,
      avatar_url: avatar ?? null,
      status: 'connected',
      connected_at: new Date().toISOString(),
    }, { onConflict: 'business_id,platform,zernio_account_id' });

    // Ensure a social_settings row exists so the page has defaults to render.
    await supabase.from('social_settings').upsert(
      { business_id: auth.businessId },
      { onConflict: 'business_id', ignoreDuplicates: true },
    );

    return new Response(JSON.stringify({ ok: true, platform, accountId: acctId, name: name ?? handle ?? null }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
