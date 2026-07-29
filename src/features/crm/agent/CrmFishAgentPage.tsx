import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Check, Loader2, Play, RotateCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';

/**
 * Fish agent — everything that decides how the outbound AI caller sounds.
 *
 * Saves to wk_agent_channel_settings.fish_config on the 'voice' row. The
 * bridge (bridge/ai.py) reads that row before each call, so a change here
 * reaches the next call with no deploy.
 *
 * Every default below is a measured value, not a guess. The notes on each
 * control say what was measured and why it matters, because "volume 6" means
 * nothing on its own and everything once you know the library voices come out
 * at -23 dBFS and a phone line wants about -17.
 */

// Fish performs a cue in square brackets instead of reading it. Verified: the
// words come back clean through speech-to-text with the cue absent.
// Every one below was measured on 2026-07-29, three renders each against the
// bare line: all of them change only HOW she says it. [chuckling] was the odd
// one out at +0.87s, which is her actually laughing, so it is not offered here
// and the bridge drops it even if something asks for it.
const EMOTIONS = [
  'warm', 'curious', 'amused', 'confident', 'delighted', 'excited', 'playful',
  'sincere', 'empathetic', 'calm', 'emphasis', 'surprised', 'sympathetic',
  'determined',
] as const;
const EFFECTS = ['break', 'long-break'] as const;

export interface FishConfig {
  voice_id: string;
  model: string;
  speed: number;
  volume: number;
  temperature: number;
  top_p: number;
  chunk_length: number;
  emotions_enabled: boolean;
  allowed_emotions: string[];
  system_prompt: string;
  opener: string;
}

const DEFAULTS: FishConfig = {
  voice_id: '32e344f53f114cfcbb7ed086f10f2403',
  model: 's2.1-pro-free',
  speed: 1.15,
  volume: 6,
  temperature: 0.7,
  top_p: 0.7,
  chunk_length: 120,
  emotions_enabled: true,
  // Wide on purpose. Cut back to five, she came back "zero emotion, no
  // charisma": the list is here to stop the laugh, not to flatten her.
  allowed_emotions: ['warm', 'curious', 'amused', 'confident', 'delighted',
    'excited', 'playful', 'sincere', 'empathetic', 'calm', 'emphasis'],
  system_prompt: '',
  opener: '',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <label className="block text-[13px] font-semibold text-[#1A1A1A] mb-1">{label}</label>
      {hint && <p className="text-[12px] text-[#6B7280] mb-2 leading-snug">{hint}</p>}
      {children}
    </div>
  );
}

function Slider({
  value, onChange, min, max, step, suffix,
}: { value: number; onChange: (n: number) => void; min: number; max: number; step: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#3C5A87]"
      />
      <span className="text-[13px] tabular-nums text-[#1A1A1A] w-16 text-right font-medium">
        {value}{suffix}
      </span>
    </div>
  );
}

const INPUT = 'w-full border border-[#E5E7EB] rounded-xl px-3 py-2 text-[14px] text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30';

