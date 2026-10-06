// Narrow internal doorway for plans Pedro reviewed. No arbitrary service-key sends.
export interface ReviewedFollowup {
  id: string; contact_id: string; agent_id: string; channel: string; recipient: string;
  subject: string; body: string; version: number; status: string; armed_at: string | null;
}
export async function loadReviewedFollowup(db: any, jwt: string, jobsKey: string, payload: Record<string, unknown>, channel: string): Promise<ReviewedFollowup | null> {
  if (!payload.report_followup_id) return null;
  if (!jobsKey || jwt !== jobsKey || typeof payload.report_followup_id !== 'string') throw new Error('Internal follow-up authentication required.');
  const { data, error } = await db.from('sa_report_followup_items').select('*').eq('id', payload.report_followup_id).maybeSingle();
  if (error || !data || data.channel !== channel || !data.armed_at || !['scheduled', 'edited'].includes(data.status)) throw new Error('This follow-up has stopped or already been sent.');
  return data;
}
export async function claimReviewedFollowup(db: any, item: ReviewedFollowup | null) {
  if (!item) return;
  const { data, error } = await db.rpc('sa_claim_report_followup', { p_item: item.id, p_version: item.version });
  if (error || data !== true) throw new Error('This follow-up stopped or changed before sending.');
}
export async function finishReviewedFollowup(db: any, item: ReviewedFollowup | null, providerId?: string) {
  if (!item) return;
  const { error } = await db.from('sa_report_followup_items').update({ status: providerId ? 'sent' : 'check_inbox', provider_id: providerId || null, sent_at: providerId ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', item.id);
  if (error) throw new Error('Message submitted. Its receipt needs checking; it will not retry.');
}
