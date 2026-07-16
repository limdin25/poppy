import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

/** 10-char base36 crypto-random token. */
function generateShareToken(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += chars[buf[i] % 36];
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  let body: { id?: string };
  try {
    body = (await req.json()) as { id?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  if (!body.id) {
    return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, share_token, business:businesses(slug)')
    .eq('id', body.id)
    .eq('business_id', businessId)
    .single();

  if (error || !invoice) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  let token = invoice.share_token as string | null;
  if (!token) {
    token = generateShareToken();
    updates.share_token = token;
  }
  if (invoice.status === 'draft') {
    updates.status = 'sent';
    updates.sent_at = new Date().toISOString();
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateErr } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoice.id)
      .eq('business_id', businessId);
    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }
  }

  const business = invoice.business as unknown as { slug: string } | null;
  const numericPart = (invoice.invoice_number as string).replace(/^INV-0*/, '');
  const url = `https://heyelsie.com/${business?.slug}/invoice/${numericPart}-${token}`;

  return new Response(JSON.stringify({ url, token }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
