import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useCrmChannel } from './CrmAgentLayout';
import { SaveRow } from './CrmAgentPersonalityPage';
import { Card, FieldLabel, Toggle, ToggleRow, input, hint } from './ui';

/**
 * Call behaviour — the ported /agents/calling page for Maya. Voice/call-feel
 * params stored in wk_agent_channel_settings.voice_config (voice row) and
 * pushed to Maya's Retell agent via /api/crm/agent-config. Seeds from the live
 * Retell state until the first save.
 */

const VOICES = [
  { id: 'cartesia-Willa', label: 'Willa — British female, warm (Maya’s current)' },
  { id: 'retell-Willa', label: 'Willa — British female (Retell)' },
  { id: '11labs-Dorothy', label: 'Dorothy — British female, calm' },
  { id: '11labs-Amy', label: 'Amy — British female, bright' },
  { id: '11labs-Anthony', label: 'Anthony — British male, confident' },
  { id: 'cartesia-Adam', label: 'Adam — British male, polished' },
  { id: 'openai-Nova', label: 'Nova — American female' },
  { id: '11labs-Lily', label: 'Lily — American female' },
  { id: '11labs-Hailey', label: 'Hailey — American female' },
  { id: 'retell-Nico', label: 'Nico — American male' },
];

const EMOTIONS = [
  { value: 'happy', label: 'Happy — bright and upbeat' },
  { value: 'calm', label: 'Calm — relaxed and steady' },
  { value: 'sympathetic', label: 'Sympathetic — warm and caring' },
  { value: 'surprised', label: 'Surprised — lively' },
];

const AMBIENCE = [
  { value: '', label: 'None (silent)' },
  { value: 'call-center', label: 'Busy office / call centre' },
  { value: 'coffee-shop', label: 'Coffee shop' },
  { value: 'summer-outdoor', label: 'Outdoors' },
  { value: 'convention-hall', label: 'Conference hall' },
];

interface VoiceConfig {
  voice_id: string;
  voice_speed: number;
  enable_dynamic_voice_speed: boolean;
  voice_emotion: string | null;
  volume: number;
  start_speaker: string;
  interruption_sensitivity: number;
  responsiveness: number;
  reminder_trigger_seconds: number | null;
  reminder_max_count: number | null;
  ambient_sound: string | null;
  max_call_duration_seconds: number;
  backchannel_enabled: boolean;
  backchannel_frequency: number;
  begin_delay_ms: number;
  end_silence_seconds: number | null;
  voicemail_hangup: boolean;
  allow_keypad: boolean;
  pronunciation_notes?: string;
}

