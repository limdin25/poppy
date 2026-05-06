import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { calcInvoiceTotals } from '../lib/calc-totals.js';
import { generateNumber } from '../lib/generate-number.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('invoices')
      .select('*, contact:contacts(*)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ invoices: data ?? [] }), { status: 200 });
  }

  if (req.method === 'POST') {
    const body = await req.json() as {
      contact_id?: string;
      line_items: { description: string; amount: number }[];
      vat_enabled: boolean;
      notes?: string;
      due_date?: string;
      payment_method?: 'bank_transfer' | 'cash' | 'none';
    };

    if (!body.line_items?.length) {
      return new Response(JSON.stringify({ error: 'At least one line item is required' }), { status: 400 });
    }

    const totals = calcInvoiceTotals(body.line_items, body.vat_enabled);
    const invoiceNumber = await generateNumber(supabase, businessId, 'invoices', 'INV');

    const dueDate = body.due_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })();

    const { data, error } = await supabase
      .from('invoices')
      .insert({
        business_id: businessId,
        contact_id: body.contact_id || null,
        invoice_number: invoiceNumber,
        status: 'draft',
        line_items: body.line_items,
        subtotal: totals.subtotal,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        total: totals.total,
        notes: body.notes || null,
        due_date: dueDate,
        payment_method: body.payment_method || 'none',
      })
      .select('*')
      .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify(data), { status: 201 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
