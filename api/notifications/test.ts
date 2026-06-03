import { requireAuth } from '../lib/auth.js';
import { notifyBusinessOwner } from '../lib/notify.js';

export const config = { runtime: 'edge' };

/**
 * Send a test owner alert to all configured destinations + legacy settings.
 * Used by Settings → Notifications "Send test".
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const result = await notifyBusinessOwner(auth.businessId, 'message', {
    title: 'Elsie test alert',
    body: 'This is a test notification from Elsie. If you got this, your alerts are working.',
  });

  return new Response(JSON.stringify({ ok: true, sent: result.sent }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
