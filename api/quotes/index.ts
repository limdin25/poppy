import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';
import { calcQuoteTotals } from '../lib/calc-totals.js';
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
      .from('quotes')
      .select('*, contact:contacts(*)')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ quotes: data ?? [] }), { status: 200 });
  }

  if (req.method === 'POST') {
    const body = await req.json() as {
      contact_id?: string;
      line_items: { description: string; qty: number; unit_price: number }[];
      vat_enabled: boolean;
      notes?: string;
      valid_until?: string;
    };

    if (!body.line_items?.length) {
      return new Response(JSON.stringify({ error: 'At least one line item is required' }), { status: 400 });
    }

    const totals = calcQuoteTotals(body.line_items, body.vat_enabled);
    const quoteNumber = await generateNumber(supabase, businessId, 'quotes', 'QUO');

    const { data, error } = await supabase
      .from('quotes')
      .insert({
        business_id: businessId,
        contact_id: body.contact_id || null,
        quote_number: quoteNumber,
        status: 'draft',
        line_items: body.line_items,
        subtotal: totals.subtotal,
        vat_rate: totals.vat_rate,
        vat_amount: totals.vat_amount,
        total: totals.total,
        notes: body.notes || null,
        valid_until: body.valid_until || null,
        created_from: 'manual',
      })
      .select('*')
      .single();

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify(data), { status: 201 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
