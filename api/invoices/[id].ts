import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { calcInvoiceTotals } from '../lib/calc-totals.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('invoices')
      .select('*, contact:contacts(*)')
      .eq('id', id)
      .eq('business_id', businessId)
      .single();

    if (error || !data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify(data), { status: 200 });
  }

  if (req.method === 'PUT') {
    const body = await req.json() as {
      contact_id?: string | null;
      line_items?: { description: string; amount: number }[];
      vat_enabled?: boolean;
      notes?: string | null;
      due_date?: string | null;
      payment_method?: 'bank_transfer' | 'cash' | 'none';
      status?: string;
      paid_at?: string | null;
    };

    const updates: Record<string, unknown> = {};

    if (body.contact_id !== undefined) updates.contact_id = body.contact_id || null;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.due_date !== undefined) updates.due_date = body.due_date;
    if (body.payment_method) updates.payment_method = body.payment_method;
    if (body.status) updates.status = body.status;
    if (body.paid_at !== undefined) updates.paid_at = body.paid_at;

    if (body.line_items && body.vat_enabled !== undefined) {
      const totals = calcInvoiceTotals(body.line_items, body.vat_enabled);
      updates.line_items = body.line_items;
      updates.subtotal = totals.subtotal;
      updates.vat_rate = totals.vat_rate;
      updates.vat_amount = totals.vat_amount;
      updates.total = totals.total;
    }

    const { data, error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('business_id', businessId)
      .select('*')
      .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify(data), { status: 200 });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('business_id', businessId)
      .eq('status', 'draft');

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
