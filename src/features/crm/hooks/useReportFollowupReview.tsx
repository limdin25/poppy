import { useRef, useState } from 'react';
import ReportFollowupsDialog, { type ReportFollowupPlan } from '../components/followups/ReportFollowupsDialog';
import { reportAction } from '../lib/hostunicoReportApi';

export function useReportFollowupReview(listingId: string | undefined, channel: 'sms' | 'email', onSent: (result: { warning?: string }) => Promise<void> | void) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ReportFollowupPlan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const values = useRef<Record<string, unknown>>({});
  const generation = useRef(0);
  async function openReview(payload: Record<string, unknown>) {
    if (!listingId || open) return;
    values.current = payload; setPlan(null); setError(''); setOpen(true); setLoading(true);
    const request = ++generation.current;
    try { const p = await reportAction('followup_plan', { listing_id: listingId, channel }); if (request === generation.current) setPlan(p); }
    catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not load follow-ups. Close and try again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }
  return { open, openReview, dialog: <ReportFollowupsDialog open={open} onClose={() => { generation.current++; setOpen(false); }} plan={plan} error={error} loading={loading} onConfirm={async items => {
    const result = await reportAction(channel === 'email' ? 'send_email' : 'send_sms', { ...values.current, listing_id: listingId, followups: items });
    await onSent(result);
  }} /> };
}
