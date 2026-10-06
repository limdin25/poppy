import { useCallback, useEffect, useState } from 'react';
import { Clock3, Mail, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { editableFollowup, skipFollowupPlan } from '@/core/hostunicoFollowupPlan';
import { followupAction } from '../../hooks/useHostunicoFollowups';
import { ukLabel } from '../../lib/ukTime';
import ReportFollowupsDialog, { type ReportFollowupPlan } from './ReportFollowupsDialog';

export default function ReportFollowupCard({ contactId, refreshVersion = 0 }: { contactId: string; refreshVersion?: number }) {
  const [plan, setPlan] = useState<(ReportFollowupPlan & { stage?: string }) | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<ReportFollowupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const load = useCallback(async () => {
    try { const result = await followupAction('items', { contact_id: contactId }); setPlan(result); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load follow-ups.'); }
  }, [contactId]);
  useEffect(() => {
    void load();
    const channel = supabase.channel(`report-plan-${contactId}-${Math.random()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sa_report_followup_items', filter: `contact_id=eq.${contactId}` }, () => void load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'wk_contacts', filter: `id=eq.${contactId}` }, () => void load()).subscribe();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { void supabase.removeChannel(channel); window.clearInterval(timer); };
  }, [load, contactId, refreshVersion]);
  async function act(action: string, values: Record<string, unknown> = {}) {
    setBusy(true); setError('');
    try { await followupAction(action, { contact_id: contactId, ...values }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save follow-ups.'); }
    finally { setBusy(false); }
  }
  if (!plan?.items.length) return error ? <p className="mt-3 text-xs text-red-700" role="alert">{error}</p> : null;
  const pending = plan.items.filter(i => i.enabled && editableFollowup(i));
  return <section aria-label="Scheduled report follow-ups" className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={16} className="text-teal-700" />Report follow-ups</h3><button onClick={() => { setEditPlan(plan); setOpen(true); }} className="text-xs font-semibold text-teal-700 underline underline-offset-4">View and edit</button></div>
    <p className="mt-1 text-xs text-slate-500">{pending.length ? `${pending.length} scheduled. Europe/London.` : 'No automatic messages pending.'}</p>
    {plan.stage === 'Interested' && pending.length > 0 && !dismissed && <div className="mt-3 rounded-xl bg-teal-50 p-3 text-xs text-teal-950"><p>Taking this one personally? Stop the automatic follow-ups.</p><div className="mt-2 flex gap-3"><button disabled={busy} onClick={() => void act('cancel_items')} className="font-semibold underline">Stop follow-ups</button><button onClick={() => setDismissed(true)}>Keep them</button></div></div>}
    {plan.stopReason && <p className="mt-2 text-xs text-amber-800">Stopped: {plan.stopReason}. Pending messages will not be sent.</p>}
    <ol className="mt-3 space-y-3">{plan.items.map(i => <li key={i.step_key} className="border-t border-slate-100 pt-2 text-xs"><div className="flex items-start justify-between gap-2"><span className="flex items-center gap-1.5 font-medium">{i.channel === 'email' ? <Mail size={13} /> : <MessageSquare size={13} />}{ukLabel(i.scheduled_for)}</span><span className="capitalize text-slate-500">{i.status === 'check_inbox' ? 'Check inbox' : i.status === 'sending' ? 'Sending' : i.status}{i.enabled && !i.armed_at ? ' (report not confirmed)' : ''}</span></div><p className="mt-1 line-clamp-2 leading-relaxed text-slate-500">{i.body}</p>{i.enabled && editableFollowup(i) && <button disabled={busy} onClick={() => void act('cancel_items', { item_id: i.id })} className="mt-1.5 text-slate-600 underline">Cancel this follow-up</button>}</li>)}</ol>
    {pending.length > 0 && <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs"><button disabled={busy} onClick={() => void act('save_items', { items: skipFollowupPlan(plan.items) })} className="font-medium text-slate-600 underline">Skip all, I've got it</button><button disabled={busy} onClick={() => void act('cancel_items')} className="text-slate-600 underline">Cancel all</button></div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    <ReportFollowupsDialog open={open} onClose={() => setOpen(false)} plan={editPlan} mode="edit" onConfirm={async items => { await followupAction('save_items', { contact_id: contactId, items }); await load(); }} />
  </section>;
}
