import type { SupabaseClient } from '@supabase/supabase-js';

export async function generateNumber(
  supabase: SupabaseClient,
  businessId: string,
  table: 'quotes' | 'invoices',
  prefix: 'QUO' | 'INV',
): Promise<string> {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId);

  return `${prefix}-${String((count ?? 0) + 1).padStart(3, '0')}`;
}
