import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** The business's outbound SMS number = the phone on its connected voice channel. */
export async function getSmsFromNumber(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('config')
    .eq('business_id', businessId)
    .eq('type', 'voice')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle();
  return (data?.config as Record<string, string> | null)?.phone ?? null;
}

/** The Unipile account id for the business's connected WhatsApp channel. */
export async function getWhatsAppAccountId(businessId: string): Promise<string | null> {
  const { data } = await supabase
    .from('channels')
    .select('unipile_account_id')
    .eq('business_id', businessId)
    .eq('type', 'whatsapp')
    .eq('status', 'connected')
    .limit(1)
    .maybeSingle();
  return data?.unipile_account_id ?? null;
}
