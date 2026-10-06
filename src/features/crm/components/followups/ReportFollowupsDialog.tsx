import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Clock3, Mail, MessageSquare, X } from 'lucide-react';
import { editableFollowup, londonInput, londonInstant, skipFollowupPlan, validateFollowupPlan, type ReportFollowupItem } from '@/core/hostunicoFollowupPlan';

export interface ReportFollowupPlan { name: string; items: ReportFollowupItem[]; stopReason?: string | null }
interface Props {
  open: boolean; onClose: () => void; plan: ReportFollowupPlan | null; loading?: boolean; error?: string;
  onConfirm: (items: ReportFollowupItem[]) => Promise<void>; mode?: 'send' | 'edit';
}
export default function ReportFollowupsDialog({ open, onClose, plan, loading, error, onConfirm, mode = 'send' }: Props) {
  const [items, setItems] = useState<ReportFollowupItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  useEffect(() => { setItems(plan?.items || []); setIssue(''); }, [plan, open]);
  const enabled = items.filter(i => editableFollowup(i) && i.enabled).length;
  const patch = (index: number, value: Partial<ReportFollowupItem>) => { setItems(current => current.map((i,n) => n === index ? { ...i, ...value } : i)); setIssue(''); };
  async function submit() {
    if (busy || loading || !plan) return;
    const invalid = validateFollowupPlan(items);
    if (invalid) { setIssue(invalid); return; }
    setBusy(true); setIssue('');
    try { await onConfirm(items); onClose(); }
    catch (e) { setIssue(e instanceof Error ? e.message : 'Could not save. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[450] bg-slate-950/40 backdrop-blur-[3px]" />
      <Dialog.Content data-report-followups-dialog className="fixed left-1/2 top-1/2 z-[451] flex h-[min(760px,92dvh)] w-[calc(100%-24px)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-white shadow-2xl outline-none"
        onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => e.preventDefault()}>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={e => { e.preventDefault(); void submit(); }} onKeyDown={e => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); void submit(); }
        }}>
          <header className="shrink-0 border-b border-slate-100 px-6 pb-5 pt-6 sm:px-8">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700"><Clock3 size={15} /> A little help staying in touch</div>
            <Dialog.Title className="pr-8 text-2xl font-semibold tracking-tight text-slate-950">Follow-ups for {plan?.name || 'this lead'}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-relaxed text-slate-500">{mode === 'send' ? 'Your report goes now. These messages follow later, only if they have not replied or booked.' : 'Make it personal, change the timing, or take over yourself.'}</Dialog.Description>
            <Dialog.Close disabled={busy} aria-label="Close follow-ups" className="absolute right-5 top-5 rounded-full p-2 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-600"><X size={18} /></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 sm:px-8" aria-busy={loading}>
            <div className="mb-4 flex items-center justify-between gap-3 text-xs"><span className="font-medium text-slate-500">All times Europe/London</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">09:00 to 20:00</span></div>
            {loading ? <div role="status" className="space-y-4">{[1,2,3].map(n => <div key={n} className="h-36 animate-pulse rounded-2xl bg-slate-100" />)}<span className="sr-only">Loading follow-ups</span></div> : <>
              {plan?.stopReason && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Automatic follow-ups stopped: {plan.stopReason}.</p>}
              <ol className="space-y-4">{items.map((item,index) => {
                const editable = editableFollowup(item) && !plan?.stopReason;
                const local = londonInput(item.scheduled_for);
                const Icon = item.channel === 'email' ? Mail : MessageSquare;
                const changeTime = (value: string) => { try { patch(index, { scheduled_for: londonInstant(value) }); } catch (e) { setIssue(e instanceof Error ? e.message : 'Choose a date and time.'); } };
                return <li key={item.step_key} className={`rounded-2xl border p-4 transition-colors ${item.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 items-center justify-center rounded-full ${item.enabled ? 'bg-teal-50 text-teal-700' : 'bg-slate-200 text-slate-500'}`}><Icon size={15} /></span><span className="text-sm font-semibold text-slate-900">{item.channel === 'email' ? 'Email' : 'SMS'} {index + 1}</span>{item.status && !['scheduled','edited','skipped'].includes(item.status) && <span className="text-xs capitalize text-slate-500">{item.status === 'check_inbox' ? 'Check inbox' : item.status}</span>}</div>
                    {editable && <div className="flex items-center gap-2 text-xs text-slate-500"><span>{item.enabled ? 'On' : 'Off'}</span><button type="button" role="switch" aria-label={`Enable follow-up ${index+1}`} aria-checked={item.enabled} disabled={busy} onClick={() => patch(index, { enabled: !item.enabled })} className={`relative h-6 w-10 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${item.enabled ? 'bg-teal-700' : 'bg-slate-300'}`}><span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${item.enabled ? 'translate-x-4' : ''}`} /></button></div>}
                  </div>
                  <div className="mb-3 grid grid-cols-[1fr_110px] gap-2">
                    <label className="text-[11px] font-medium text-slate-500">Date<input aria-label={`Follow-up ${index+1} date, London`} type="date" min={londonInput(Date.now()).slice(0,10)} value={local.slice(0,10)} disabled={!editable || !item.enabled || busy} onChange={e => changeTime(`${e.target.value}T${local.slice(11)}`)} className="mt-1 block w-full rounded-lg border-slate-200 px-3 py-2 text-sm text-slate-800 disabled:opacity-50" /></label>
                    <label className="text-[11px] font-medium text-slate-500">Time<input aria-label={`Follow-up ${index+1} time, London`} type="time" min="09:00" max="19:59" value={local.slice(11)} disabled={!editable || !item.enabled || busy} onChange={e => changeTime(`${local.slice(0,10)}T${e.target.value}`)} className="mt-1 block w-full rounded-lg border-slate-200 px-3 py-2 text-sm text-slate-800 disabled:opacity-50" /></label>
                  </div>
                  {item.channel === 'email' && <input aria-label={`Follow-up ${index+1} subject`} value={item.subject} onChange={e => patch(index,{ subject:e.target.value })} disabled={!editable || !item.enabled || busy} maxLength={200} className="mb-2 w-full rounded-lg border-slate-200 px-3 py-2 text-sm disabled:opacity-50" />}
                  <textarea aria-label={`Follow-up ${index+1} message`} value={item.body} onChange={e => patch(index,{ body:e.target.value })} readOnly={!editable || !item.enabled || busy} rows={4} maxLength={item.channel==='sms'?1600:10000} className={`block w-full resize-y rounded-lg border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-teal-600 focus:ring-teal-600 ${item.enabled ? 'text-slate-700' : 'text-slate-400'}`} />
                  {item.cancel_reason && <p className="mt-2 text-xs text-slate-500">{item.cancel_reason}</p>}
                </li>;
              })}</ol>
            </>}
          </div>
          <footer className="shrink-0 border-t border-slate-100 bg-white px-6 pb-5 pt-4 sm:px-8">
            <div className="mb-3 min-h-5 text-sm" aria-live="polite">{issue || error ? <p role="alert" className="text-red-700">{issue || error}</p> : <p className="flex items-center gap-1.5 text-slate-500"><Check size={15} className="text-teal-700" />{enabled ? `${enabled} automatic follow-up${enabled === 1 ? '' : 's'}. You can change these later.` : 'No automatic follow-ups. You are in control.'}</p>}</div>
            <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={busy || loading || !plan} onClick={() => { setItems(skipFollowupPlan(items)); setIssue(''); }} className="text-xs font-medium text-slate-600 underline decoration-slate-300 underline-offset-4 hover:text-slate-950 disabled:opacity-40">Skip follow-ups, I've got it</button><div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button><button type="submit" disabled={busy || loading || !plan} className="rounded-xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-teal-800 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 disabled:opacity-40">{busy ? (mode === 'send' ? 'Sending...' : 'Saving...') : mode === 'send' ? 'Send report' : 'Save changes'}</button></div></div>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
