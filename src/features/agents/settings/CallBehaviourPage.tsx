import { useEffect, useState } from 'react'
import { Loader2, Check, Phone } from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Input, Label, Textarea } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { Switch } from '@/core/ui/Switch'
import { useAuth } from '@/core/auth/AuthProvider'
import { useDefaultAgent } from '../hooks/useDefaultAgent'
import { FullPromptEditor } from './FullPromptEditor'

/**
 * Call behaviour — the voice-call feel settings that used to live only in
 * Retell (who speaks first, interruptions, response speed, silence reminder,
 * background ambience, max length). Saved to the agents table, then pushed to
 * Retell via /api/agent/sync-prompt (app stays the single source of truth).
 */

const AMBIENCE = [
  { value: '', label: 'None (silent)' },
  { value: 'call-center', label: 'Busy office / call centre' },
  { value: 'coffee-shop', label: 'Coffee shop' },
  { value: 'summer-outdoor', label: 'Outdoors' },
  { value: 'convention-hall', label: 'Conference hall' },
]

export default function CallBehaviourPage() {
  const { agent, businessId, loading, saveAgent } = useDefaultAgent()
  const { session } = useAuth()

  const [startSpeaker, setStartSpeaker] = useState('agent')
  const [interruption, setInterruption] = useState('0.7')
  const [responsiveness, setResponsiveness] = useState('0.7')
  const [reminderOn, setReminderOn] = useState(false)
  const [reminderSec, setReminderSec] = useState(10)
  const [reminderCount, setReminderCount] = useState(1)
  const [ambient, setAmbient] = useState('')
  const [maxMinutes, setMaxMinutes] = useState(60)
  // Advanced
  const [backchannelOn, setBackchannelOn] = useState(false)
  const [backchannelFreq, setBackchannelFreq] = useState('0.8')
  const [beginDelaySec, setBeginDelaySec] = useState(0)
  const [silenceOn, setSilenceOn] = useState(false)
  const [silenceSec, setSilenceSec] = useState(30)
  const [voicemailHangup, setVoicemailHangup] = useState(false)
  const [keypad, setKeypad] = useState(true)
  const [pronunciation, setPronunciation] = useState('')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agent) return
    setStartSpeaker(agent.start_speaker || 'agent')
    setInterruption(String(agent.interruption_sensitivity ?? 0.7))
    setResponsiveness(String(agent.responsiveness ?? 0.7))
    setReminderOn(agent.reminder_trigger_seconds != null)
    setReminderSec(agent.reminder_trigger_seconds ?? 10)
    setReminderCount(agent.reminder_max_count ?? 1)
    setAmbient(agent.ambient_sound || '')
    setMaxMinutes(agent.max_call_duration_seconds ? Math.round(agent.max_call_duration_seconds / 60) : 60)
    setBackchannelOn(agent.backchannel_enabled === true)
    setBackchannelFreq(String(agent.backchannel_frequency ?? 0.8))
    setBeginDelaySec(agent.begin_delay_ms != null ? Math.round(agent.begin_delay_ms / 1000) : 0)
    setSilenceOn(agent.end_silence_seconds != null)
    setSilenceSec(agent.end_silence_seconds ?? 30)
    setVoicemailHangup(agent.voicemail_hangup === true)
    setKeypad(agent.allow_keypad !== false)
    setPronunciation(agent.pronunciation_notes || '')
  }, [agent])

  async function handleSave() {
    if (!agent || !businessId || !session) return
    setSaving(true); setSaved(false); setError(null)
    try {
      const ok = await saveAgent({
        start_speaker: startSpeaker,
        interruption_sensitivity: Number(interruption),
        responsiveness: Number(responsiveness),
        reminder_trigger_seconds: reminderOn ? reminderSec : null,
        reminder_max_count: reminderOn ? reminderCount : null,
        ambient_sound: ambient || null,
        max_call_duration_seconds: Math.max(1, maxMinutes) * 60,
        backchannel_enabled: backchannelOn,
        backchannel_frequency: backchannelOn ? Number(backchannelFreq) : null,
        begin_delay_ms: Math.min(5000, Math.max(0, beginDelaySec) * 1000),
        end_silence_seconds: silenceOn ? Math.max(10, silenceSec) : null,
        voicemail_hangup: voicemailHangup,
        allow_keypad: keypad,
        pronunciation_notes: pronunciation.trim() || null,
      })
      if (!ok) { setError('Could not save. Please try again.'); return }

      // Push the change straight to Retell so it's live immediately.
      const res = await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ businessId, agentId: agent.id }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Saved, but could not sync to the call engine. It will sync shortly.')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-ink-muted" /></div>
  }
  if (!agent) {
    return <div className="rounded-2xl border border-border bg-surface p-8 text-center text-[13px] text-ink-muted">No agent found yet. Finish agent setup first.</div>
  }

  return (
    <div className="space-y-6">
      <SectionCard eyebrow="Calls" title="How Elsie handles a live call" action={<Phone size={16} className="text-ink-subtle" />}>
        <p className="mb-4 text-[13px] text-ink-muted">
          These shape how a phone call feels. Saved here and pushed to the call engine instantly — edit them only on this page (not in Retell).
        </p>

        <div className="space-y-5">
          <div>
            <Label htmlFor="start">Who speaks first</Label>
            <Select id="start" value={startSpeaker} onChange={(e) => setStartSpeaker(e.target.value)}>
              <option value="agent">Elsie greets first</option>
              <option value="user">Wait for the caller to speak</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="interruption">Interruption sensitivity</Label>
            <Select id="interruption" value={interruption} onChange={(e) => setInterruption(e.target.value)}>
              <option value="0.3">Relaxed — let callers finish</option>
              <option value="0.7">Balanced (recommended)</option>
              <option value="1">Quick to pause when interrupted</option>
            </Select>
            <p className="mt-1.5 text-[11px] text-ink-subtle">How readily Elsie stops talking when the caller jumps in.</p>
          </div>

          <div>
            <Label htmlFor="responsiveness">Response speed</Label>
            <Select id="responsiveness" value={responsiveness} onChange={(e) => setResponsiveness(e.target.value)}>
              <option value="0.3">Calm — small natural pause</option>
              <option value="0.7">Natural (recommended)</option>
              <option value="1">Snappy — replies fast</option>
            </Select>
            <p className="mt-1.5 text-[11px] text-ink-subtle">How quickly Elsie replies after the caller finishes.</p>
          </div>

          <div>
            <Label htmlFor="ambient">Background ambience</Label>
            <Select id="ambient" value={ambient} onChange={(e) => setAmbient(e.target.value)}>
              {AMBIENCE.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </Select>
            <p className="mt-1.5 text-[11px] text-ink-subtle">A subtle background sound can make calls feel more human.</p>
          </div>

          <div>
            <Label htmlFor="maxlen">Maximum call length (minutes)</Label>
            <Input id="maxlen" type="number" min={1} max={180} value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value) || 60)} className="max-w-[140px]" />
            <p className="mt-1.5 text-[11px] text-ink-subtle">Elsie ends the call automatically after this long.</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard eyebrow="Calls" title="If the caller goes quiet">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-ink">Check in on silence</p>
            <p className="mt-0.5 text-[12px] text-ink-subtle">Elsie gently re-prompts if the caller stops talking.</p>
          </div>
          <Switch checked={reminderOn} onChange={setReminderOn} />
        </div>
        {reminderOn && (
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <Label htmlFor="rsec">Wait (seconds)</Label>
              <Input id="rsec" type="number" min={3} max={60} value={reminderSec} onChange={(e) => setReminderSec(Number(e.target.value) || 10)} className="max-w-[120px]" />
            </div>
            <div>
              <Label htmlFor="rcount">Up to (times)</Label>
              <Input id="rcount" type="number" min={1} max={5} value={reminderCount} onChange={(e) => setReminderCount(Number(e.target.value) || 1)} className="max-w-[120px]" />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard eyebrow="Calls" title="Advanced call settings">
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Natural affirmations</p>
              <p className="mt-0.5 text-[12px] text-ink-subtle">Elsie says little "mhm", "right" cues while listening — sounds more human.</p>
            </div>
            <Switch checked={backchannelOn} onChange={setBackchannelOn} />
          </div>
          {backchannelOn && (
            <div>
              <Label htmlFor="bcf">How often</Label>
              <Select id="bcf" value={backchannelFreq} onChange={(e) => setBackchannelFreq(e.target.value)} className="max-w-[220px]">
                <option value="0.4">Subtle</option>
                <option value="0.8">Normal</option>
                <option value="1">Chatty</option>
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="delay">Pause before Elsie speaks (seconds)</Label>
            <Input id="delay" type="number" min={0} max={5} value={beginDelaySec} onChange={(e) => setBeginDelaySec(Number(e.target.value) || 0)} className="max-w-[140px]" />
            <p className="mt-1.5 text-[11px] text-ink-subtle">A tiny pause can feel more natural. 0 = answer instantly.</p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Hang up after long silence</p>
              <p className="mt-0.5 text-[12px] text-ink-subtle">End the call if the caller goes completely quiet.</p>
            </div>
            <Switch checked={silenceOn} onChange={setSilenceOn} />
          </div>
          {silenceOn && (
            <div>
              <Label htmlFor="silsec">After (seconds)</Label>
              <Input id="silsec" type="number" min={10} max={120} value={silenceSec} onChange={(e) => setSilenceSec(Number(e.target.value) || 30)} className="max-w-[140px]" />
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Hang up on voicemail</p>
              <p className="mt-0.5 text-[12px] text-ink-subtle">If an outbound call reaches voicemail, end instead of talking to the machine.</p>
            </div>
            <Switch checked={voicemailHangup} onChange={setVoicemailHangup} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-ink">Listen for keypad presses</p>
              <p className="mt-0.5 text-[12px] text-ink-subtle">Let callers type numbers (e.g. an account or reference) on their keypad.</p>
            </div>
            <Switch checked={keypad} onChange={setKeypad} />
          </div>

          <div>
            <Label htmlFor="pron">Pronunciation hints</Label>
            <Textarea id="pron" value={pronunciation} onChange={(e) => setPronunciation(e.target.value)} rows={3} placeholder={'e.g. "Hugo → HEW-go", "NFStay → enn-eff-stay"'} />
            <p className="mt-1.5 text-[11px] text-ink-subtle">Tell Elsie how to say tricky names or brands — one per line.</p>
          </div>
        </div>
      </SectionCard>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
          {saving ? 'Saving…' : saved ? 'Saved & synced' : 'Save changes'}
        </button>
        {error && <span className="text-[12.5px] text-red-600">{error}</span>}
      </div>

      <FullPromptEditor agentId={agent.id} />
    </div>
  )
}
