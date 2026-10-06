import { supabase } from '@/integrations/supabase/browser';

export async function reportAction(action: string, values: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in.');
  const status = action === 'status';
  const query = new URLSearchParams({ action, listing_id: String(values.listing_id ?? '') });
  const response = await fetch(`/api/crm/sa-report${status ? `?${query}` : ''}`, {
    method: status ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    ...(status ? {} : { body: JSON.stringify({ action, ...values }) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not complete this report action.');
  return result;
}
