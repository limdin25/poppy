import { useEffect, useState, useCallback } from 'react';
import { Bot, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

interface Settings {
  enabled: boolean;
  mode: 'draft' | 'auto';
  reply_delay_seconds: number;
  max_replies_per_contact: number;
  hours_start: number;
  hours_end: number;
  days: string[];
  timezone: string;
  auto_off_on_human_reply: boolean;
  auto_off_on_booking: boolean;
  handoff_keywords: string[];
  model: string;
  system_prompt: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AiReplyPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_ai_reply_settings') as any)
      .select('*').eq('id', 'default').maybeSingle();
    if (data) setS(data as Settings);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!s) return;
    setSaving(true); setMsg(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_ai_reply_settings') as any)
      .update({ ...s }).eq('id', 'default');
    setSaving(false);
    setMsg(error ? `Error: ${error.message}` : 'Saved.');
  };

  if (!s) return <div className="p-6 text-[13px] text-[#6B7280]">Loading…</div>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="w-5 h-5 text-[#3C5A87]" />
        <h1 className="text-[22px] font-bold text-[#1A1A1A]">AI warm-up</h1>
      </div>
      <p className="text-[13px] text-[#6B7280] mb-5">When a lead texts back, the AI replies using the pitch below — as a draft you approve, or auto-sent. Stops on human reply, booking, keyword, or the reply cap.</p>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 space-y-4">
        {/* Master switch + mode */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">AI replies</div>
            <div className="text-[11px] text-[#6B7280]">Turn the whole engine on or off.</div>
          </div>
          <button onClick={() => set('enabled', !s.enabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${s.enabled ? 'bg-[#3C5A87]' : 'bg-[#D1D5DB]'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${s.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[#6B7280]">Mode</label>
          <div className="mt-1 flex gap-2">
            {(['draft', 'auto'] as const).map((m) => (
              <button key={m} onClick={() => set('mode', m)}
                className={`flex-1 text-[13px] py-2 rounded-lg border ${s.mode === m ? 'border-[#3C5A87] bg-[#EEF2F8] text-[#283C5C] font-semibold' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
                {m === 'draft' ? 'Draft (VA approves)' : 'Auto-send'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-[#6B7280]">Reply delay (seconds)</label>
            <input type="number" min={0} value={s.reply_delay_seconds}
              onChange={(e) => set('reply_delay_seconds', Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#6B7280]">Max replies per lead</label>
            <input type="number" min={1} value={s.max_replies_per_contact}
              onChange={(e) => set('max_replies_per_contact', Math.max(1, Number(e.target.value) || 1))}
              className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#6B7280]">Hours start (0–24)</label>
            <input type="number" min={0} max={24} value={s.hours_start}
              onChange={(e) => set('hours_start', Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
              className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#6B7280]">Hours end (0–24)</label>
            <input type="number" min={0} max={24} value={s.hours_end}
              onChange={(e) => set('hours_end', Math.max(0, Math.min(24, Number(e.target.value) || 24)))}
              className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[#6B7280]">Active days</label>
          <div className="mt-1 flex gap-1 flex-wrap">
            {DAYS.map((d) => {
              const on = s.days.includes(d);
              return (
                <button key={d} onClick={() => set('days', on ? s.days.filter((x) => x !== d) : [...s.days, d])}
                  className={`text-[12px] px-2.5 py-1 rounded-lg border ${on ? 'border-[#3C5A87] bg-[#EEF2F8] text-[#283C5C]' : 'border-[#E5E7EB] text-[#9CA3AF]'}`}>{d}</button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
            <input type="checkbox" checked={s.auto_off_on_human_reply} onChange={(e) => set('auto_off_on_human_reply', e.target.checked)} />
            Stop AI for a lead once a human replies
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
            <input type="checkbox" checked={s.auto_off_on_booking} onChange={(e) => set('auto_off_on_booking', e.target.checked)} />
            Stop AI once the lead books
          </label>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[#6B7280]">Handoff keywords (comma-separated — stop + flag if the lead says any)</label>
          <input value={s.handoff_keywords.join(', ')}
            onChange={(e) => set('handoff_keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
            className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2" />
        </div>

        <div>
          <label className="text-[11px] font-medium text-[#6B7280]">The pitch (system prompt)</label>
          <textarea rows={6} value={s.system_prompt} onChange={(e) => set('system_prompt', e.target.value)}
            className="mt-1 w-full text-[13px] border border-[#E5E7EB] rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30" />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 bg-[#3C5A87] disabled:opacity-40 text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl hover:bg-[#3C5A87]/90">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
          </button>
          {msg && <span className={`text-[12px] ${msg.startsWith('Error') ? 'text-[#B91C1C]' : 'text-[#283C5C]'}`}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