export default function CrmCallBehaviourPage() {
  const channel = useCrmChannel();
  const { session } = useAuth();
  const [vc, setVc] = useState<VoiceConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session || channel !== 'voice') return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabase.from('wk_agent_channel_settings') as any)
        .select('voice_config').eq('channel', 'voice').maybeSingle();
      const savedVc = row?.voice_config as Partial<VoiceConfig> | undefined;
      if (savedVc && Object.keys(savedVc).length > 0) {
        if (!cancelled) setVc(savedVc as VoiceConfig);
        return;
      }
      try {
        const res = await fetch('/api/crm/agent-config', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const live = await res.json();
        if (!cancelled) {
          if (res.ok) setVc({ ...(live.voice as VoiceConfig), start_speaker: live.start_speaker || 'agent' });
          else setLoadError(live.error || 'Could not load the live voice config.');
        }
      } catch {
        if (!cancelled) setLoadError('Could not load the live voice config.');
      }
    })();
    return () => { cancelled = true; };
  }, [session, channel]);

  const save = useCallback(async () => {
    if (!session || !vc) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      // Make sure a prompt exists in the row before the sync (first save on
      // this page may happen before the personality page has ever saved).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabase.from('wk_agent_channel_settings') as any)
        .select('system_prompt').eq('channel', 'voice').maybeSingle();
      if (!row?.system_prompt) {
        const res = await fetch('/api/crm/agent-config', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const live = await res.json();
        if (!res.ok) throw new Error(live.error || 'Could not read the live prompt.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.from('wk_agent_channel_settings') as any)
          .update({ system_prompt: live.prompt, greeting: live.greeting || null, model: live.model })
          .eq('channel', 'voice');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: dbErr } = await (supabase.from('wk_agent_channel_settings') as any)
        .update({ voice_config: vc }).eq('channel', 'voice');
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
  }, [session, vc]);

  if (channel !== 'voice') {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center text-[13px] text-[#6B7280]">
        These settings are for <strong className="text-[#1A1A1A]">phone calls only</strong>. Switch the channel to <strong className="text-[#1A1A1A]">Calls</strong> above to edit them.
      </div>
    );
  }

  if (loadError) return <div className="bg-white border border-[#E5E7EB] rounded-2xl p-8 text-center text-[13px] text-[#B91C1C]">{loadError}</div>;
  if (!vc) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#3C5A87] border-t-transparent" />
      </div>
    );
  }

  const set = <K extends keyof VoiceConfig>(k: K, v: VoiceConfig[K]) => setVc({ ...vc, [k]: v });
  const isCartesia = vc.voice_id?.startsWith('cartesia-');

  return (
    <div className="space-y-5">
      <Card title="Voice" eyebrow="Calls">
        <div className="space-y-4">
          <div>
            <FieldLabel>Maya's voice</FieldLabel>
            <select value={vc.voice_id} onChange={(e) => set('voice_id', e.target.value)} className={input}>
              {VOICES.some((v) => v.id === vc.voice_id) ? null : <option value={vc.voice_id}>{vc.voice_id} (current)</option>}
              {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <p className={hint}>The voice callers hear on the 833 line.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Speaking speed (0.5–2)</FieldLabel>
              <input type="number" min={0.5} max={2} step={0.01} value={vc.voice_speed}
                onChange={(e) => set('voice_speed', Number(e.target.value) || 1)} className={input} />
            </div>
            <div>
              <FieldLabel>Voice volume (0–2)</FieldLabel>
              <input type="number" min={0} max={2} step={0.1} value={vc.volume}
                onChange={(e) => set('volume', Number(e.target.value) || 1)} className={input} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#1A1A1A]">Dynamically adjust speed</p>
              <p className="text-[12px] text-[#6B7280]">Maya speeds up or slows down to match the caller.</p>
            </div>
            <Toggle checked={vc.enable_dynamic_voice_speed} onChange={(v) => set('enable_dynamic_voice_speed', v)} />
          </div>

          {isCartesia && (
            <div>
              <FieldLabel>Voice emotion (Cartesia voices)</FieldLabel>
              <select value={vc.voice_emotion || 'happy'} onChange={(e) => set('voice_emotion', e.target.value)} className={input}>
                {EMOTIONS.map((em) => <option key={em.value} value={em.value}>{em.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </Card>

      <Card title="How Maya handles a live call" eyebrow="Calls">
        <div className="space-y-4">
          <div>
            <FieldLabel>Who speaks first</FieldLabel>
            <select value={vc.start_speaker} onChange={(e) => set('start_speaker', e.target.value)} className={input}>
              <option value="agent">Maya greets first</option>
              <option value="user">Wait for the caller to speak</option>
            </select>
          </div>
          <div>
            <FieldLabel>Interruption sensitivity</FieldLabel>
            <select value={String(vc.interruption_sensitivity)} onChange={(e) => set('interruption_sensitivity', Number(e.target.value))} className={input}>
              <option value="0.3">Relaxed — let callers finish</option>
              <option value="0.7">Balanced (recommended)</option>
              <option value="1">Quick to pause when interrupted</option>
            </select>
          </div>
          <div>
            <FieldLabel>Response speed</FieldLabel>
            <select value={String(vc.responsiveness)} onChange={(e) => set('responsiveness', Number(e.target.value))} className={input}>
              <option value="0.3">Calm — small natural pause</option>
              <option value="0.7">Natural (recommended)</option>
              <option value="1">Snappy — replies fast</option>
            </select>
          </div>
          <div>
            <FieldLabel>Background ambience</FieldLabel>
            <select value={vc.ambient_sound || ''} onChange={(e) => set('ambient_sound', e.target.value || null)} className={input}>
              {AMBIENCE.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Maximum call length (minutes)</FieldLabel>
            <input type="number" min={1} max={180} value={Math.round(vc.max_call_duration_seconds / 60)}
              onChange={(e) => set('max_call_duration_seconds', Math.max(1, Number(e.target.value) || 60) * 60)} className={input} />
          </div>
        </div>
      </Card>

      <Card title="If the caller goes quiet" eyebrow="Calls">
        <ToggleRow
          title="Check in on silence"
          desc="Maya gently re-prompts if the caller stops talking."
          checked={vc.reminder_trigger_seconds != null}
          onChange={(v) => setVc({ ...vc, reminder_trigger_seconds: v ? 10 : null, reminder_max_count: v ? (vc.reminder_max_count ?? 1) : null })}
        />
        {vc.reminder_trigger_seconds != null && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Wait (seconds)</FieldLabel>
              <input type="number" min={3} max={60} value={vc.reminder_trigger_seconds}
                onChange={(e) => set('reminder_trigger_seconds', Number(e.target.value) || 10)} className={input} />
            </div>
            <div>
              <FieldLabel>Up to (times)</FieldLabel>
              <input type="number" min={1} max={5} value={vc.reminder_max_count ?? 1}
                onChange={(e) => set('reminder_max_count', Number(e.target.value) || 1)} className={input} />
            </div>
          </div>
        )}
      </Card>

      <Card title="Advanced call settings" eyebrow="Calls">
        <div className="divide-y divide-[#E5E7EB]">
          <ToggleRow
            title="Natural affirmations"
            desc={'Maya says little "mhm", "right" cues while listening.'}
            checked={vc.backchannel_enabled}
            onChange={(v) => set('backchannel_enabled', v)}
          />
          <ToggleRow
            title="Hang up after long silence"
            desc="End the call if the caller goes completely quiet."
            checked={vc.end_silence_seconds != null}
            onChange={(v) => set('end_silence_seconds', v ? 30 : null)}
          />
          <ToggleRow
            title="Hang up on voicemail"
            desc="If a call reaches voicemail, end instead of talking to the machine."
            checked={vc.voicemail_hangup}
            onChange={(v) => set('voicemail_hangup', v)}
          />
          <ToggleRow
            title="Listen for keypad presses"
            desc="Let callers type numbers on their keypad."
            checked={vc.allow_keypad}
            onChange={(v) => set('allow_keypad', v)}
          />
        </div>

        <div className="mt-4 space-y-4">
          {vc.backchannel_enabled && (
            <div>
              <FieldLabel>Affirmations — how often</FieldLabel>
              <select value={String(vc.backchannel_frequency)} onChange={(e) => set('backchannel_frequency', Number(e.target.value))} className={input}>
                <option value="0.4">Subtle</option>
                <option value="0.8">Normal</option>
                <option value="1">Chatty</option>
              </select>
            </div>
          )}
          {vc.end_silence_seconds != null && (
            <div>
              <FieldLabel>Hang up after (seconds)</FieldLabel>
              <input type="number" min={10} max={120} value={vc.end_silence_seconds}
                onChange={(e) => set('end_silence_seconds', Number(e.target.value) || 30)} className={input} />
            </div>
          )}
          <div>
            <FieldLabel>Pause before Maya speaks</FieldLabel>
            <select value={String(vc.begin_delay_ms)} onChange={(e) => set('begin_delay_ms', Number(e.target.value))} className={input}>
              <option value="0">None — answer instantly</option>
              <option value="300">Brief (0.3s) — most natural</option>
              <option value="500">Short (0.5s)</option>
              <option value="1000">Noticeable (1s)</option>
            </select>
          </div>
          <div>
            <FieldLabel>Pronunciation hints</FieldLabel>
            <textarea rows={3} value={vc.pronunciation_notes || ''} onChange={(e) => set('pronunciation_notes', e.target.value)}
              className={input} placeholder={'e.g. "Airbrick → AIR-brick"'} />
            <p className={hint}>Tell Maya how to say tricky names or brands — one per line. Added to her prompt on sync.</p>
          </div>
        </div>
      </Card>

      <SaveRow saving={saving} saved={saved} error={error} onSave={save} savedLabel="Saved & live on 833" />
    </div>
  );
}
