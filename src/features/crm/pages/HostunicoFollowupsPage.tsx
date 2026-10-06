import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { sequencePosition, replySignal, hostunicoFollowupSms, type SequenceLead, type FollowupConfig } from '@/core/hostunicoFollowup';
import { useDesk } from '../lib/DeskContext';
import { useDialerProModal } from '../layout/DialerProModalContext';
import { followupAction, useHostunicoFollowups } from '../hooks/useHostunicoFollowups';
import { hostunicoFlowGraph } from '../lib/hostunicoFlowGraph';

import ReportFollowupCard from '../components/followups/ReportFollowupCard';

function Stage({ data }: NodeProps) {
  const d = data as { label: string; leads: SequenceLead[] };
  return <div className="w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><Handle type="target" position={Position.Top} /><b className="text-sm">{d.label}</b><div className="mt-2 max-h-32 overflow-y-auto space-y-1">{d.leads.map((l) => <a key={l.contact_id} href={`#lead-${l.contact_id}`} className="block rounded bg-slate-100 px-2 py-1 text-xs">{l.name || l.phone}{l.replied_at ? `: ${replySignal(l.intent)}` : ''}</a>)}{!d.leads.length && <span className="text-xs text-slate-400">No leads here</span>}</div><Handle type="source" position={Position.Bottom} /></div>;
}
const nodeTypes = { hostunicoStage: Stage };
export default function HostunicoFollowupsPage() {
  const { desk } = useDesk();
  const { leads, config, admin, error, reload } = useHostunicoFollowups(desk === 'sa');
  const { openDialerPro } = useDialerProModal();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState<FollowupConfig | null>(null);
  const [filter, setFilter] = useState('all');
  const graph = useMemo(() => hostunicoFlowGraph(config, leads), [config, leads]);
  async function act(action: string, values: Record<string, unknown>) {
    setBusy(String(values.contact_id || action)); setNotice('');
    try { await followupAction(action, values); await reload(); setNotice(action === 'send' ? 'SMS submitted. Check the inbox for delivery.' : 'Saved.'); } catch (e) { setNotice(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(''); }
  }
  if (desk !== 'sa') return <p className="p-6">Choose Serviced Accommodation to see Hostunico report follow-ups.</p>;
  const visible = leads.map((lead) => ({ lead, position: sequencePosition(lead, config) })).filter(({ position }) => filter === 'all' || (filter === 'due' ? position.node.startsWith('step') : position.node === filter));
  return <main className="h-full overflow-y-auto bg-slate-50 p-4 md:p-6 space-y-5">
    <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-xl font-semibold">Report follow-ups</h1><p className="mt-1 text-sm text-slate-500">Review upcoming messages and take over when a lead is ready. Replies and bookings stop automatic follow-ups.</p></div><button onClick={() => void reload()} className="rounded-lg border bg-white px-4 py-2 text-sm">Refresh</button></header>
    {(error || notice) && <p role="status" className="rounded-lg border bg-white p-3 text-sm">{error || notice}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(350px,0.85fr)_minmax(500px,1.15fr)]">
      <section className="h-[650px] rounded-xl border bg-white" aria-label="Report follow-up flow"><ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} minZoom={0.3}><Background /><Controls showInteractive={false} /></ReactFlow></section>
      <section><div className="mb-3 flex flex-wrap gap-2">{['all', 'due', 'replied', 'cold'].map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-2 text-sm ${filter === f ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{f === 'due' ? 'Due now' : f[0].toUpperCase() + f.slice(1)}</button>)}</div>
        <div className="space-y-3">{visible.map(({ lead: l, position: p }) => <article id={`lead-${l.contact_id}`} key={l.contact_id} className="rounded-xl border bg-white p-4 space-y-3">
          <div className="flex justify-between gap-2"><b>{l.name || l.phone}</b><span className="text-sm text-blue-700">{l.reviewed_plan ? 'Reviewed plan' : p.label}</span></div>
          <p className="text-xs text-slate-500">Report sent {new Date(l.report_sent_at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}{!l.reviewed_plan && p.dueAt ? ` | Due ${new Date(p.dueAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}` : ''}</p>
          {l.reviewed_plan ? <ReportFollowupCard contactId={l.contact_id} /> : l.replied_at ? <><p className="text-sm">{l.reason} {l.classification_pending ? 'AI classification pending.' : `${Math.round((l.confidence || 0) * 100)}% confidence`}</p><div className="flex flex-wrap gap-2">{(['positive', 'neutral', 'negative'] as const).map((intent) => <button key={intent} disabled={!!busy} onClick={() => void act('override', { contact_id: l.contact_id, intent })} aria-pressed={l.intent === intent} className="rounded-lg border px-3 py-2 text-xs">{replySignal(intent)}</button>)}</div></> : p.step && <><p className="text-sm">{hostunicoFollowupSms(p.step.text)}</p>{!p.step.approved && <p className="text-xs text-amber-700">Draft for Hugo approval. Sending is disabled.</p>}<button disabled={!!busy || p.node !== p.step.id || !p.step.approved || l.send_state !== 'idle'} onClick={() => void act('send', { contact_id: l.contact_id, step: p.step!.id })} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">{busy === l.contact_id ? 'Working...' : 'Send this SMS'}</button></>}
          {l.send_state === 'check_inbox' && <p className="text-xs text-amber-700">Previous send uncertain. Check the inbox; no automatic retry.</p>}
          <div className="flex flex-wrap gap-3 text-xs"><a href={`/admin/crm/inbox?contact=${l.contact_id}`} className="underline">Open conversation</a>{l.intent !== 'negative' && <button onClick={() => openDialerPro(l.contact_id)} className="underline">Call this lead</button>}{!l.replied_at && <button disabled={!!busy} onClick={() => void act('log_contact', { contact_id: l.contact_id })} className="underline">They contacted me</button>}</div>
        </article>)}{!visible.length && <p className="rounded-xl border bg-white p-5 text-sm text-slate-500">No leads here yet. Sending a report starts its tracking.</p>}</div>
      </section>
    </div>
    {admin && <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-medium">Hugo: timing, branches and draft approval</summary><p className="mt-2 text-sm text-slate-500">These defaults appear in the review before Send report. Existing scheduled messages keep their saved wording and dates. Draft approval also enables legacy manual sends.</p>
      <div className="mt-4 space-y-4">{(draft || config).steps.map((step, index) => <div key={step.id} className="rounded-lg border p-3 space-y-2"><b>{step.label}</b><label className="ml-3 text-sm">Wait <input aria-label={`${step.label} wait hours`} type="number" min="1" max="720" value={step.waitHours} onChange={(e) => setDraft({ ...(draft || config), steps: (draft || config).steps.map((s, i) => i === index ? { ...s, waitHours: Number(e.target.value) } : s) })} className="w-20 rounded border p-2" /> hours after the previous send</label><textarea aria-label={`${step.label} message`} value={step.text} onChange={(e) => setDraft({ ...(draft || config), steps: (draft || config).steps.map((s, i) => i === index ? { ...s, text: e.target.value, approved: false } : s) })} className="block w-full rounded border p-2 text-sm" /><label className="flex gap-2 text-sm"><input type="checkbox" checked={step.approved} onChange={(e) => setDraft({ ...(draft || config), steps: (draft || config).steps.map((s, i) => i === index ? { ...s, approved: e.target.checked } : s) })} />I approve this wording for manual sending</label></div>)}</div>
      {(draft || config).steps.length < 8 && <button className="mt-3 rounded border px-3 py-2 text-sm" onClick={() => { const current = draft || config; const n = current.steps.length + 1; setDraft({ ...current, steps: [...current.steps, { id: `step${n}`, label: `Step ${n}`, waitHours: 24, text: 'Write one short question.', approved: false }] }); }}>Add a step</button>}
      <div className="mt-4 space-y-2">{(draft || config).branches.map((branch, index) => <label key={branch.intent} className="flex items-center gap-3 text-sm">{branch.intent} reply<select value={branch.target} onChange={(e) => setDraft({ ...(draft || config), branches: (draft || config).branches.map((b, i) => i === index ? { ...b, target: e.target.value as 'replied' | 'cold' } : b) })} className="rounded border p-2"><option value="replied">Replied. Pedro takes over</option><option value="cold">Cold. Stop following up</option></select></label>)}</div>
      <button disabled={!!busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white" onClick={() => void act('config', { config: draft || config })}>Save flow</button>
    </details>}
  </main>;
}
