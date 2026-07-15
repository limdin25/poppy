import { useEffect, useMemo, useState, useCallback } from 'react';
import { Megaphone, Send, Users, Tag, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsTemplates } from '../hooks/useSmsTemplates';

interface NumberRow { id: string; e164: string; label: string | null }
interface Broadcast {
  id: string;
  name: string;
  template_body: string;
  from_e164: string | null;
  total: number;
  sent: number;
  failed: number;
  status: string;
  created_at: string;
}

type Segment = { mode: 'all' } | { mode: 'tags'; tags: string[] };

export default function BroadcastsPage() {
  const { items: allTemplates } = useSmsTemplates();
  const templates = useMemo(
    () => allTemplates.filter((t) => t.channel === null || t.channel === 'sms'),
    [allTemplates],
  );
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [fromE164, setFromE164] = useState('');
  const [segMode, setSegMode] = useState<'all' | 'tags'>('tags');
  const [tagsInput, setTagsInput] = useState('');
  const [throttle, setThrottle] = useState(3);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadNumbers = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_numbers') as any)
      .select('id, e164, label')
      .eq('is_active', true)
      .eq('sms_enabled', true)
      .order('e164', { ascending: true });
    const rows = (data ?? []) as NumberRow[];
    setNumbers(rows);
    // Default to the SMS-approved US toll-free if present.
    if (!fromE164 && rows.length) {
      setFromE164(rows.find((n) => n.e164 === '+18333706994')?.e164 ?? rows[0].e164);
    }
  }, [fromE164]);

  const loadBroadcasts = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_broadcasts') as any)
      .select('id, name, template_body, from_e164, total, sent, failed, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    setBroadcasts((data ?? []) as Broadcast[]);
  }, []);

  useEffect(() => { void loadNumbers(); }, [loadNumbers]);
  useEffect(() => {
    void loadBroadcasts();
    const ch = supabase
      .channel('wk_broadcasts-page')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'wk_broadcasts' }, () => void loadBroadcasts())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [loadBroadcasts]);

  const segment: Segment = useMemo(() => {
    if (segMode === 'all') return { mode: 'all' };
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    return { mode: 'tags', tags };
  }, [segMode, tagsInput]);

  const canSend = body.trim().length > 0 && fromE164 &&
    (segment.mode === 'all' || segment.tags.length > 0) && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setMsg(null);
    try {
      const filter = segment.mode === 'all' ? { all: true } : { tags: segment.tags };
      const { data, error } = await supabase.functions.invoke('wk-sms-broadcast', {
        body: {
          name: name.trim() || undefined,
          template_body: body,
          from_e164: fromE164,
          channel: 'sms',
          throttle_seconds: throttle,
          filter,
        },
      });
      if (error) throw new Error(error.message);
      const res = data as { total?: number; error?: string };
      if (res?.error) throw new Error(res.error);
      setMsg({ kind: 'ok', text: `Queued ${res.total ?? 0} messages.` });
      setName(''); setBody(''); setTagsInput('');
      void loadBroadcasts();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="w-5 h-5 text-[#3C5A87]" />
        <h1 className="text-[22px] font-bold text-[#1A1A1A]">Broadcasts</h1>
      </div>
      <p className="text-[13px] text-[#6B7280] mb-5">Send an SMS to a list of contacts. Messages are throttled and logged to each contact's timeline.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Compose */}
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
          <div className="text-[13px] font-semibold text-[#1A1A1A] mb-3">New broadcast</div>

          <label className="text-[11px] font-medium text-[#6B7280]">Name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Plumber outreach — week 1"
            className="mt-1 mb-3 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30" />

          <label className="text-[11px] font-medium text-[#6B7280]">Template</label>
          <select onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setBody(t.body_md); }}
            className="mt-1 mb-2 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 bg-white">
            <option value="">— pick a template (optional) —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
            placeholder="Hi {first_name}, ... — use {first_name} for personalisation"
            className="w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 mb-1 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30" />
          <div className="text-[11px] text-[#9CA3AF] mb-3">{body.length}/1600 · {'{first_name}'} and {'{agent_first_name}'} supported</div>

          <label className="text-[11px] font-medium text-[#6B7280]">Send from</label>
          <select value={fromE164} onChange={(e) => setFromE164(e.target.value)}
            className="mt-1 mb-3 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 bg-white">
            {numbers.map((n) => <option key={n.id} value={n.e164}>{n.label ? `${n.label} · ${n.e164}` : n.e164}</option>)}
          </select>

          <label className="text-[11px] font-medium text-[#6B7280]">Recipients</label>
          <div className="mt-1 mb-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
              <input type="radio" checked={segMode === 'tags'} onChange={() => setSegMode('tags')} />
              <Tag className="w-3.5 h-3.5 text-[#6B7280]" /> By tag(s)
            </label>
            {segMode === 'tags' && (
              <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="tag1, tag2"
                className="ml-6 text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30" />
            )}
            <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
              <input type="radio" checked={segMode === 'all'} onChange={() => setSegMode('all')} />
              <Users className="w-3.5 h-3.5 text-[#6B7280]" /> All contacts
            </label>
          </div>

          <label className="text-[11px] font-medium text-[#6B7280]">Throttle (seconds between sends)</label>
          <input type="number" min={0} max={60} value={throttle} onChange={(e) => setThrottle(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            className="mt-1 mb-4 w-24 text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />

          {msg && (
            <div className={`mb-3 text-[12px] px-3 py-2 rounded-lg ${msg.kind === 'ok' ? 'bg-[#EEF2F8] text-[#283C5C]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>{msg.text}</div>
          )}

          <button onClick={send} disabled={!canSend}
            className="w-full flex items-center justify-center gap-2 bg-[#3C5A87] disabled:opacity-40 text-white text-[13px] font-semibold py-2.5 rounded-xl hover:bg-[#3C5A87]/90">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Queuing…' : 'Send broadcast'}
          </button>
        </div>

        {/* History */}
        <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
          <div className="text-[13px] font-semibold text-[#1A1A1A] mb-3">History</div>
          {broadcasts.length === 0 && <div className="text-[12px] text-[#9CA3AF] py-6 text-center">No broadcasts yet.</div>}
          <div className="flex flex-col gap-2">
            {broadcasts.map((b) => {
              const done = b.sent + b.failed;
              const pct = b.total ? Math.round((done / b.total) * 100) : 0;
              return (
                <div key={b.id} className="border border-[#E5E7EB] rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[13px] font-medium text-[#1A1A1A] truncate">{b.name}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${b.status === 'done' ? 'bg-[#EEF2F8] text-[#283C5C]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>{b.status}</span>
                  </div>
                  <div className="text-[11px] text-[#6B7280] truncate mt-0.5">{b.template_body}</div>
                  <div className="mt-2 h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden">
                    <div className="h-full bg-[#3C5A87]" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-[#9CA3AF] tabular-nums">
                    {b.sent} sent{b.failed ? ` · ${b.failed} failed` : ''} / {b.total} · from {b.from_e164 ?? 'default'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
