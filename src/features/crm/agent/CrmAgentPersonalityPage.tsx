import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Save, Sparkles, TriangleAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useCrmChannel } from './CrmAgentLayout';
import { Card, FieldLabel, Toggle, DayPicker, input, hint } from './ui';

/**
 * AI Personality per channel — the ported /agents/personality for Maya.
 *
 * · Calls    → Maya's real voice brain: greeting + system prompt + model,
 *              saved to wk_agent_channel_settings (voice) and pushed straight
 *              to Retell via /api/crm/agent-config. This is the first UI that
 *              can edit the live voice prompt (it previously only existed in
 *              Retell, set once by a script).
 * · SMS      → the live warm-up engine settings (wk_ai_reply_settings).
 * · Email /  → same settings shape, stored in wk_agent_channel_settings and
 *   WhatsApp   read by the engines when those channels are switched on.
 */

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — smart & fast (recommended)' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest & cheapest' },
];

interface TextSettings {
  enabled: boolean;
  mode: 'draft' | 'auto';
  reply_delay_seconds: number;
  max_replies_per_contact: number;
  hours_start: number;
  hours_end: number;
  days: string[];
  auto_off_on_human_reply: boolean;
  auto_off_on_booking: boolean;
  handoff_keywords: string[];
  model: string;
  system_prompt: string;
}

export default function CrmAgentPersonalityPage() {
  const channel = useCrmChannel();
  if (channel === 'voice') return <VoicePersonality />;
  return <TextChannelPersonality key={channel} channel={channel} />;
}

/* ── Calls ─────────────────────────────────────────────────────────────── */

