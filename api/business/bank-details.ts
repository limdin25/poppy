import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PUT') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { businessId } = auth;

  const body = await req.json() as {
    bank_name?: string;
    account_name: string;
    sort_code: string;
    account_number: string;
  };

  if (!body.account_name || !body.sort_code || !body.account_number) {
    return new Response(JSON.stringify({ error: 'account_name, sort_code, and account_number required' }), { status: 400 });
  }

  const bank_details = {
    bank_name: body.bank_name || undefined,
    account_name: body.account_name,
    sort_code: body.sort_code,
    account_number: body.account_number,
  };

  const { data, error } = await supabase
    .from('businesses')
    .update({ bank_details })
    .eq('id', businessId)
    .select('bank_details')
    .single();

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify(data), { status: 200 });
}
