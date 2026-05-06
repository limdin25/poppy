import { requireAuth } from '../lib/auth.js';
import { getAuthUrl } from '../lib/google-calendar.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const appUrl = process.env.APP_URL || 'https://app.heyelsie.com';
  const redirectUri = `${appUrl}/api/calendar/callback`;
  const state = auth.businessId;

  const url = getAuthUrl(redirectUri, state);
  return new Response(JSON.stringify({ url }), { status: 200 });
}