export default function CrmFishAgentPage() {
  const [cfg, setCfg] = useState<FishConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState('[warm] Hi, is that Smith Plumbing?');
  const [playing, setPlaying] = useState(false);
  const [studio, setStudio] = useState(false);
  const [took, setTook] = useState<number | null>(null);

  const play = useCallback(async () => {
    setPlaying(true);
    setError(null);
    setTook(null);
    try {
      const res = await fetch('/api/fish/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cfg, text: preview, telephony: !studio }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `Preview failed (${res.status}).` }));
        throw new Error(j.error ?? 'Preview failed.');
      }
      const ms = res.headers.get('X-Fish-Ms');
      if (ms) setTook(Number(ms));
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      el.onended = () => URL.revokeObjectURL(url);
      await el.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setPlaying(false);
    }
  }, [cfg, preview, studio]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await (supabase.from('wk_agent_channel_settings') as any)
        .select('fish_config')
        .eq('channel', 'voice')
        .maybeSingle();
      if (cancelled) return;
      if (e) setError(e.message);
      const stored = (data?.fish_config ?? {}) as Partial<FishConfig>;
      setCfg({ ...DEFAULTS, ...stored });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const set = <K extends keyof FishConfig>(k: K, v: FishConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    // upsert, because the voice row may not exist on a fresh workspace
    const { error: e } = await (supabase.from('wk_agent_channel_settings') as any)
      .upsert({ channel: 'voice', fish_config: cfg }, { onConflict: 'channel' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }, [cfg]);

  const toggleEmotion = (name: string) => {
    const on = cfg.allowed_emotions.includes(name);
    set('allowed_emotions', on
      ? cfg.allowed_emotions.filter((x) => x !== name)
      : [...cfg.allowed_emotions, name]);
  };

  if (loading) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-10 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[#6B7280]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-1">
          <AudioLines className="w-5 h-5 text-[#3C5A87] mt-0.5" strokeWidth={1.8} />
          <div>
            <h2 className="text-[17px] font-bold text-[#1A1A1A]">Fish agent</h2>
            <p className="text-[13px] text-[#6B7280]">
              How the outbound AI caller sounds. Changes reach the next call, no deploy needed.
            </p>
          </div>
        </div>
      </div>

      {/* VOICE */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-4">Voice</h3>

        <Field
          label="Voice ID"
          hint="From fish.audio. This is NOT optional: with no voice set, Fish invents a new random voice on every request, so each sentence comes out as a different person. Paste a cloned voice ID here to use your own."
        >
          <input className={INPUT} value={cfg.voice_id}
                 onChange={(e) => set('voice_id', e.target.value.trim())}
                 placeholder="32e344f53f114cfcbb7ed086f10f2403" />
        </Field>

        <Field label="Model" hint="s2.1-pro-free is free until 31 Aug 2026 with no character cap, but carries no uptime guarantee. Move to s2.1-pro before a campaign depends on it.">
          <select className={INPUT} value={cfg.model} onChange={(e) => set('model', e.target.value)}>
            <option value="s2.1-pro-free">s2.1-pro-free (free)</option>
            <option value="s2.1-pro">s2.1-pro (paid)</option>
            <option value="s2-pro">s2-pro</option>
            <option value="s1">s1</option>
          </select>
        </Field>

        <Field label="Speed" hint="Measured: Fish speaks at 13.9 characters a second by default against ElevenLabs' 19.2, so the same opener ran 7 seconds instead of 5. 1.15 matches a natural pace.">
          <Slider value={cfg.speed} onChange={(n) => set('speed', n)} min={0.5} max={2} step={0.05} />
        </Field>

        <Field label="Volume" hint="Measured: the library voices arrive around -23 dBFS and a phone line wants about -17. 6 lands it at -17.8. Too quiet on a call is not a volume preference, it is the prospect not hearing you.">
          <Slider value={cfg.volume} onChange={(n) => set('volume', n)} min={0} max={12} step={1} />
        </Field>
      </div>

      {/* DELIVERY */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-4">Delivery</h3>

        <Field label="Expressiveness (temperature)" hint="Higher is more varied and emotional, lower is flatter and more predictable. Fish's own default is 0.7.">
          <Slider value={cfg.temperature} onChange={(n) => set('temperature', n)} min={0} max={1} step={0.05} />
        </Field>

        <Field label="Top P" hint="How much of the model's range it draws from. Leave at 0.7 unless you are chasing a specific effect.">
          <Slider value={cfg.top_p} onChange={(n) => set('top_p', n)} min={0} max={1} step={0.05} />
        </Field>

        <Field label="Chunk length" hint="How much text Fish processes at once, 100 to 300. Smaller starts speaking sooner, which cuts the silence after the prospect stops talking. Larger keeps the voice more even across a long sentence.">
          <Slider value={cfg.chunk_length} onChange={(n) => set('chunk_length', n)} min={100} max={300} step={10} />
        </Field>
      </div>

      {/* EMOTION */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[15px] font-bold text-[#1A1A1A]">Emotion cues</h3>
          <label className="flex items-center gap-2 text-[13px] text-[#1A1A1A]">
            <input type="checkbox" className="accent-[#3C5A87] w-4 h-4"
                   checked={cfg.emotions_enabled}
                   onChange={(e) => set('emotions_enabled', e.target.checked)} />
            Enabled
          </label>
        </div>
        <p className="text-[12px] text-[#6B7280] mb-4 leading-snug">
          Elsie can put a cue like <code className="bg-[#F3F3EE] px-1 rounded">[warm]</code> at the start of a
          sentence and Fish performs it. The brackets are never spoken aloud, verified by transcribing the
          output. Tick only the ones that suit a sales call: too many, and it sounds unhinged rather than human.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          {EMOTIONS.map((name) => {
            const on = cfg.allowed_emotions.includes(name);
            return (
              <button key={name} onClick={() => toggleEmotion(name)} disabled={!cfg.emotions_enabled}
                className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors disabled:opacity-40 ${
                  on ? 'bg-[#3C5A87] text-white border-[#3C5A87]' : 'bg-white text-[#1A1A1A] border-[#E5E7EB] hover:bg-[#F3F3EE]'
                }`}>
                [{name}]
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-[#6B7280]">
          Sound effects always available: {EFFECTS.map((e) => `[${e}]`).join(' ')} —
          <code className="bg-[#F3F3EE] px-1 rounded ml-1">[break]</code> is a short pause, useful where a person would draw breath.
        </p>
      </div>

      {/* SCRIPT */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-4">Script</h3>

        <Field label="Opening line" hint="The first thing they hear. Keep it under about 7 seconds: the original ran 16 and people hang up. It must still say she is an AI, which is required by Anthropic's and Fish's policies, not optional. Leave blank to use the built-in one.">
          <textarea className={`${INPUT} min-h-[70px]`} value={cfg.opener}
            onChange={(e) => set('opener', e.target.value)}
            placeholder="Hi, is that {business}? It's Elsie, an AI assistant at HeyElsie. Have you got thirty seconds?" />
        </Field>

        <Field label="System prompt" hint="How she behaves for the rest of the call. Leave blank to use the built-in one, which caps her at a few words a turn and forbids stacking more than one idea per breath.">
          <textarea className={`${INPUT} min-h-[220px] font-mono text-[12px] leading-relaxed`}
            value={cfg.system_prompt} onChange={(e) => set('system_prompt', e.target.value)}
            placeholder="Leave blank to use the built-in caller prompt." />
        </Field>
      </div>

      {/* PREVIEW */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-1">Listen before you dial</h3>
        <p className="text-[12px] text-[#6B7280] mb-4 leading-snug">
          Plays through the same 8 kHz phone quality the prospect actually hears, not studio quality.
          A voice can sound lovely in a browser and thin on a call, which is exactly how the library
          voices catch you out. Try emotion cues here too, like <code className="bg-[#F3F3EE] px-1 rounded">[warm]</code>.
        </p>
        <textarea className={`${INPUT} min-h-[64px] mb-3`} value={preview}
          onChange={(e) => setPreview(e.target.value)} />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={play} disabled={playing}
            className="inline-flex items-center gap-2 bg-[#1A1A1A] hover:bg-black disabled:opacity-60 text-white text-[14px] font-semibold px-4 py-2.5 rounded-xl transition-colors">
            {playing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {playing ? 'Generating' : 'Play as heard on the phone'}
          </button>
          <label className="flex items-center gap-2 text-[13px] text-[#6B7280]">
            <input type="checkbox" className="accent-[#3C5A87] w-4 h-4"
              checked={studio} onChange={(e) => setStudio(e.target.checked)} />
            Studio quality instead (flattering, not what they hear)
          </label>
          {took !== null && (
            <span className="text-[12px] text-[#6B7280] tabular-nums">generated in {took}ms</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] rounded-xl px-4 py-3 text-[13px]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 pb-8">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 bg-[#3C5A87] hover:bg-[#2F4A73] disabled:opacity-60 text-white text-[14px] font-semibold px-5 py-2.5 rounded-xl transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {saving ? 'Saving' : saved ? 'Saved' : 'Save settings'}
        </button>
        <button onClick={() => { setCfg(DEFAULTS); setSaved(false); }}
          className="inline-flex items-center gap-2 text-[#6B7280] hover:text-[#1A1A1A] text-[13px] px-3 py-2.5">
          <RotateCcw className="w-4 h-4" /> Reset to measured defaults
        </button>
      </div>
    </div>
  );
}