function VoicePersonality() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session) return;
      // Saved row wins; otherwise seed from Maya's live Retell config.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabase.from('wk_agent_channel_settings') as any)
        .select('greeting, system_prompt, model').eq('channel', 'voice').maybeSingle();
      if (row?.system_prompt) {
        if (!cancelled) {
          setGreeting(row.greeting || '');
          setPrompt(row.system_prompt);
          setModel(row.model || 'claude-sonnet-4-6');
          setLoading(false);
        }
        return;
      }
      try {
        const res = await fetch('/api/crm/agent-config', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const live = await res.json();
        if (!cancelled && res.ok) {
          setGreeting(live.greeting || '');
          setPrompt(live.prompt || '');
          setModel(live.model || 'claude-sonnet-4-6');
        } else if (!cancelled) {
          setError(live.error || 'Could not load the live voice config.');
        }
      } catch {
        if (!cancelled) setError('Could not load the live voice config.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session]);

  const save = useCallback(async () => {
    if (!session || !prompt.trim()) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dbErr } = await (supabase.from('wk_agent_channel_settings') as any)
        .update({ greeting: greeting.trim() || null, system_prompt: prompt.trim(), model })
        .eq('channel', 'voice');
      if (dbErr) throw new Error(dbErr.message);

      const res = await fetch('/api/crm/agent-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ channel: 'voice' }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Saved, but pushing to the call engine failed.');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [session, greeting, prompt, model]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <Card title="Who speaks" eyebrow="Calls">
        <p className="text-[12px] text-[#6B7280] mb-4">
          Maya answers <strong className="text-[#1A1A1A]">+1 (833) 370-6994</strong>. Changes here go live on the next call.
        </p>
        <FieldLabel>Greeting — the first thing Maya says</FieldLabel>
        <textarea rows={2} value={greeting} onChange={(e) => setGreeting(e.target.value)} className={input}
          placeholder="Hi there, thanks for calling back! Who am I speaking with?" />
        <p className={hint}>Leave empty to make Maya wait for the caller to speak first.</p>
      </Card>

      <Card title="AI Personality" eyebrow="Calls">
        <FieldLabel>System prompt — Maya's voice brain</FieldLabel>
        <textarea rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          className={`${input} font-mono`} />
        <p className={hint}>
          Who Maya is, how she qualifies leads, and when she books. You can use {'{{current_date}}'} —
          it's replaced with today's date on every sync. Her booking tool is preserved automatically.
        </p>
      </Card>

      <Card title="AI model" eyebrow="Calls">
        <FieldLabel>The brain Maya uses on calls</FieldLabel>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={input}>
          {MODEL_OPTIONS.some((m) => m.value === model) ? null : <option value={model}>{model} (current)</option>}
          {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          <option value="gpt-5.5">GPT-5.5 (OpenAI) — strong for voice</option>
        </select>
      </Card>

      <SaveRow saving={saving} saved={saved} error={error} onSave={save} savedLabel="Saved & live on 833" />
    </div>
  );
}

/* ── SMS / Email / WhatsApp ────────────────────────────────────────────── */

function TextChannelPersonality({ channel }: { channel: 'sms' | 'email' | 'whatsapp' }) {
  const isSms = channel === 'sms';
  const [s, setS] = useState<TextSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const query = isSms
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase.from('wk_ai_reply_settings') as any).select('*').eq('id', 'default').maybeSingle()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : (supabase.from('wk_agent_channel_settings') as any).select('*').eq('channel', channel).maybeSingle();
      const { data } = await query;
      if (data) setS(data as TextSettings);
    })();
  }, [channel, isSms]);

  const save = useCallback(async () => {
    if (!s) return;
    setSaving(true); setSaved(false); setError(null);
    const patch = {
      enabled: s.enabled,
      mode: s.mode,
      reply_delay_seconds: s.reply_delay_seconds,
      max_replies_per_contact: s.max_replies_per_contact,
      hours_start: s.hours_start,
      hours_end: s.hours_end,
      days: s.days,
      auto_off_on_human_reply: s.auto_off_on_human_reply,
      auto_off_on_booking: s.auto_off_on_booking,
      handoff_keywords: s.handoff_keywords,
      model: s.model,
      system_prompt: s.system_prompt,
    };
    const query = isSms
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (supabase.from('wk_ai_reply_settings') as any).update(patch).eq('id', 'default')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : (supabase.from('wk_agent_channel_settings') as any).update(patch).eq('channel', channel);
    const { error: dbErr } = await query;
    setSaving(false);
    if (dbErr) { setError(dbErr.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [s, channel, isSms]);

  if (!s) return <Spinner />;

  const set = <K extends keyof TextSettings>(k: K, v: TextSettings[K]) => setS({ ...s, [k]: v });
  const channelLabel = channel === 'sms' ? 'SMS' : channel === 'email' ? 'Email' : 'WhatsApp';

  return (
    <div className="space-y-5">
      {!isSms && (
        <div className="flex items-start gap-2.5 bg-[#FEF3C7] border border-[#FDE68A] rounded-2xl px-4 py-3">
          <TriangleAlert className="w-4 h-4 text-[#92400E] mt-0.5 shrink-0" strokeWidth={1.8} />
          <p className="text-[12.5px] text-[#92400E]">
            The CRM's {channelLabel} channel isn't switched on yet. Your settings save now and take effect the moment it goes live.
          </p>
        </div>
      )}

      <Card title="AI replies" eyebrow={channelLabel}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-[#1A1A1A]">Reply to leads automatically</div>
            <div className="text-[11px] text-[#6B7280]">
              {isSms
                ? 'When a lead texts back, Maya replies using the pitch below.'
                : `When a lead replies on ${channelLabel}, Maya answers using the pitch below.`}
            </div>
          </div>
          <Toggle checked={s.enabled} onChange={(v) => set('enabled', v)} />
        </div>

        <div className="mt-4">
          <FieldLabel>Mode</FieldLabel>
          <div className="flex gap-2">
            {(['draft', 'auto'] as const).map((m) => (
              <button key={m} onClick={() => set('mode', m)}
                className={`flex-1 text-[13px] py-2 rounded-lg border ${s.mode === m ? 'border-[#3C5A87] bg-[#EEF2F8] text-[#283C5C] font-semibold' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
                {m === 'draft' ? 'Draft (you approve)' : 'Auto-send'}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="AI Personality" eyebrow={channelLabel}>
        <FieldLabel>The pitch (system prompt)</FieldLabel>
        <textarea rows={9} value={s.system_prompt} onChange={(e) => set('system_prompt', e.target.value)}
          className={`${input} font-mono`} />
        <p className={hint}>How Maya writes on {channelLabel}: who she is, the offer, and what a great short reply looks like.</p>

        <div className="mt-4">
          <FieldLabel>AI model</FieldLabel>
          <select value={s.model} onChange={(e) => set('model', e.target.value)} className={input}>
            {MODEL_OPTIONS.some((m) => m.value === s.model) ? null : <option value={s.model}>{s.model} (current)</option>}
            {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </Card>

      <Card title="Pace & limits" eyebrow={channelLabel}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Reply delay (seconds)</FieldLabel>
            <input type="number" min={0} value={s.reply_delay_seconds}
              onChange={(e) => set('reply_delay_seconds', Math.max(0, Number(e.target.value) || 0))} className={input} />
          </div>
          <div>
            <FieldLabel>Max replies per lead</FieldLabel>
            <input type="number" min={1} value={s.max_replies_per_contact}
              onChange={(e) => set('max_replies_per_contact', Math.max(1, Number(e.target.value) || 1))} className={input} />
          </div>
          <div>
            <FieldLabel>Hours start (0–24)</FieldLabel>
            <input type="number" min={0} max={24} value={s.hours_start}
              onChange={(e) => set('hours_start', Math.max(0, Math.min(24, Number(e.target.value) || 0)))} className={input} />
          </div>
          <div>
            <FieldLabel>Hours end (0–24)</FieldLabel>
            <input type="number" min={0} max={24} value={s.hours_end}
              onChange={(e) => set('hours_end', Math.max(0, Math.min(24, Number(e.target.value) || 24)))} className={input} />
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel>Active days</FieldLabel>
          <DayPicker days={s.days} onChange={(d) => set('days', d)} />
        </div>
      </Card>

      <Card title="When Maya stands down" eyebrow={channelLabel}>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
            <input type="checkbox" checked={s.auto_off_on_human_reply} onChange={(e) => set('auto_off_on_human_reply', e.target.checked)} />
            Stop for a lead once a human replies
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
            <input type="checkbox" checked={s.auto_off_on_booking} onChange={(e) => set('auto_off_on_booking', e.target.checked)} />
            Stop once the lead books
          </label>
        </div>
        <div className="mt-4">
          <FieldLabel>Handoff keywords (comma-separated — stop + flag if the lead says any)</FieldLabel>
          <input value={s.handoff_keywords.join(', ')}
            onChange={(e) => set('handoff_keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
            className={input} />
        </div>
      </Card>

      <SaveRow saving={saving} saved={saved} error={error} onSave={save} savedLabel="Saved" />
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#3C5A87] border-t-transparent" />
    </div>
  );
}

export function SaveRow({ saving, saved, error, onSave, savedLabel }: {
  saving: boolean; saved: boolean; error: string | null; onSave: () => void; savedLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onSave} disabled={saving}
        className="flex items-center gap-2 bg-[#3C5A87] disabled:opacity-40 text-white text-[13px] font-semibold px-5 py-2.5 rounded-xl hover:bg-[#3C5A87]/90">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving…' : saved ? savedLabel : 'Save changes'}
      </button>
      {error && <span className="text-[12px] text-[#B91C1C]">{error}</span>}
      {!error && !saving && !saved && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[#9CA3AF]">
          <Sparkles className="w-3 h-3" /> Changes apply immediately after saving.
        </span>
      )}
    </div>
  );
}
