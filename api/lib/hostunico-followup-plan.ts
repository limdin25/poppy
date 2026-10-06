import type { SupabaseClient } from '@supabase/supabase-js';
import { buildFollowupPlan, validateFollowupPlan, type ReportFollowupItem } from '../../src/core/hostunicoFollowupPlan.js';
import { validFollowupConfig } from '../../src/core/hostunicoFollowup.js';

export async function reportFollowupPlan(db: SupabaseClient, contact: { id: string; name: string }, listing: { id: string; address: string }, reportUrl: string, channel: 'sms' | 'email') {
  const [items, config, stop, sequence] = await Promise.all([
    db.from('sa_report_followup_items').select('*').eq('contact_id', contact.id).order('step_key'),
    db.from('sa_followup_config').select('config').eq('id', true).single(),
    db.rpc('sa_report_followup_stop_reason', { p_contact: contact.id }),
    db.from('sa_report_followups').select('sent_steps').eq('contact_id', contact.id).maybeSingle(),
  ]);
  if (items.error || config.error || stop.error || sequence.error || !validFollowupConfig(config.data?.config)) throw new Error('Could not load the follow-up plan. Please try again.');
  const saved = items.data || [];
  const plan: ReportFollowupItem[] = saved.length ? saved.map(i => ({ ...i, enabled: ['scheduled', 'edited'].includes(i.status) }))
    : buildFollowupPlan(config.data.config, { name: contact.name, property: listing.address || 'your property', reportUrl, channel }).map(i => sequence.data?.sent_steps?.[i.step_key]
      ? { ...i, enabled: false, status: 'sent', sent_at: sequence.data.sent_steps[i.step_key] }
      : { ...i, enabled: !stop.data });
  return { items: plan, name: contact.name, stopReason: stop.data as string | null, existing: saved.length > 0, listingId: saved[0]?.listing_id || listing.id, recipient: saved[0]?.recipient };
}

export async function saveReportFollowupPlan(db: SupabaseClient, values: { contact: string; listing: string; channel: 'sms' | 'email'; recipient: string; items: ReportFollowupItem[]; agent: string }) {
  const invalid = validateFollowupPlan(values.items);
  if (invalid) throw new Error(invalid);
  const { error } = await db.rpc('sa_save_report_followup_plan', { p_contact: values.contact, p_listing: values.listing, p_channel: values.channel, p_recipient: values.recipient, p_items: values.items, p_agent: values.agent });
  if (error) throw new Error(error.message || 'Could not save the follow-up plan. Refresh and try again.');
}
