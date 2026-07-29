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
  latency: 'low' | 'balanced' | 'normal';
  emotions_enabled: boolean;
  allowed_emotions: string[];
  system_prompt: string;
  opener: string;
  // The brain
  llm_model: string;
  max_words: number;
  // Turn taking. These decide whether she talks over people.
  settled_partial_s: number;
  unfinished_wait_s: number;
  wait_for_hello_s: number;
  backchannel_chance: number;
  barge_in_ms: number;
  barge_margin_db: number;
  finish_word_ms: number;
  // Not sent to the bridge, just remembered for the call button.
  test_number: string;
  test_business: string;
}

const LLM_MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5   (764ms, short replies)' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5   (986ms, wordier)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5   (1805ms, too slow for a call)' },
  { id: 'claude-fable-5', label: 'Fable 5   (3095ms, far too slow)' },
];

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
  latency: 'low',
  llm_model: 'claude-haiku-4-5-20251001',
  max_words: 28,
  settled_partial_s: 1.1,
  unfinished_wait_s: 1.6,
  wait_for_hello_s: 2.5,
  backchannel_chance: 0.45,
  barge_in_ms: 350,
  barge_margin_db: 14,
  finish_word_ms: 200,
  test_number: '',
  test_business: 'Smith Plumbing',
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
  const [callState, setCallState] = useState<
    { kind: 'idle' | 'busy' | 'ok' | 'error'; text: string }
  >({ kind: 'idle', text: '' });

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

  // Dial a real call from this page. Saves first, always: the bridge reads its
  // settings from Supabase at the start of every call, so dialling without
  // saving would ring the phone using the LAST saved values while the screen
  // shows something else. That is the most confusing possible bug on a tuning
  // page, so it is made impossible rather than warned about.
  const callNow = useCallback(async () => {
    const to = cfg.test_number.replace(/\s+/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      setCallState({ kind: 'error', text: 'Full international number please, like +447863992555.' });
      return;
    }
    setCallState({ kind: 'busy', text: 'Saving settings...' });
    const { error: saveErr } = await (supabase.from('wk_agent_channel_settings') as any)
      .upsert({ channel: 'voice', fish_config: cfg }, { onConflict: 'channel' });
    if (saveErr) {
      setCallState({ kind: 'error', text: `Could not save: ${saveErr.message}` });
      return;
    }
    setCallState({ kind: 'busy', text: 'Dialling...' });
    try {
      const res = await fetch('/api/fish/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, business: cfg.test_business || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setCallState({ kind: 'error', text: body.error || `Failed (${res.status})` });
        return;
      }
      setCallState({ kind: 'ok', text: `Ringing ${body.dialling || to}. Answer it.` });
    } catch (e) {
      setCallState({ kind: 'error', text: (e as Error).message });
    }
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

      {/* CALL ME. First on the page on purpose: the whole point of tuning is
          hearing it on an actual phone line, and the browser preview flatters
          a voice that can still be thin and quiet over 8 kHz. */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-1">Test it on a real call</h3>
        <p className="text-[12px] text-[#6B7280] mb-4 leading-snug">
          Saves everything on this page first, then dials you. Whatever is on screen is
          what she will use. This spends real money and rings a real phone, so use your
          own number.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className={INPUT + ' sm:max-w-[220px]'}
            placeholder="+447863992555"
            value={cfg.test_number}
            onChange={(e) => set('test_number', e.target.value)}
          />
          <input
            className={INPUT + ' sm:max-w-[220px]'}
            placeholder="Business name she asks for"
            value={cfg.test_business}
            onChange={(e) => set('test_business', e.target.value)}
          />
          <button
            onClick={callNow}
            disabled={callState.kind === 'busy'}
            className="px-5 py-2 rounded-xl bg-[#3C5A87] text-white text-[14px] font-semibold
                       hover:bg-[#31496D] disabled:opacity-50 whitespace-nowrap"
          >
            {callState.kind === 'busy' ? 'Working...' : 'Call me now'}
          </button>
        </div>
        {callState.kind !== 'idle' && (
          <p className={'mt-3 text-[13px] ' + (
            callState.kind === 'error' ? 'text-[#B42318]'
              : callState.kind === 'ok' ? 'text-[#067647]' : 'text-[#6B7280]'
          )}>
            {callState.text}
          </p>
        )}
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

        <Field label="Speed" hint="Speed is compression, and prosody lives in the timing that gets compressed. Measured: at 1.1 an [excited] and a [calm] reading differed by 0.10 to 0.38 seconds, at 1.0 by 0.70 to 0.92. Faster is not just quicker, it is flatter.">
          <Slider value={cfg.speed} onChange={(n) => set('speed', n)} min={0.5} max={2} step={0.05} />
        </Field>

        <Field label="Volume" hint="Measured: the library voices arrive around -23 dBFS and a phone line wants about -17. 6 lands it at -17.8. Too quiet on a call is not a volume preference, it is the prospect not hearing you.">
          <Slider value={cfg.volume} onChange={(n) => set('volume', n)} min={0} max={12} step={1} />
        </Field>
      </div>

      {/* DELIVERY */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-4">Delivery</h3>

        <Field label="Expressiveness (temperature)" hint="THE dial for whether she sounds alive. Measured 29 Jul: at Fish's default of 0.7 an [excited] and a [calm] reading of the same line differed by 0.04 seconds, meaning the emotion cues were doing nothing at all. At 1.0 they differ by 0.92 seconds. If she starts mispronouncing things, come down to 0.9, not back to 0.7.">
          <Slider value={cfg.temperature} onChange={(n) => set('temperature', n)} min={0} max={1} step={0.05} />
        </Field>

        <Field label="Top P" hint="How much of the model's range it draws from. Same story as temperature: 0.7 was quietly flattening her, 1.0 measured widest.">
          <Slider value={cfg.top_p} onChange={(n) => set('top_p', n)} min={0} max={1} step={0.05} />
        </Field>

        <Field label="Latency mode" hint="Fish describe this as a quality trade-off, so it looked like a suspect for her sounding flat. Measured across all three at two temperatures, the dynamic range came out 9.28 to 10.50 dB with no consistent winner, well inside the noise. So low costs nothing measurable and keeps the speed.">
          <select className={INPUT} value={cfg.latency}
                  onChange={(e) => set('latency', e.target.value as FishConfig['latency'])}>
            <option value="low">low   (fastest, no measurable quality cost)</option>
            <option value="balanced">balanced</option>
            <option value="normal">normal</option>
          </select>
        </Field>

        <Field label="Chunk length" hint="How much text Fish buffers before synthesising, 100 to 300. Worth knowing: her replies are about 50 characters and the floor is 100, so the buffer never fills and every reply is synthesised in one go when the sentence finishes. Splitting it early was tried and reverted, it added a 0.6s seam mid-sentence and flattened the emotion.">
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

      {/* BRAIN */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-4">Brain</h3>

        <Field label="Model" hint="Measured 29 Jul on the real prompt with a real mid-call history. Haiku won on time to first token AND wrote shorter, sharper lines. Sonnet was not smarter, it was wordier, and wordier is slower here because the whole reply has to be written before Fish makes a sound.">
          <select className={INPUT} value={cfg.llm_model}
                  onChange={(e) => set('llm_model', e.target.value)}>
            {LLM_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>

        <Field label="Longest reply (words)" hint="A hard ceiling enforced in code, because asking for it in the prompt did not work. Past this she is cut at the next full stop, and a question mark always ends her turn wherever it lands. Lower means she interrupts people less and answers faster.">
          <Slider value={cfg.max_words} onChange={(n) => set('max_words', n)} min={8} max={60} step={1} suffix=" words" />
        </Field>
      </div>

      {/* TURN TAKING */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5">
        <h3 className="text-[15px] font-bold text-[#1A1A1A] mb-1">Turn taking</h3>
        <p className="text-[12px] text-[#6B7280] mb-4 leading-snug">
          Whether she talks over people, and how long they wait for an answer. Judge these
          by ear on a real call, not by argument.
        </p>

        <Field label="Pause before she answers" hint="How long a transcript must stop changing before she treats you as finished. The transcription service takes about 2 seconds to declare a turn over on its own, so acting on the pause is the single biggest speed win there is. Too short and she cuts into your thinking pauses, which is what a live call at 0.45s did.">
          <Slider value={cfg.settled_partial_s} onChange={(n) => set('settled_partial_s', n)} min={0.3} max={2.5} step={0.05} suffix="s" />
        </Field>

        <Field label="Wait on an unfinished thought" hint="When you stop on an obvious dangling word (&quot;we've got about twenty, but&quot;) she holds on this long for the rest instead of answering half a sentence.">
          <Slider value={cfg.unfinished_wait_s} onChange={(n) => set('unfinished_wait_s', n)} min={0} max={3} step={0.1} suffix="s" />
        </Field>

        <Field label="Wait for their hello" hint="How long she lets whoever answered say hello before she speaks. Talking over the greeting is the most obviously machine thing a caller can do.">
          <Slider value={cfg.wait_for_hello_s} onChange={(n) => set('wait_for_hello_s', n)} min={0} max={5} step={0.1} suffix="s" />
        </Field>

        <Field label="Little acknowledgements" hint="How often she says mm, right, gotcha while the model is still writing, which covers the thinking gap for free. Only ever after a statement, never after a question, and never after a one-word answer. Zero turns them off.">
          <Slider value={cfg.backchannel_chance} onChange={(n) => set('backchannel_chance', n)} min={0} max={1} step={0.05} />
        </Field>

        <Field label="How fast she stops when you cut in" hint="How long you must keep talking before she treats it as an interruption. Lower means she gives way sooner. There is no echo of her own voice on a VoIP call, so this can be tighter here than on the SIM rig.">
          <Slider value={cfg.barge_in_ms} onChange={(n) => set('barge_in_ms', n)} min={120} max={900} step={10} suffix="ms" />
        </Field>

        <Field label="How loud you must be to cut in" hint="How far above the line's own quiet level your voice has to be before it counts as you rather than background noise. Lower is more sensitive, and too low means a van engine stops her mid-sentence.">
          <Slider value={cfg.barge_margin_db} onChange={(n) => set('barge_margin_db', n)} min={4} max={30} step={1} suffix=" dB" />
        </Field>

        <Field label="Finish the word before stopping" hint="Cutting at the instant of the decision chops a syllable in half and sounds broken. A person finishes the word and then stops. About one word at speaking pace.">
          <Slider value={cfg.finish_word_ms} onChange={(n) => set('finish_word_ms', n)} min={0} max={500} step={10} suffix="ms" />
        </Field>
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
