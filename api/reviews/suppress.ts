// Client-initiated do-not-contact: adds a contact to the suppression list
// (writes are service-role only, so this is the client's write path).

import { requireAuth } from '../lib/auth.js';
import { addSuppression } from '../lib/review-guards.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  try {
    const { phone, email } = (await req.json()) as { phone?: string; email?: string };
    if (!phone && !email) return new Response(JSON.stringify({ error: 'phone or email required' }), { status: 400 });
    await addSuppression(auth.businessId, { phone, email, reason: 'manual', source: 'dashboard' });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
