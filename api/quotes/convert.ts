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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const { quote_id } = await req.json() as { quote_id: string };
  if (!quote_id) {
    return new Response(JSON.stringify({ error: 'quote_id is required' }), { status: 400 });
  }

  const { data: quote, error: fetchErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quote_id)
    .eq('business_id', businessId)
    .single();

  if (fetchErr || !quote) {
    return new Response(JSON.stringify({ error: 'Quote not found' }), { status: 404 });
  }

  const invoiceItems = (quote.line_items as { description: string; qty: number; unit_price: number }[]).map(
    (item) => ({ description: item.description, amount: +(item.qty * item.unit_price).toFixed(2) })
  );

  const vatEnabled = (quote.vat_rate as number) > 0;
  const totals = calcInvoiceTotals(invoiceItems, vatEnabled, quote.vat_rate as number);
  const invoiceNumber = await generateNumber(supabase, businessId, 'invoices', 'INV');

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const { data: invoice, error: insertErr } = await supabase
    .from('invoices')
    .insert({
      business_id: businessId,
      contact_id: quote.contact_id,
      quote_id: quote.id,
      invoice_number: invoiceNumber,
      status: 'draft',
      line_items: invoiceItems,
      subtotal: totals.subtotal,
      vat_rate: totals.vat_rate,
      vat_amount: totals.vat_amount,
      total: totals.total,
      notes: quote.notes,
      due_date: dueDate.toISOString().split('T')[0],
      payment_method: 'none',
    })
    .select('*')
    .single();

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), { status: 500 });
  }

  return new Response(JSON.stringify(invoice), { status: 201 });
}
