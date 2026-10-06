import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { followupAction } from '../../hooks/useHostunicoFollowups';
import { useDesk } from '../../lib/DeskContext';

export function reportFollowupStageChanged(contactId: string) {
  window.dispatchEvent(new CustomEvent('hostunico-followup-stage', { detail: contactId }));
}
export default function ReportFollowupStageNotice() {
  const { desk } = useDesk();
  const [notice, setNotice] = useState<{ id: string; name: string; stopped: boolean; reason?: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (desk !== 'sa') return;
    let current = 0;
    const changed = async (event: Event) => {
      const id = (event as CustomEvent<string>).detail, request = ++current;
      try {
        const plan = await followupAction('items', { contact_id: id });
        if (request !== current || !plan.items?.length) return;
        const pending = plan.items.some((i: { status: string }) => ['scheduled','edited'].includes(i.status));
        if (plan.stopReason || (plan.stage === 'Interested' && pending)) { setError(''); setNotice({ id, name: plan.name, stopped: !!plan.stopReason, reason: plan.stopReason }); }
      } catch { /* The contact card still offers the same controls. */ }
    };
    window.addEventListener('hostunico-followup-stage', changed);
    return () => { current++; window.removeEventListener('hostunico-followup-stage', changed); };
  }, [desk]);
  if (!notice) return null;
  return <aside role="status" className="fixed bottom-6 right-6 z-[460] w-[min(380px,calc(100vw-48px))] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
    <button aria-label="Dismiss follow-up notice" onClick={() => setNotice(null)} className="absolute right-3 top-3 rounded-full p-1 text-slate-500"><X size={16} /></button>
    <h3 className="pr-4 text-sm font-semibold">{notice.stopped ? 'Automatic follow-ups stopped' : 'Taking this one personally?'}</h3>
    <p className="mt-2 text-sm text-slate-600">{notice.stopped ? `${notice.name}: ${notice.reason}. Pending messages will not go out.` : `Stop the pending automatic messages for ${notice.name} while you follow up.`}</p>
    {!notice.stopped && <div className="mt-3 flex gap-3 text-sm"><button disabled={busy} onClick={async () => { setBusy(true); try { await followupAction('cancel_items', { contact_id: notice.id }); setNotice(null); } catch { setError('Could not stop the messages. Try again.'); } finally { setBusy(false); } }} className="rounded-lg bg-slate-950 px-3 py-2 font-semibold text-white">Stop follow-ups</button><button onClick={() => setNotice(null)} className="px-2 py-2 text-slate-600">Keep them</button></div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </aside>;
}
