import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const NOT_FOUND = () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

/**
 * Public (unauthenticated) invoice view, looked up by share token.
 * GET /api/public/invoice?slug=<businessSlug>&code=<n-token>
 * Never reveals WHICH part of the lookup failed — any miss is a plain 404.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') || '';
  const code = url.searchParams.get('code') || '';

  // code = "<invoiceNumber>-<shareToken>" — token is everything after the first '-'
  const dashIdx = code.indexOf('-');
  if (!slug || dashIdx === -1) return NOT_FOUND();
  const token = code.slice(dashIdx + 1);
  if (!token) return NOT_FOUND();

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('invoice_number, status, line_items, subtotal, vat_rate, vat_amount, total, notes, due_date, paid_at, created_at, payment_method, business:businesses(slug, name, logo_url, phone, vat_number, bank_details), contact:contacts(name)')
    .eq('share_token', token)
    .single();

  if (error || !invoice) return NOT_FOUND();

  const business = invoice.business as unknown as {
    slug: string;
    name: string;
    logo_url: string | null;
    phone: string | null;
    vat_number: string | null;
    bank_details: { account_name: string; sort_code: string; account_number: string; bank_name?: string } | null;
  } | null;

  if (!business || business.slug !== slug) return NOT_FOUND();

  const contact = invoice.contact as unknown as { name: string | null } | null;

  return new Response(
    JSON.stringify({
      invoice: {
        invoice_number: invoice.invoice_number,
        status: invoice.status,
        line_items: invoice.line_items,
        subtotal: invoice.subtotal,
        vat_rate: invoice.vat_rate,
        vat_amount: invoice.vat_amount,
        total: invoice.total,
        notes: invoice.notes,
        due_date: invoice.due_date,
        paid_at: invoice.paid_at,
        created_at: invoice.created_at,
        payment_method: invoice.payment_method,
      },
      business: {
        name: business.name,
        logo_url: business.logo_url,
        phone: business.phone,
        vat_number: business.vat_number,
        // Bank details only shown when the invoice is actually payable by transfer
        bank_details: invoice.payment_method === 'bank_transfer' ? business.bank_details : null,
      },
      customer: contact?.name ? { name: contact.name } : null,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
