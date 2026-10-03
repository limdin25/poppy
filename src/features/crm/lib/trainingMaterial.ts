// "Good objections / training material" (Pedro, 3 Oct 2026). A separate tag
// on the call, never the call's outcome: tagging cannot move the lead's board
// stage, change its next step or mark it do not contact. The database function
// only touches the four training columns, and only on the caller's own calls
// (or any call for an admin).

import { supabase } from '@/integrations/supabase/browser';

export const TRAINING_LABEL = 'Good objections / training material';

export async function setTrainingMaterial(callId: string, on: boolean, note?: string | null): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('wk_set_training_material', { p_call: callId, p_on: on, p_note: note ?? null });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('This call could not be tagged. You can only tag your own calls.');
}

export async function readTrainingMaterial(callId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('wk_calls' as any) as any).select('training_material').eq('id', callId).maybeSingle();
  return data?.training_material === true;
}
