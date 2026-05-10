import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Save, Plus, X, Pencil, Trash2,
  ChevronDown, ChevronUp, Globe, FileText, RefreshCw,
  CheckCircle2, AlertCircle, RotateCcw, Phone,
  GripVertical, Clock, Moon, Calendar, Play, Check,
  Upload, Type, Sparkles, Zap, MessageSquare,
  Search, MapPin, ExternalLink,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useAgent } from './hooks/useAgent'
import { useAgents } from './hooks/useAgents'
import { AgentTestChat } from './AgentTestChat'
import type { Agent, AgentType } from '@/core/types/database'

// ─── Constants ────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
]

// Voice models — these go to Retell which supports specific providers
const VOICE_MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Best reasoning, recommended', provider: 'Anthropic' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', desc: 'Fast and light', provider: 'Anthropic' },
  { value: 'gpt-5.5', label: 'GPT-5.5', desc: 'Latest OpenAI', provider: 'OpenAI' },
  { value: 'gpt-5.4', label: 'GPT-5.4', desc: 'Fast and smart', provider: 'OpenAI' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', desc: 'Fast, affordable', provider: 'OpenAI' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', desc: 'Ultra-fast, cheapest', provider: 'OpenAI' },
]

// Chat models — 2026 only, good for conversation
const CHAT_MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Best all-round, recommended', provider: 'Anthropic' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', desc: 'Most capable, premium', provider: 'Anthropic' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', desc: 'Fast and affordable', provider: 'Anthropic' },
  { value: 'gpt-5.5', label: 'GPT-5.5', desc: 'Latest and smartest', provider: 'OpenAI' },
  { value: 'gpt-5.4', label: 'GPT-5.4', desc: 'Fast and smart', provider: 'OpenAI' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', desc: 'Fast, affordable', provider: 'OpenAI' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', desc: 'Ultra-fast, cheapest', provider: 'OpenAI' },
  { value: 'grok-4.3', label: 'Grok 4.3', desc: 'Latest, most capable', provider: 'xAI' },
  { value: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast', desc: 'Fast conversational', provider: 'xAI' },
  { value: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast', desc: 'Great for chat', provider: 'xAI' },
  { value: 'grok-3-mini', label: 'Grok 3 Mini', desc: 'Lightweight, cheapest', provider: 'xAI' },
]

const LANGUAGE_OPTIONS = [
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
]

const ANALYSIS_MODEL_OPTIONS = [
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'claude-sonnet-4-6', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
]

const VOICES = [
  { id: 'retell-Willa', name: 'Willa', description: 'Warm and professional', accent: 'British' },
  { id: 'retell-Maren', name: 'Maren', description: 'Friendly and upbeat', accent: 'British' },
  { id: '11labs-Dorothy', name: 'Dorothy', description: 'Calm and reassuring', accent: 'British' },
  { id: '11labs-Amy', name: 'Amy', description: 'Bright and clear', accent: 'British' },
  { id: '11labs-Anthony', name: 'Anthony', description: 'Confident and clear', accent: 'British' },
  { id: 'cartesia-Adam', name: 'Adam', description: 'Polished and articulate', accent: 'British' },
]


const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const PERSISTENCE_OPTIONS = [
  { value: 1, label: 'Light', description: 'One gentle nudge' },
  { value: 2, label: 'Normal', description: 'Two follow-ups' },
  { value: 3, label: 'Persistent', description: 'Three follow-ups' },
]

// ─── TimingPicker: +/- stepper with seconds/minutes/hours radio ────────────
type TimeUnit = 'seconds' | 'minutes' | 'hours'

function secondsToUnit(totalSeconds: number): { value: number; unit: TimeUnit } {
  if (totalSeconds >= 3600 && totalSeconds % 3600 === 0) return { value: totalSeconds / 3600, unit: 'hours' }
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) return { value: totalSeconds / 60, unit: 'minutes' }
  return { value: totalSeconds, unit: 'seconds' }
}

function unitToSeconds(value: number, unit: TimeUnit): number {
  if (unit === 'hours') return value * 3600
  if (unit === 'minutes') return value * 60
  return value
}

function TimingPicker({ value, onChange, min = 0, max = 604800, label }: {
  value: number
  onChange: (seconds: number) => void
  min?: number
  max?: number
  label?: string
}) {
  const parsed = secondsToUnit(value)
  const [num, setNum] = useState(parsed.value)
  const [unit, setUnit] = useState<TimeUnit>(parsed.unit)

  useEffect(() => {
    const p = secondsToUnit(value)
    setNum(p.value)
    setUnit(p.unit)
  }, [value])

  const commit = (n: number, u: TimeUnit) => {
    const s = unitToSeconds(Math.max(0, n), u)
    const clamped = Math.min(max, Math.max(min, s))
    onChange(clamped)
  }

  const step = (dir: 1 | -1) => {
    const next = Math.max(0, num + dir)
    setNum(next)
    commit(next, unit)
  }

  const switchUnit = (u: TimeUnit) => {
    setUnit(u)
    commit(num, u)
  }

  return (
    <div>
      {label && <label className="mb-1.5 block text-[13px] font-medium text-ink">{label}</label>}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-border bg-white">
          <button
            type="button"
            onClick={() => step(-1)}
            className="flex h-10 w-10 items-center justify-center text-[18px] font-bold text-ink-muted hover:bg-ink-subtle/10 rounded-l-lg transition"
          >−</button>
          <input
            type="number"
            min={0}
            value={num}
            onChange={(e) => {
              const n = parseInt(e.target.value) || 0
              setNum(n)
              commit(n, unit)
            }}
            className="h-10 w-16 border-x border-border bg-white text-center text-[14px] font-semibold text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => step(1)}
            className="flex h-10 w-10 items-center justify-center text-[18px] font-bold text-ink-muted hover:bg-ink-subtle/10 rounded-r-lg transition"
          >+</button>
        </div>
        <div className="flex rounded-lg border border-border bg-white overflow-hidden">
          {(['seconds', 'minutes', 'hours'] as TimeUnit[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              className={cn(
                'h-10 px-3 text-[12px] font-medium transition border-r last:border-r-0 border-border',
                unit === u ? 'bg-brand text-white' : 'text-ink-muted hover:bg-ink-subtle/10'
              )}
            >{u}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function TimingMultiPicker({ values, onChange, label }: {
  values: number[]
  onChange: (seconds: number[]) => void
  label?: string
}) {
  const addTiming = () => {
    const next = values.length === 0 ? 3600 : values[values.length - 1] * 2
    onChange([...values, next].sort((a, b) => b - a))
  }

  const removeTiming = (idx: number) => {
    if (values.length <= 1) return
    onChange(values.filter((_, i) => i !== idx))
  }

  const updateTiming = (idx: number, seconds: number) => {
    const next = [...values]
    next[idx] = seconds
    onChange(next.sort((a, b) => b - a))
  }

  return (
    <div>
      {label && <label className="mb-1.5 block text-[13px] font-medium text-ink">{label}</label>}
      <div className="space-y-2">
        {values.sort((a, b) => b - a).map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <TimingPicker value={v} onChange={(s) => updateTiming(i, s)} />
            {values.length > 1 && (
              <button
                type="button"
                onClick={() => removeTiming(i)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-ink-muted hover:bg-red-50 hover:text-red-500 transition"
              ><X size={14} /></button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addTiming}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] font-medium text-ink-muted hover:border-brand hover:text-brand transition"
        >
          <Plus size={14} /> Add reminder time
        </button>
      </div>
    </div>
  )
}

const FOLLOWUP_CHANNEL_OPTIONS = [
  { value: 'same_channel', label: 'Same channel', desc: 'Reply where they messaged' },
  { value: 'whatsapp', label: 'WhatsApp', desc: 'Always via WhatsApp' },
  { value: 'sms', label: 'SMS', desc: 'Always via text' },
  { value: 'email', label: 'Email', desc: 'Always via email' },
]

const FOLLOWUP_TONE_OPTIONS = [
  { value: 'friendly', label: 'Friendly' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
]

const DEFAULT_FOLLOWUP_PROMPT = `Hi {name}, just following up on our conversation earlier. Is there anything else I can help with or would you like to book a time? We're here whenever you're ready.`

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || ''

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}))

// ─── Types ────────────────────────────────────────────────────────────

interface SectionDef {
  id: string
  label: string
}

interface TrainingSource {
  id: string
  name: string
  type: 'website' | 'document'
  url: string | null
  status: 'processing' | 'synced' | 'failed'
  summary: string | null
}

interface FAQItem {
  id: string
  question: string
  answer: string
}

interface InfoField {
  id: string
  label: string
  enabled: boolean
  required: boolean
}

interface CustomRule {
  id: string
  text: string
}

// ─── Section list builder ─────────────────────────────────────────────

function getSections(agentType: AgentType): SectionDef[] {
  if (agentType === 'voice') {
    return [
      { id: 'training', label: 'Training' },
      { id: 'behaviour', label: 'Behaviour' },
      { id: 'voice', label: 'Voice' },
      { id: 'greeting', label: 'Greeting' },
      { id: 'services', label: 'Services' },
      { id: 'faqs', label: 'FAQs' },
      { id: 'call-info', label: 'Info to Collect' },
      { id: 'availability', label: 'Availability' },
      { id: 'automation', label: 'Automation' },
      { id: 'confirmations', label: 'Confirmations & Reminders' },
    ]
  }
  return [
    { id: 'training', label: 'Training' },
    { id: 'behaviour', label: 'Behaviour' },
    { id: 'greeting', label: 'Greeting' },
    { id: 'services', label: 'Services' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'ai-model', label: 'AI Model' },
    { id: 'timing', label: 'Timing' },
    { id: 'automation', label: 'Automation' },
    { id: 'confirmations', label: 'Confirmations & Reminders' },
  ]
}

// ─── Main component ───────────────────────────────────────────────────

export default function AgentEditorPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const { businessId, session } = useAuth()
  const { data: agent, loading: agentLoading, refetch: refetchAgent } = useAgent(agentId!)
  const { data: allAgents } = useAgents()

  // ── Section scroll tracking ──
  const [activeSection, setActiveSection] = useState('training')
  const sectionRefs = useRef<Record<string, IntersectionObserverEntry>>({})

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          sectionRefs.current[entry.target.id] = entry
        })
        const visible = Object.values(sectionRefs.current)
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActiveSection(visible[0].target.id)
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )
    const sections = document.querySelectorAll('[data-section]')
    sections.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [agent])

  // ── Agent name ──
  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState(false)

  // ── Behaviour state ──
  const [tone, setTone] = useState('professional')
  const [instructions, setInstructions] = useState('')
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [newRule, setNewRule] = useState('')
  const [addingRule, setAddingRule] = useState(false)

  // ── AI Model state ──
  const [aiModel, setAiModel] = useState('claude-sonnet-4-6')

  // ── Voice state ──
  const [voiceId, setVoiceId] = useState('retell-Willa')
  const [voiceSpeed, setVoiceSpeed] = useState(1.0)
  const [voiceLanguage, setVoiceLanguage] = useState('en-GB')
  const [interruptionSensitivity, setInterruptionSensitivity] = useState(0.9)
  const [maxCallDuration, setMaxCallDuration] = useState(3600)
  const [analysisModel, setAnalysisModel] = useState('claude-sonnet-4-6')
  const [playing, setPlaying] = useState<string | null>(null)

  // ── Greeting state ──
  const [greeting, setGreeting] = useState('')

  // ── Services state ──
  const [services, setServices] = useState<string[]>([])
  const [newService, setNewService] = useState('')
  const [addingService, setAddingService] = useState(false)

  // ── FAQs state ──
  const [faqs, setFaqs] = useState<FAQItem[]>([])
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null)
  const [editingFaq, setEditingFaq] = useState<string | null>(null)
  const [editFaqQ, setEditFaqQ] = useState('')
  const [editFaqA, setEditFaqA] = useState('')
  const [addingFaq, setAddingFaq] = useState(false)
  const [newFaqQ, setNewFaqQ] = useState('')
  const [newFaqA, setNewFaqA] = useState('')

  // ── Call info state ──
  const [infoFields, setInfoFields] = useState<InfoField[]>([])
  const [addingField, setAddingField] = useState(false)
  const [newFieldLabel, setNewFieldLabel] = useState('')

  // ── Timing state ──
  const [delay, setDelay] = useState(1200)
  const [afterHoursDelay, setAfterHoursDelay] = useState(0)
  const [workStart, setWorkStart] = useState(8)
  const [workEnd, setWorkEnd] = useState(18)
  const [workDays, setWorkDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [connectingCalendar, setConnectingCalendar] = useState(false)

  // ── Training state ──
  const [sources, setSources] = useState<TrainingSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [trainingUrl, setTrainingUrl] = useState('')
  const [addingUrl, setAddingUrl] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pastingText, setPastingText] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [deletingSource, setDeletingSource] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false)

  // ── Google Places state ──
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<Array<{ id: string; name: string; address: string; website: string }>>([])
  const [searchingPlaces, setSearchingPlaces] = useState(false)
  const placeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Automation state ──
  const [autoReply, setAutoReply] = useState(true)
  const [draftMode, setDraftMode] = useState(false)
  const [followUpEnabled, setFollowUpEnabled] = useState(true)
  const [followUpAttempts, setFollowUpAttempts] = useState(2)
  const [followUpDelays, setFollowUpDelays] = useState<number[]>([7200, 86400])
  const [followUpChannel, setFollowUpChannel] = useState('same_channel')
  const [followUpTone, setFollowUpTone] = useState('friendly')
  const [followUpPrompt, setFollowUpPrompt] = useState(DEFAULT_FOLLOWUP_PROMPT)

  // ── Confirmation & Reminder state ──
  const [confirmEnabled, setConfirmEnabled] = useState(true)
  const [confirmDelay, setConfirmDelay] = useState(1)
  const [confirmChannels, setConfirmChannels] = useState<string[]>(['whatsapp', 'sms', 'email'])
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [reminderTimes, setReminderTimes] = useState<number[]>([86400, 3600])
  const [reminderChannels, setReminderChannels] = useState<string[]>(['whatsapp', 'sms', 'email'])
  const [ownerConfirmEnabled, setOwnerConfirmEnabled] = useState(true)
  const [ownerReminderEnabled, setOwnerReminderEnabled] = useState(true)
  const [ownerReminderTimes, setOwnerReminderTimes] = useState<number[]>([86400])

  // ── Save state ──
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Copy from dropdown ──
  const [showCopyMenu, setShowCopyMenu] = useState(false)
  const [showTestChat, setShowTestChat] = useState(false)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  const isVoice = agent?.agent_type === 'voice'
  const sections = agent ? getSections(agent.agent_type) : []

  // ── AI Refine helper ──
  const [refining, setRefining] = useState<string | null>(null)

  async function refineText(
    text: string,
    type: 'instructions' | 'greeting' | 'rules' | 'followup' | 'training_text',
    setter: (val: string) => void,
    refineKey: string,
    toneOverride?: string,
  ) {
    if (!text.trim() || refining) return
    setRefining(refineKey)
    try {
      const res = await fetch('/api/agent/refine', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text, type, tone: toneOverride || tone, agentId, businessId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.refined) setter(data.refined)
      }
    } catch { /* silent */ }
    setRefining(null)
  }

  // ── Load agent data into state ──
  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setTone(agent.tone || 'professional')
    setInstructions(agent.ai_system_prompt || '')
    setGreeting(agent.greeting || '')
    setVoiceId(agent.voice_id || 'retell-Willa')
    setVoiceSpeed(agent.voice_speed ?? 1.0)
    setVoiceLanguage(agent.language || 'en-GB')
    setInterruptionSensitivity(agent.interruption_sensitivity ?? 0.9)
    setMaxCallDuration(agent.max_call_duration_seconds ?? 3600)
    setAnalysisModel(agent.post_call_analysis_model || 'claude-sonnet-4-6')
    setAiModel(agent.ai_model || 'claude-sonnet-4-6')
    setDelay(agent.takeover_delay_seconds ?? 1200)
    setAfterHoursDelay(agent.after_hours_delay_seconds ?? 0)
    setWorkStart(agent.working_hours_start ?? 8)
    setWorkEnd(agent.working_hours_end ?? 18)
    setWorkDays(agent.working_days?.length ? agent.working_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

    // Automation
    setAutoReply(agent.auto_reply_enabled ?? true)
    setDraftMode(agent.draft_mode ?? false)
    setFollowUpEnabled(agent.follow_up_enabled ?? true)
    setFollowUpAttempts(agent.follow_up_max_attempts ?? 2)
    const rawDelays = agent.follow_up_delay_hours ?? [7200, 86400]
    const isLegacyHours = rawDelays.length > 0 && rawDelays.every(d => d <= 100)
    setFollowUpDelays(isLegacyHours ? rawDelays.map(h => h * 3600) : rawDelays)
    setFollowUpChannel(agent.follow_up_preferred_channel ?? 'same_channel')
    setFollowUpTone(agent.follow_up_tone ?? 'friendly')
    setFollowUpPrompt(agent.follow_up_prompt || DEFAULT_FOLLOWUP_PROMPT)

    // Confirmations & Reminders
    setConfirmEnabled(agent.confirmation_enabled ?? true)
    setConfirmDelay(agent.confirmation_delay_seconds ?? 1)
    setConfirmChannels(agent.confirmation_channels ?? ['whatsapp', 'sms', 'email'])
    setReminderEnabled(agent.reminder_enabled ?? true)
    setReminderTimes(agent.reminder_times_seconds ?? [86400, 3600])
    setReminderChannels(agent.reminder_channels ?? ['whatsapp', 'sms', 'email'])
    setOwnerConfirmEnabled(agent.owner_confirmation_enabled ?? true)
    setOwnerReminderEnabled(agent.owner_reminder_enabled ?? true)
    setOwnerReminderTimes(agent.owner_reminder_times_seconds ?? [86400])

    // No custom delay logic needed — TimingPicker handles any value
  }, [agent])

  // ── Check calendar connection ──
  useEffect(() => {
    if (!businessId) return
    supabase
      .from('businesses')
      .select('google_calendar_tokens')
      .eq('id', businessId)
      .single()
      .then(({ data }) => setCalendarConnected(!!data?.google_calendar_tokens))
  }, [businessId])

  // ── Load services ──
  useEffect(() => {
    if (!businessId || !agentId) return
    supabase
      .from('services')
      .select('id, name, sort_order')
      .eq('business_id', businessId)
      .eq('agent_id', agentId)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setServices(data.map((s: { name: string }) => s.name))
      })
  }, [businessId, agentId])

  // ── Load FAQs ──
  useEffect(() => {
    if (!businessId || !agentId) return
    supabase
      .from('faqs')
      .select('id, question, answer')
      .eq('business_id', businessId)
      .eq('agent_id', agentId)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setFaqs(data as FAQItem[])
      })
  }, [businessId, agentId])

  // ── Load call info fields ──
  useEffect(() => {
    if (!businessId || !agentId) return
    supabase
      .from('call_info_types')
      .select('id, name, enabled, sort_order')
      .eq('business_id', businessId)
      .eq('agent_id', agentId)
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setInfoFields(
            (data as Array<{ id: string; name: string; enabled: boolean; sort_order: number }>).map((r) => ({
              id: r.id,
              label: r.name,
              enabled: r.enabled,
              required: false,
            }))
          )
        } else {
          setInfoFields([
            { id: '1', label: 'Caller name', enabled: true, required: true },
            { id: '2', label: 'Phone number', enabled: true, required: true },
            { id: '3', label: 'Email address', enabled: true, required: false },
            { id: '4', label: 'Address / Location', enabled: true, required: false },
            { id: '5', label: 'Preferred date & time', enabled: true, required: false },
            { id: '6', label: 'Nature of enquiry', enabled: true, required: true },
          ])
        }
      })
  }, [businessId, agentId])

  // ── Load custom rules from instructions ──
  useEffect(() => {
    if (!agent?.ai_system_prompt) return
    // Rules are stored as lines starting with "- RULE: " in the system prompt
    const lines = agent.ai_system_prompt.split('\n')
    const rules: CustomRule[] = []
    const instructionLines: string[] = []
    lines.forEach((line) => {
      if (line.startsWith('- RULE: ')) {
        rules.push({ id: Date.now().toString() + Math.random(), text: line.replace('- RULE: ', '') })
      } else {
        instructionLines.push(line)
      }
    })
    if (rules.length > 0) {
      setCustomRules(rules)
      setInstructions(instructionLines.join('\n').trim())
    }
  }, [agent])

  // ── Fetch training sources ──
  const fetchSources = useCallback(async () => {
    if (!session) return
    setFetchError(null)
    try {
      const res = await fetch(`/api/training/sources?agent_id=${agentId}`, { headers })
      const data = await res.json()
      setSources(data.sources ?? [])
    } catch {
      setFetchError('Failed to load knowledge sources')
    } finally {
      setSourcesLoading(false)
    }
  }, [session, agentId])

  useEffect(() => {
    if (session && agentId) fetchSources()
  }, [session, agentId, fetchSources])

  // Poll processing sources
  useEffect(() => {
    const hasProcessing = sources.some((s) => s.status === 'processing')
    if (!hasProcessing) return
    const interval = setInterval(fetchSources, 5000)
    return () => clearInterval(interval)
  }, [sources, fetchSources])

  // ── Training actions ──
  async function addWebsite() {
    if (!trainingUrl.trim() || addingUrl) return
    let normalized = trainingUrl.trim()
    if (!normalized.startsWith('http')) normalized = 'https://' + normalized
    setAddingUrl(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/training/scrape', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: normalized, agent_id: agentId }),
      })
      if (res.ok) {
        setTrainingUrl('')
        await fetchSources()
      } else {
        setFetchError('Failed to add website')
      }
    } catch {
      setFetchError('Failed to add website')
    } finally {
      setAddingUrl(false)
    }
  }

  async function addPastedText() {
    if (!pasteText.trim() || pastingText) return
    setPastingText(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/training/scrape', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: pasteText.trim(), agent_id: agentId }),
      })
      if (res.ok) {
        setPasteText('')
        await fetchSources()
      } else {
        setFetchError('Failed to add text')
      }
    } catch {
      setFetchError('Failed to add text')
    } finally {
      setPastingText(false)
    }
  }

  async function deleteSource(id: string) {
    setDeletingSource(id)
    setFetchError(null)
    try {
      await fetch(`/api/training/sources?id=${id}`, { method: 'DELETE', headers })
      setSources((prev) => prev.filter((s) => s.id !== id))
    } catch {
      setFetchError('Failed to delete source')
    } finally {
      setDeletingSource(null)
    }
  }

  function searchPlaces(value: string) {
    setPlaceQuery(value)
    if (placeDebounceRef.current) clearTimeout(placeDebounceRef.current)
    if (value.length < 3 || !GOOGLE_PLACES_KEY) {
      setPlaceResults([])
      return
    }
    placeDebounceRef.current = setTimeout(async () => {
      setSearchingPlaces(true)
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri',
          },
          body: JSON.stringify({
            textQuery: value,
            locationBias: { rectangle: { low: { latitude: 49.9, longitude: -6.4 }, high: { latitude: 58.7, longitude: 1.8 } } },
            maxResultCount: 5,
          }),
        })
        const data = await res.json()
        setPlaceResults((data.places ?? []).map((p: Record<string, unknown>) => ({
          id: (p.id as string) ?? '',
          name: ((p.displayName as Record<string, string>)?.text) ?? '',
          address: (p.formattedAddress as string) ?? '',
          website: (p.websiteUri as string) ?? '',
        })))
      } catch {
        setPlaceResults([])
      } finally {
        setSearchingPlaces(false)
      }
    }, 350)
  }

  async function selectPlace(place: { id: string; name: string; address: string; website: string }) {
    setPlaceQuery('')
    setPlaceResults([])
    if (place.website) {
      setTrainingUrl('')
      setAddingUrl(true)
      setFetchError(null)
      try {
        const res = await fetch('/api/training/scrape', {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: place.website, agent_id: agentId }),
        })
        if (res.ok) await fetchSources()
        else setFetchError('Failed to scrape business website')
      } catch {
        setFetchError('Failed to scrape business website')
      } finally {
        setAddingUrl(false)
      }
    }
    const infoText = `Business: ${place.name}\nAddress: ${place.address}${place.website ? `\nWebsite: ${place.website}` : ''}`
    try {
      const res = await fetch('/api/training/scrape', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: infoText, agent_id: agentId }),
      })
      if (res.ok) await fetchSources()
    } catch { /* silent */ }
  }

  function handleGenerateClick() {
    if (generating) return
    const hasSections = greeting.trim() || services.length > 0 || faqs.length > 0 || instructions.trim() || customRules.length > 0
    if (hasSections) {
      setShowGenerateConfirm(true)
    } else {
      runGenerate('fill')
    }
  }

  async function runGenerate(mode: 'fill' | 'overwrite') {
    setShowGenerateConfirm(false)
    setGenerating(true)
    try {
      const res = await fetch('/api/training/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ agent_id: agentId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.config) {
          const fill = mode === 'fill'
          if (data.config.greeting && (!fill || !greeting.trim())) setGreeting(data.config.greeting)
          if (data.config.tone && (!fill || tone === 'professional')) setTone(data.config.tone)
          if (data.config.instructions && (!fill || !instructions.trim())) setInstructions(data.config.instructions)
          if (data.config.rules?.length && (!fill || customRules.length === 0)) {
            setCustomRules(data.config.rules.map((r: string, i: number) => ({
              id: `gen-${i}`,
              text: typeof r === 'string' ? r : r,
            })))
          }
          if (data.config.services?.length && (!fill || services.length === 0)) {
            setServices(data.config.services.map((s: { name: string } | string) =>
              typeof s === 'string' ? s : s.name
            ))
          }
          if (data.config.faqs?.length && (!fill || faqs.length === 0)) {
            setFaqs(data.config.faqs.map((f: { question: string; answer: string }, i: number) => ({
              id: `gen-${i}`,
              question: f.question,
              answer: f.answer,
            })))
          }
          if (data.config.info_fields?.length && (!fill || infoFields.every(f => ['Caller name', 'Phone number', 'Email address', 'Address / Location', 'Preferred date & time', 'Nature of enquiry'].includes(f.label)))) {
            setInfoFields(data.config.info_fields.map((label: string, i: number) => ({
              id: `gen-${i}`,
              label: typeof label === 'string' ? label : label,
              enabled: true,
              required: i < 2,
            })))
          }

          // Timing
          if (data.config.takeover_delay_seconds != null) setDelay(data.config.takeover_delay_seconds)
          if (data.config.after_hours_delay_seconds != null) setAfterHoursDelay(data.config.after_hours_delay_seconds)
          if (data.config.working_hours_start != null) setWorkStart(data.config.working_hours_start)
          if (data.config.working_hours_end != null) setWorkEnd(data.config.working_hours_end)
          if (data.config.working_days?.length) setWorkDays(data.config.working_days)

          // Automation
          if (data.config.auto_reply_enabled != null) setAutoReply(data.config.auto_reply_enabled)
          if (data.config.draft_mode != null) setDraftMode(data.config.draft_mode)
          if (data.config.follow_up_enabled != null) setFollowUpEnabled(data.config.follow_up_enabled)
          if (data.config.follow_up_max_attempts != null) setFollowUpAttempts(data.config.follow_up_max_attempts)
          if (data.config.follow_up_delay_hours?.length) setFollowUpDelays(data.config.follow_up_delay_hours)
          if (data.config.follow_up_preferred_channel) setFollowUpChannel(data.config.follow_up_preferred_channel)
          if (data.config.follow_up_tone) setFollowUpTone(data.config.follow_up_tone)
          if (data.config.follow_up_prompt) setFollowUpPrompt(data.config.follow_up_prompt)

          // Confirmations & Reminders
          if (data.config.confirmation_enabled != null) setConfirmEnabled(data.config.confirmation_enabled)
          if (data.config.confirmation_delay_seconds != null) setConfirmDelay(data.config.confirmation_delay_seconds)
          if (data.config.confirmation_channels?.length) setConfirmChannels(data.config.confirmation_channels)
          if (data.config.reminder_enabled != null) setReminderEnabled(data.config.reminder_enabled)
          if (data.config.reminder_times_seconds?.length) setReminderTimes(data.config.reminder_times_seconds)
          if (data.config.reminder_channels?.length) setReminderChannels(data.config.reminder_channels)
          if (data.config.owner_confirmation_enabled != null) setOwnerConfirmEnabled(data.config.owner_confirmation_enabled)
          if (data.config.owner_reminder_enabled != null) setOwnerReminderEnabled(data.config.owner_reminder_enabled)
          if (data.config.owner_reminder_times_seconds?.length) setOwnerReminderTimes(data.config.owner_reminder_times_seconds)
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }))
        setFetchError(err.error || 'Failed to generate')
      }
    } catch {
      setFetchError('Failed to generate from training data')
    } finally {
      setGenerating(false)
    }
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !session) return
    setFetchError(null)
    const formData = new FormData()
    formData.append('file', file)
    if (agentId) formData.append('agent_id', agentId)
    try {
      const res = await fetch('/api/training/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      })
      if (res.ok) {
        await fetchSources()
      } else {
        setFetchError('Failed to upload document')
      }
    } catch {
      setFetchError('Failed to upload document')
    }
    e.target.value = ''
  }

  // ── Copy from another agent ──
  async function copyFromAgent(sourceId: string) {
    setShowCopyMenu(false)
    const { data: src } = await supabase
      .from('agents')
      .select('*')
      .eq('id', sourceId)
      .single()
    if (!src) return
    const source = src as Agent
    setTone(source.tone || 'professional')
    setInstructions(source.ai_system_prompt || '')
    setGreeting(source.greeting || '')
    if (source.voice_id) setVoiceId(source.voice_id)
    if (source.voice_speed) setVoiceSpeed(source.voice_speed)
    if (source.ai_model) setAiModel(source.ai_model)
    if (source.language) setVoiceLanguage(source.language)
    if (source.interruption_sensitivity != null) setInterruptionSensitivity(source.interruption_sensitivity)
    if (source.max_call_duration_seconds != null) setMaxCallDuration(source.max_call_duration_seconds)
    if (source.post_call_analysis_model) setAnalysisModel(source.post_call_analysis_model)
    if (source.takeover_delay_seconds != null) setDelay(source.takeover_delay_seconds)
    if (source.after_hours_delay_seconds != null) setAfterHoursDelay(source.after_hours_delay_seconds)
    if (source.working_hours_start != null) setWorkStart(source.working_hours_start)
    if (source.working_hours_end != null) setWorkEnd(source.working_hours_end)
    if (source.working_days?.length) setWorkDays(source.working_days)

    // Copy services
    const { data: srcServices } = await supabase
      .from('services')
      .select('name')
      .eq('agent_id', sourceId)
      .order('sort_order')
    if (srcServices) setServices(srcServices.map((s: { name: string }) => s.name))

    // Copy FAQs
    const { data: srcFaqs } = await supabase
      .from('faqs')
      .select('question, answer')
      .eq('agent_id', sourceId)
      .order('sort_order')
    if (srcFaqs) setFaqs(srcFaqs.map((f: { question: string; answer: string }, i: number) => ({
      id: `copy-${i}`,
      question: f.question,
      answer: f.answer,
    })))

    // Copy call info
    const { data: srcFields } = await supabase
      .from('call_info_types')
      .select('name, enabled, sort_order')
      .eq('agent_id', sourceId)
      .order('sort_order')
    if (srcFields && srcFields.length > 0) {
      setInfoFields(srcFields.map((f: { name: string; enabled: boolean }, i: number) => ({
        id: `copy-${i}`,
        label: f.name,
        enabled: f.enabled,
        required: false,
      })))
    }
  }

  // ── Save all ──
  async function handleSaveAll() {
    if (!businessId || !agentId) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)

    try {
      // Build system prompt with rules
      let fullPrompt = instructions.trim()
      if (customRules.length > 0) {
        const rulesBlock = customRules.map((r) => `- RULE: ${r.text}`).join('\n')
        fullPrompt = fullPrompt ? `${fullPrompt}\n${rulesBlock}` : rulesBlock
      }

      const effectiveDelay = delay
      const effectiveAfter = afterHoursDelay

      // 1. Update agent record
      const { error: agentErr } = await supabase
        .from('agents')
        .update({
          name,
          greeting: greeting || null,
          tone,
          ai_system_prompt: fullPrompt || null,
          voice_id: isVoice ? voiceId : agent?.voice_id ?? null,
          voice_speed: isVoice ? voiceSpeed : agent?.voice_speed ?? null,
          ai_model: aiModel,
          language: isVoice ? voiceLanguage : agent?.language ?? null,
          interruption_sensitivity: isVoice ? interruptionSensitivity : agent?.interruption_sensitivity ?? null,
          max_call_duration_seconds: isVoice ? maxCallDuration : agent?.max_call_duration_seconds ?? null,
          post_call_analysis_model: isVoice ? analysisModel : agent?.post_call_analysis_model ?? null,
          takeover_delay_seconds: effectiveDelay,
          after_hours_delay_seconds: effectiveAfter,
          working_hours_start: workStart,
          working_hours_end: workEnd,
          working_days: workDays,
          auto_reply_enabled: autoReply,
          draft_mode: draftMode,
          follow_up_enabled: followUpEnabled,
          follow_up_max_attempts: followUpAttempts,
          follow_up_delay_hours: followUpDelays,
          follow_up_preferred_channel: followUpChannel,
          follow_up_tone: followUpTone,
          follow_up_prompt: followUpPrompt === DEFAULT_FOLLOWUP_PROMPT ? null : followUpPrompt || null,
          confirmation_enabled: confirmEnabled,
          confirmation_delay_seconds: confirmDelay,
          confirmation_channels: confirmChannels,
          reminder_enabled: reminderEnabled,
          reminder_times_seconds: reminderTimes,
          reminder_channels: reminderChannels,
          owner_confirmation_enabled: ownerConfirmEnabled,
          owner_reminder_enabled: ownerReminderEnabled,
          owner_reminder_times_seconds: ownerReminderTimes,
        })
        .eq('id', agentId)
        .eq('business_id', businessId)

      if (agentErr) throw agentErr

      // 2. Replace services
      await supabase.from('services').delete().eq('agent_id', agentId).eq('business_id', businessId)
      if (services.length > 0) {
        await supabase.from('services').insert(
          services.map((svcName, i) => ({
            business_id: businessId,
            agent_id: agentId,
            name: svcName,
            sort_order: i,
          }))
        )
      }

      // 3. Replace FAQs
      await supabase.from('faqs').delete().eq('agent_id', agentId).eq('business_id', businessId)
      if (faqs.length > 0) {
        await supabase.from('faqs').insert(
          faqs.map((f, i) => ({
            business_id: businessId,
            agent_id: agentId,
            question: f.question,
            answer: f.answer,
            sort_order: i,
          }))
        )
      }

      // 4. Replace call info types (voice only)
      if (isVoice) {
        await supabase.from('call_info_types').delete().eq('agent_id', agentId).eq('business_id', businessId)
        if (infoFields.length > 0) {
          await supabase.from('call_info_types').insert(
            infoFields.map((f, i) => ({
              business_id: businessId,
              agent_id: agentId,
              name: f.label,
              enabled: f.enabled,
              sort_order: i,
            }))
          )
        }
      }

      // 5. Sync auto-reply + draft mode to channels assigned to this agent
      await supabase
        .from('channels')
        .update({ auto_reply_enabled: autoReply, draft_mode: draftMode })
        .eq('agent_id', agentId)
        .eq('business_id', businessId)

      // 6. Sync follow-up settings to business-level table (backwards compat)
      await supabase
        .from('follow_up_settings')
        .upsert({
          business_id: businessId,
          enabled: followUpEnabled,
          max_attempts: followUpAttempts,
          delay_hours: followUpDelays,
          preferred_channel: followUpChannel,
          tone: followUpTone,
        }, { onConflict: 'business_id' })

      // 7. Sync prompt for voice agents
      if (isVoice && session) {
        await fetch('/api/agent/sync-prompt', {
          method: 'POST',
          headers,
          body: JSON.stringify({ businessId, agentId }),
        })
      }

      refetchAgent()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading state ──
  if (agentLoading || !agent) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  const otherAgents = allAgents.filter((a) => a.id !== agentId)

  return (
    <div className="relative">
      {/* ── Header ── */}
      <div className="mb-6">
        <Link
          to="/agents"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={14} />
          Agents
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {editingName ? (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                autoFocus
                className="h-9 rounded-lg border border-brand bg-surface px-3 text-lg font-semibold text-ink outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-lg font-semibold text-ink hover:text-brand"
              >
                {name}
              </button>
            )}
            {agent.status === 'active' ? (
              <button
                onClick={async () => {
                  await supabase.from('agents').update({ status: 'paused' }).eq('id', agentId)
                  window.location.reload()
                }}
                className="rounded-full bg-success/10 px-3 py-0.5 text-[11px] font-medium text-success transition hover:bg-amber-100 hover:text-amber-700"
              >
                Active — click to pause
              </button>
            ) : (
              <button
                onClick={async () => {
                  await supabase.from('agents').update({ status: 'active' }).eq('id', agentId)
                  window.location.reload()
                }}
                className="rounded-full bg-amber-100 px-3 py-0.5 text-[11px] font-semibold text-amber-700 transition hover:bg-success/10 hover:text-success"
              >
                {agent.status === 'draft' ? 'Draft' : 'Paused'} — click to activate
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Copy from dropdown */}
            {otherAgents.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowCopyMenu(!showCopyMenu)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-ink-muted transition hover:bg-elevated"
                >
                  Copy from...
                  <ChevronDown size={14} />
                </button>
                {showCopyMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowCopyMenu(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-border bg-surface p-1 shadow-lg">
                      {otherAgents.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => copyFromAgent(a.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-elevated"
                        >
                          <span className="truncate">{a.name}</span>
                          <span className="shrink-0 text-[11px] text-ink-subtle">{a.agent_type}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Test + Save buttons (desktop) */}
            {!isVoice && agent && (
              <button
                onClick={() => setShowTestChat(v => !v)}
                className="hidden h-9 items-center gap-2 rounded-lg border border-ink/15 bg-surface px-4 text-[13px] font-medium text-ink transition hover:bg-elevated sm:flex"
              >
                <MessageSquare size={14} />
                Test Agent
              </button>
            )}
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="hidden h-9 items-center gap-2 rounded-lg bg-brand px-5 text-[13px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60 sm:flex"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>

        {saveError && (
          <p className="mt-2 text-[13px] text-danger">{saveError}</p>
        )}
      </div>

      {/* ── Mobile sticky pill bar ── */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 overflow-x-auto bg-surface/95 px-4 py-2 backdrop-blur lg:hidden">
        <div className="flex gap-1.5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn(
                'whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition',
                activeSection === s.id
                  ? 'bg-brand text-white'
                  : 'bg-elevated text-ink-muted'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Two column layout ── */}
      <div className="flex gap-8">
        {/* Side nav (desktop) */}
        <div className="hidden lg:block lg:w-40 lg:shrink-0">
          <nav className="sticky top-6 space-y-1">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className={cn(
                  'block w-full rounded-lg px-3 py-1.5 text-left text-[13px] transition',
                  activeSection === s.id
                    ? 'bg-brand/10 font-medium text-brand'
                    : 'text-ink-muted hover:text-ink'
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Scrollable content */}
        <div className="min-w-0 flex-1 space-y-8 pb-24">
          {/* ════════ TRAINING ════════ */}
          <section id="training" data-section className="scroll-mt-20">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Knowledge Sources</h2>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    Elsie learns from these sources to answer questions accurately.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerateClick}
                    disabled={generating || sources.length === 0}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-brand px-3 text-[13px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-50"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Generate
                  </button>
                  <button
                    onClick={fetchSources}
                    disabled={sourcesLoading}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-ink-muted transition hover:bg-elevated disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={cn(sourcesLoading && 'animate-spin')} />
                    Refresh
                  </button>
                </div>
              </div>

              {fetchError && (
                <p className="mt-3 text-[13px] text-danger">{fetchError}</p>
              )}

              <div className="mt-4 space-y-2">
                {sourcesLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                  </div>
                ) : sources.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-ink-muted">
                    No knowledge sources yet. Add a website, upload a document, or paste text below.
                  </p>
                ) : (
                  sources.map((src) => (
                    <div key={src.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated">
                        {src.type === 'website' ? (
                          <Globe size={16} className="text-brand" />
                        ) : (
                          <FileText size={16} className="text-brand" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-ink">{src.name}</p>
                        <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
                          {src.status === 'synced' && (
                            <>
                              <CheckCircle2 size={12} className="text-success" />
                              <span>Synced</span>
                            </>
                          )}
                          {src.status === 'processing' && (
                            <>
                              <Loader2 size={12} className="animate-spin text-brand" />
                              <span>Processing...</span>
                            </>
                          )}
                          {src.status === 'failed' && (
                            <>
                              <AlertCircle size={12} className="text-danger" />
                              <span>Failed</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteSource(src.id)}
                        disabled={deletingSource === src.id}
                        className="text-ink-subtle hover:text-danger disabled:opacity-50"
                      >
                        {deletingSource === src.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Generate confirmation modal */}
            {showGenerateConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl">
                  <h3 className="text-[16px] font-semibold text-ink">Generate from training data</h3>
                  <p className="mt-2 text-[13px] text-ink-muted">
                    Some sections already have content. What would you like to do?
                  </p>
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => runGenerate('fill')}
                      className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition hover:border-brand/40 hover:bg-brand/5"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10">
                        <Plus size={16} className="text-brand" />
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-ink">Fill empty sections only</p>
                        <p className="text-[12px] text-ink-muted">Keep what you have, fill in the blanks</p>
                      </div>
                    </button>
                    <button
                      onClick={() => runGenerate('overwrite')}
                      className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left transition hover:border-amber-400 hover:bg-amber-50"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                        <RefreshCw size={16} className="text-amber-600" />
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-ink">Overwrite everything</p>
                        <p className="text-[12px] text-ink-muted">Replace all sections with fresh AI-generated content</p>
                      </div>
                    </button>
                  </div>
                  <button
                    onClick={() => setShowGenerateConfirm(false)}
                    className="mt-4 w-full rounded-lg border border-border py-2 text-[13px] text-ink-muted transition hover:bg-elevated"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Find business on Google */}
            {GOOGLE_PLACES_KEY && (
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-ink-muted" />
                  <h3 className="text-[14px] font-medium text-ink">Find your business</h3>
                </div>
                <p className="mt-1 text-[13px] text-ink-muted">Search Google to pull in your business info automatically.</p>
                <div className="relative mt-3">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                  <input
                    type="text"
                    value={placeQuery}
                    onChange={(e) => searchPlaces(e.target.value)}
                    placeholder="Search your business name..."
                    className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
                  />
                  {searchingPlaces && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 size={14} className="animate-spin text-brand" />
                    </div>
                  )}
                  {placeResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-border bg-surface shadow-lg">
                      {placeResults.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => selectPlace(r)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-elevated"
                        >
                          <MapPin size={16} className="mt-0.5 shrink-0 text-ink-subtle" />
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-ink">{r.name}</p>
                            <p className="truncate text-[12px] text-ink-muted">{r.address}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Add website */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <h3 className="text-[14px] font-medium text-ink">Add website</h3>
              <p className="mt-1 text-[13px] text-ink-muted">Elsie will scrape and learn from your website content.</p>
              <div className="mt-3 flex gap-2">
                <input
                  type="url"
                  value={trainingUrl}
                  onChange={(e) => setTrainingUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addWebsite()}
                  placeholder="https://yourbusiness.co.uk"
                  className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
                />
                <button
                  onClick={addWebsite}
                  disabled={addingUrl || !trainingUrl.trim()}
                  className="flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
                >
                  {addingUrl && <Loader2 size={14} className="animate-spin" />}
                  Add
                </button>
              </div>
            </div>

            {/* Upload document */}
            <div className="mt-4 flex gap-4">
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-4 text-[13px] text-ink-muted transition hover:border-brand/40 hover:bg-brand/5">
                <Upload size={16} />
                Upload document
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,.txt" onChange={handleUploadFile} />
              </label>
            </div>

            {/* Paste text */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center gap-2">
                <Type size={14} className="text-ink-muted" />
                <h3 className="text-[14px] font-medium text-ink">Paste text</h3>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste business info, policies, price lists, etc."
                rows={4}
                className="mt-3 w-full rounded-lg border border-border bg-surface p-3 text-[14px] text-ink outline-none resize-none placeholder:text-ink-subtle focus:border-brand"
              />
              {pasteText.trim() && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => refineText(pasteText, 'training_text', setPasteText, 'paste')}
                    disabled={refining === 'paste'}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-brand px-3 text-[13px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
                  >
                    {refining === 'paste' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    Refine
                  </button>
                  <button
                    onClick={addPastedText}
                    disabled={pastingText}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
                  >
                    {pastingText && <Loader2 size={14} className="animate-spin" />}
                    Add text
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ════════ BEHAVIOUR ════════ */}
          <section id="behaviour" data-section className="scroll-mt-20">
            {/* Tone */}
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <h2 className="text-[15px] font-semibold text-ink">Tone</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Set the overall tone for how Elsie communicates.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {TONE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTone(opt.value)}
                    className={cn(
                      'rounded-full px-4 py-1.5 text-[13px] font-medium transition',
                      tone === opt.value
                        ? 'bg-brand text-white'
                        : 'bg-elevated text-ink-muted hover:bg-brand/10 hover:text-brand'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom instructions */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <h2 className="text-[15px] font-semibold text-ink">Custom Instructions</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Give Elsie specific instructions. Write as if briefing a new receptionist.
              </p>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value.slice(0, 2000))}
                placeholder="e.g. If you don't know the answer, say 'Let me take your details and have someone call you back'."
                rows={8}
                className="mt-4 w-full rounded-xl border border-border bg-surface p-4 text-[14px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] text-ink-subtle">
                  {instructions.length} / 2000 characters
                </span>
                {instructions.trim() && (
                  <button
                    onClick={() => refineText(instructions, 'instructions', setInstructions, 'instructions')}
                    disabled={refining === 'instructions'}
                    className="flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-[12px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
                  >
                    {refining === 'instructions' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Refine with AI
                  </button>
                )}
              </div>
            </div>

            {/* Custom rules */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Custom Rules</h2>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    Strict rules Elsie must always follow.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {customRules.length > 0 && (
                    <button
                      onClick={() => {
                        const allRules = customRules.map(r => r.text).join('\n')
                        refineText(allRules, 'rules', (refined) => {
                          const newRules = refined.split('\n').filter(l => l.trim()).map(text => ({
                            id: Date.now().toString() + Math.random(),
                            text: text.replace(/^[-•*]\s*/, '').trim(),
                          }))
                          setCustomRules(newRules)
                        }, 'rules')
                      }}
                      disabled={refining === 'rules'}
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-brand px-3 text-[13px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
                    >
                      {refining === 'rules' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Refine
                    </button>
                  )}
                  <button
                    onClick={() => setAddingRule(true)}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
                  >
                    <Plus size={14} />
                    Add Rule
                  </button>
                </div>
              </div>

              {addingRule && (
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={newRule}
                    onChange={(e) => setNewRule(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newRule.trim()) {
                        setCustomRules([...customRules, { id: Date.now().toString(), text: newRule.trim() }])
                        setNewRule('')
                        setAddingRule(false)
                      }
                    }}
                    placeholder="e.g. Never quote exact prices"
                    autoFocus
                    className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
                  />
                  <button
                    onClick={() => {
                      if (newRule.trim()) {
                        setCustomRules([...customRules, { id: Date.now().toString(), text: newRule.trim() }])
                        setNewRule('')
                        setAddingRule(false)
                      }
                    }}
                    className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white"
                  >
                    Add
                  </button>
                  <button onClick={() => setAddingRule(false)} className="h-10 rounded-lg border border-border px-3 text-ink-muted">
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {customRules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
                    <span className="flex-1 text-[14px] text-ink">{rule.text}</span>
                    <button
                      onClick={() => setCustomRules(customRules.filter((r) => r.id !== rule.id))}
                      className="text-ink-subtle hover:text-danger"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {customRules.length === 0 && !addingRule && (
                  <p className="text-[13px] text-ink-muted">No custom rules yet.</p>
                )}
              </div>
            </div>
          </section>

          {/* ════════ VOICE (voice agents only) ════════ */}
          {isVoice && (
            <section id="voice" data-section className="scroll-mt-20">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Voice</h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Choose how Elsie sounds on calls.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {VOICES.map((voice) => (
                    <button
                      key={voice.id}
                      onClick={() => setVoiceId(voice.id)}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-4 text-left transition',
                        voiceId === voice.id
                          ? 'border-brand bg-brand-50 shadow-sm'
                          : 'border-border hover:border-brand/30'
                      )}
                    >
                      <div className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                        voiceId === voice.id ? 'bg-brand text-white' : 'bg-elevated text-ink-muted'
                      )}>
                        {voiceId === voice.id ? <Check size={16} /> : voice.name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[14px] font-medium text-ink">{voice.name}</p>
                          <span className="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-ink-subtle">{voice.accent}</span>
                        </div>
                        <p className="text-[12px] text-ink-muted">{voice.description}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPlaying(playing === voice.id ? null : voice.id) }}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border transition hover:bg-elevated"
                      >
                        <Play size={12} className={cn('text-ink-muted', playing === voice.id && 'text-brand')} />
                      </button>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Speaking Speed</h2>
                <p className="mt-1 text-[13px] text-ink-muted">Adjust how fast Elsie speaks.</p>
                <div className="mt-4">
                  <input
                    type="range"
                    min={0.7}
                    max={1.3}
                    step={0.1}
                    value={voiceSpeed}
                    onChange={(e) => setVoiceSpeed(parseFloat(e.target.value))}
                    className="w-full accent-brand"
                  />
                  <div className="mt-2 flex justify-between text-[12px] text-ink-subtle">
                    <span>Slower</span>
                    <span className="font-medium text-ink">{voiceSpeed.toFixed(1)}x</span>
                    <span>Faster</span>
                  </div>
                </div>
              </div>

              {/* AI Model */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">AI Model</h2>
                <p className="mt-1 text-[13px] text-ink-muted">The brain behind the conversation. Smarter models cost more per call.</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {VOICE_MODEL_OPTIONS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setAiModel(m.value)}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition',
                        aiModel === m.value ? 'border-brand bg-brand-50 shadow-sm' : 'border-border hover:border-brand/30'
                      )}
                    >
                      <p className="text-[14px] font-medium text-ink">{m.label}</p>
                      <p className="text-[12px] text-ink-muted">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Language</h2>
                <p className="mt-1 text-[13px] text-ink-muted">Primary language for the AI receptionist.</p>
                <select
                  value={voiceLanguage}
                  onChange={(e) => setVoiceLanguage(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand"
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Interruption Sensitivity */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Interruption Sensitivity</h2>
                <p className="mt-1 text-[13px] text-ink-muted">How easily the caller can interrupt the AI. Higher = easier to interrupt.</p>
                <div className="mt-4">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={interruptionSensitivity}
                    onChange={(e) => setInterruptionSensitivity(parseFloat(e.target.value))}
                    className="w-full accent-brand"
                  />
                  <div className="mt-2 flex justify-between text-[12px] text-ink-subtle">
                    <span>Hard to interrupt</span>
                    <span className="font-medium text-ink">{interruptionSensitivity.toFixed(1)}</span>
                    <span>Easy to interrupt</span>
                  </div>
                </div>
              </div>

              {/* Max Call Duration */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Max Call Duration</h2>
                <p className="mt-1 text-[13px] text-ink-muted">Automatically ends the call after this duration.</p>
                <select
                  value={maxCallDuration}
                  onChange={(e) => setMaxCallDuration(parseInt(e.target.value))}
                  className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand"
                >
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={900}>15 minutes</option>
                  <option value={1800}>30 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </div>

              {/* Post-Call Analysis Model */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h2 className="text-[15px] font-semibold text-ink">Post-Call Analysis</h2>
                <p className="mt-1 text-[13px] text-ink-muted">AI model used to analyse calls after they end (sentiment, summary).</p>
                <select
                  value={analysisModel}
                  onChange={(e) => setAnalysisModel(e.target.value)}
                  className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-brand"
                >
                  {ANALYSIS_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </section>
          )}

          {/* ════════ GREETING ════════ */}
          <section id="greeting" data-section className="scroll-mt-20">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <h2 className="text-[15px] font-semibold text-ink">Opening Greeting</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                {isVoice ? 'What callers hear first when Elsie picks up.' : 'The first message Elsie sends in a new conversation.'}
              </p>
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={4}
                placeholder={`Hello, thanks for contacting us! How can I help you today?`}
                className="mt-4 w-full rounded-xl border border-border bg-surface p-4 text-[15px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={() => setGreeting(`Hello, thanks for contacting us! How can I help you today?`)}
                  className="flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
                >
                  <RotateCcw size={14} />
                  Reset to default
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-ink-subtle">{greeting.length} characters</span>
                  {greeting.trim() && (
                    <button
                      onClick={() => refineText(greeting, 'greeting', setGreeting, 'greeting')}
                      disabled={refining === 'greeting'}
                      className="flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-[12px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
                    >
                      {refining === 'greeting' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      Refine with AI
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center gap-2">
                <Phone size={16} className="text-ink-muted" />
                <h3 className="text-[14px] font-medium text-ink">Preview</h3>
              </div>
              <div className="mt-4 rounded-xl bg-elevated p-4">
                <div className="flex gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[12px] font-bold text-brand">
                    E
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm">
                    <p className="text-[14px] leading-relaxed text-ink">{greeting || 'No greeting set'}</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ════════ SERVICES ════════ */}
          <section id="services" data-section className="scroll-mt-20">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Your Services</h2>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    Elsie will tell customers about these services when asked.
                  </p>
                </div>
                <button
                  onClick={() => setAddingService(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>

              {addingService && (
                <div className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={newService}
                    onChange={(e) => setNewService(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newService.trim()) {
                        setServices([...services, newService.trim()])
                        setNewService('')
                        setAddingService(false)
                      }
                    }}
                    placeholder="e.g. Power Flushing"
                    autoFocus
                    className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                  <button
                    onClick={() => {
                      if (newService.trim()) {
                        setServices([...services, newService.trim()])
                        setNewService('')
                        setAddingService(false)
                      }
                    }}
                    className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white"
                  >
                    Add
                  </button>
                  <button onClick={() => setAddingService(false)} className="h-10 rounded-lg border border-border px-3 text-ink-muted">
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {services.map((service, i) => (
                  <div
                    key={i}
                    className="group flex items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-[14px] text-ink transition hover:border-brand/30"
                  >
                    {service}
                    <button
                      onClick={() => setServices(services.filter((_, idx) => idx !== i))}
                      className="text-ink-subtle opacity-0 transition group-hover:opacity-100 hover:text-danger"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {services.length === 0 && (
                  <p className="text-[13px] text-ink-muted">No services added yet.</p>
                )}
              </div>
            </div>
          </section>

          {/* ════════ FAQs ════════ */}
          <section id="faqs" data-section className="scroll-mt-20">
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Frequently Asked Questions</h2>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    Elsie uses these to answer common questions instantly.
                  </p>
                </div>
                <button
                  onClick={() => setAddingFaq(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>

              {addingFaq && (
                <div className="mt-4 space-y-3 rounded-xl border border-brand/20 bg-brand-50 p-4">
                  <input
                    type="text"
                    value={newFaqQ}
                    onChange={(e) => setNewFaqQ(e.target.value)}
                    placeholder="Question (e.g. Do you offer free quotes?)"
                    autoFocus
                    className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-ink outline-none focus:border-brand"
                  />
                  <textarea
                    value={newFaqA}
                    onChange={(e) => setNewFaqA(e.target.value)}
                    placeholder="Answer"
                    rows={3}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[14px] text-ink outline-none resize-none focus:border-brand"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (newFaqQ.trim() && newFaqA.trim()) {
                          setFaqs([...faqs, { id: Date.now().toString(), question: newFaqQ.trim(), answer: newFaqA.trim() }])
                          setNewFaqQ('')
                          setNewFaqA('')
                          setAddingFaq(false)
                        }
                      }}
                      className="h-9 rounded-lg bg-brand px-4 text-[13px] font-medium text-white"
                    >
                      Add
                    </button>
                    <button onClick={() => setAddingFaq(false)} className="h-9 rounded-lg border border-border px-4 text-[13px] text-ink-muted">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {faqs.map((faq) => (
                  <div key={faq.id} className="rounded-xl border border-border transition hover:border-brand/20">
                    {editingFaq === faq.id ? (
                      <div className="space-y-3 p-4">
                        <input
                          type="text"
                          value={editFaqQ}
                          onChange={(e) => setEditFaqQ(e.target.value)}
                          className="h-10 w-full rounded-lg border border-border bg-elevated px-3 text-[14px] text-ink outline-none focus:border-brand"
                        />
                        <textarea
                          value={editFaqA}
                          onChange={(e) => setEditFaqA(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-border bg-elevated px-3 py-2 text-[14px] text-ink outline-none resize-none focus:border-brand"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setFaqs(faqs.map((f) => f.id === editingFaq ? { ...f, question: editFaqQ, answer: editFaqA } : f))
                              setEditingFaq(null)
                            }}
                            className="h-9 rounded-lg bg-brand px-4 text-[13px] font-medium text-white"
                          >
                            Save
                          </button>
                          <button onClick={() => setEditingFaq(null)} className="h-9 rounded-lg border border-border px-4 text-[13px] text-ink-muted">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <button
                          onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                          className="flex w-full items-center justify-between px-4 py-3 text-left"
                        >
                          <span className="text-[14px] font-medium text-ink">{faq.question}</span>
                          {expandedFaq === faq.id ? (
                            <ChevronUp size={16} className="text-ink-subtle" />
                          ) : (
                            <ChevronDown size={16} className="text-ink-subtle" />
                          )}
                        </button>
                        {expandedFaq === faq.id && (
                          <div className="border-t border-border px-4 py-3">
                            <p className="text-[14px] leading-relaxed text-ink-muted">{faq.answer}</p>
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingFaq(faq.id)
                                  setEditFaqQ(faq.question)
                                  setEditFaqA(faq.answer)
                                }}
                                className="flex items-center gap-1.5 text-[12px] text-brand hover:underline"
                              >
                                <Pencil size={12} /> Edit
                              </button>
                              <button
                                onClick={() => setFaqs(faqs.filter((f) => f.id !== faq.id))}
                                className="flex items-center gap-1.5 text-[12px] text-danger hover:underline"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {faqs.length === 0 && (
                  <p className="py-4 text-center text-[13px] text-ink-muted">No FAQs added yet.</p>
                )}
              </div>
            </div>
          </section>

          {/* ════════ CALL INFO (voice only) ════════ */}
          {isVoice && (
            <section id="call-info" data-section className="scroll-mt-20">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">Information to Collect</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      Choose what Elsie asks callers for during the conversation.
                    </p>
                  </div>
                  <button
                    onClick={() => setAddingField(true)}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
                  >
                    <Plus size={14} />
                    Add field
                  </button>
                </div>

                {addingField && (
                  <div className="mt-4 flex gap-2">
                    <input
                      type="text"
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newFieldLabel.trim()) {
                          setInfoFields([...infoFields, { id: Date.now().toString(), label: newFieldLabel.trim(), enabled: true, required: false }])
                          setNewFieldLabel('')
                          setAddingField(false)
                        }
                      }}
                      placeholder="e.g. Property type"
                      autoFocus
                      className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
                    />
                    <button
                      onClick={() => {
                        if (newFieldLabel.trim()) {
                          setInfoFields([...infoFields, { id: Date.now().toString(), label: newFieldLabel.trim(), enabled: true, required: false }])
                          setNewFieldLabel('')
                          setAddingField(false)
                        }
                      }}
                      className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white"
                    >
                      Add
                    </button>
                    <button onClick={() => setAddingField(false)} className="h-10 rounded-lg border border-border px-3 text-ink-muted">
                      <X size={16} />
                    </button>
                  </div>
                )}

                <div className="mt-4 space-y-2">
                  {infoFields.map((field) => (
                    <div
                      key={field.id}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-4 py-3 transition',
                        field.enabled ? 'border-border bg-surface' : 'border-border/50 bg-elevated/50 opacity-60'
                      )}
                    >
                      <GripVertical size={16} className="shrink-0 text-ink-subtle" />
                      <span className="flex-1 text-[14px] text-ink">{field.label}</span>

                      {field.enabled && (
                        <button
                          onClick={() => setInfoFields(infoFields.map((f) => f.id === field.id ? { ...f, required: !f.required } : f))}
                          className={cn(
                            'rounded-md px-2 py-0.5 text-[11px] font-medium transition',
                            field.required ? 'bg-brand/10 text-brand' : 'bg-elevated text-ink-subtle hover:bg-brand/10 hover:text-brand'
                          )}
                        >
                          {field.required ? 'Required' : 'Optional'}
                        </button>
                      )}

                      <button
                        onClick={() => setInfoFields(infoFields.map((f) => f.id === field.id ? { ...f, enabled: !f.enabled } : f))}
                        className={cn(
                          'relative h-6 w-11 rounded-full transition-colors',
                          field.enabled ? 'bg-brand' : 'bg-border'
                        )}
                      >
                        <div className={cn(
                          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                          field.enabled ? 'translate-x-5' : 'translate-x-0.5'
                        )} />
                      </button>

                      <button
                        onClick={() => setInfoFields(infoFields.filter((f) => f.id !== field.id))}
                        className="text-ink-subtle hover:text-danger"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ════════ AI MODEL (non-voice) ════════ */}
          {!isVoice && (
            <section id="ai-model" data-section className="scroll-mt-20">
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
                    <Sparkles size={18} className="text-brand" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">AI Model</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">Choose which AI powers this agent's conversations.</p>
                  </div>
                </div>
                <div className="mt-4">
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-white px-3 text-[14px] text-ink focus:border-brand focus:outline-none"
                  >
                    {['Anthropic', 'OpenAI', 'xAI'].map((provider) => (
                      <optgroup key={provider} label={provider}>
                        {CHAT_MODEL_OPTIONS.filter(m => m.provider === provider).map((m) => (
                          <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          )}

          {/* ════════ TIMING (non-voice only) ════════ */}
          {!isVoice && (
            <section id="timing" data-section className="scroll-mt-20">
              {/* During hours */}
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
                    <Clock size={18} className="text-brand" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">During working hours</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      How long Elsie waits before responding. If you reply first, Elsie stays silent.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <TimingPicker value={delay} onChange={setDelay} />
                </div>
              </div>

              {/* After hours */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
                    <Moon size={18} className="text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">After working hours</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      How long Elsie waits outside your working hours.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <TimingPicker value={afterHoursDelay} onChange={setAfterHoursDelay} />
                </div>
              </div>

              {/* Working hours */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                    <Calendar size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">Working hours</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      Outside these hours, Elsie uses the after-hours delay.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-medium text-ink">Working days</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day}
                        onClick={() => setWorkDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])}
                        className={cn(
                          'rounded-full px-4 py-1.5 text-[13px] font-medium transition',
                          workDays.includes(day)
                            ? 'bg-emerald-500 text-white'
                            : 'bg-elevated text-ink-muted hover:bg-emerald-100 hover:text-emerald-700'
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-ink">Opens at</label>
                    <select
                      value={workStart}
                      onChange={(e) => setWorkStart(Number(e.target.value))}
                      className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                  <span className="mt-6 text-ink-muted">to</span>
                  <div>
                    <label className="text-[13px] font-medium text-ink">Closes at</label>
                    <select
                      value={workEnd}
                      onChange={(e) => setWorkEnd(Number(e.target.value))}
                      className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>
          )}
          {/* ════════ AVAILABILITY (voice only) ════════ */}
          {agent?.agent_type === 'voice' && (
            <section id="availability" data-section className="scroll-mt-20">
              {/* Working hours */}
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                    <Clock size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">Working Hours</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      Elsie will only offer appointment slots within these hours.
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-medium text-ink">Working days</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map((day) => (
                      <button
                        key={day}
                        onClick={() => setWorkDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])}
                        className={cn(
                          'rounded-full px-4 py-1.5 text-[13px] font-medium transition',
                          workDays.includes(day)
                            ? 'bg-emerald-500 text-white'
                            : 'bg-elevated text-ink-muted hover:bg-emerald-100 hover:text-emerald-700'
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-ink">Opens at</label>
                    <select
                      value={workStart}
                      onChange={(e) => setWorkStart(Number(e.target.value))}
                      className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                  <span className="mt-6 text-ink-muted">to</span>
                  <div>
                    <label className="text-[13px] font-medium text-ink">Closes at</label>
                    <select
                      value={workEnd}
                      onChange={(e) => setWorkEnd(Number(e.target.value))}
                      className="mt-1 block w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {HOURS.map((h) => (
                        <option key={h.value} value={h.value}>{h.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Google Calendar */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                    <Calendar size={18} className="text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-[15px] font-semibold text-ink">Google Calendar</h2>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {calendarConnected
                        ? 'Connected — Elsie checks your real calendar for conflicts before booking.'
                        : 'Optional — connect to avoid double-bookings. Without it, Elsie uses working hours above.'}
                    </p>
                  </div>
                </div>

                <div className="mt-4">
                  {calendarConnected ? (
                    <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 p-4">
                      <CheckCircle2 size={18} className="text-success" />
                      <div className="flex-1">
                        <p className="text-[14px] font-medium text-ink">Google Calendar</p>
                        <p className="text-[12px] text-success">Connected</p>
                      </div>
                      <button
                        onClick={async () => {
                          setConnectingCalendar(true)
                          try {
                            await fetch('/api/calendar/disconnect', {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${session?.access_token}` },
                            })
                            setCalendarConnected(false)
                          } finally { setConnectingCalendar(false) }
                        }}
                        disabled={connectingCalendar}
                        className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-danger hover:bg-danger/5 disabled:opacity-60"
                      >
                        {connectingCalendar ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        setConnectingCalendar(true)
                        try {
                          const res = await fetch('/api/calendar/connect', {
                            headers: { Authorization: `Bearer ${session?.access_token}` },
                          })
                          const { url } = await res.json()
                          window.location.href = url
                        } catch { setConnectingCalendar(false) }
                      }}
                      disabled={connectingCalendar}
                      className="flex w-full items-center gap-3 rounded-xl border border-border p-4 transition hover:border-blue-300 disabled:opacity-60"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                        <Calendar size={18} className="text-blue-600" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-[14px] font-medium text-ink">Connect Google Calendar</p>
                        <p className="text-[12px] text-ink-muted">
                          {connectingCalendar ? 'Redirecting to Google...' : 'Sync your real availability'}
                        </p>
                      </div>
                      {connectingCalendar ? (
                        <Loader2 size={16} className="animate-spin text-ink-muted" />
                      ) : (
                        <ExternalLink size={16} className="text-ink-muted" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-surface/50 p-4">
                <p className="text-[12px] leading-relaxed text-ink-muted">
                  <strong className="text-ink">How it works:</strong> When a caller asks to book, Elsie checks
                  the working hours above for available slots. If Google Calendar is connected, she also checks
                  for conflicts so you never get double-booked.
                </p>
              </div>
            </section>
          )}
          {/* ════════ AUTOMATION ════════ */}
          <section id="automation" data-section className="scroll-mt-20">
            {/* Auto-reply + Draft mode */}
            <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
                  <Zap size={16} className="text-brand" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Auto-Reply</h2>
                  <p className="text-[12px] text-ink-muted">
                    Elsie automatically replies to incoming messages on this agent's channels.
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div>
                    <p className="text-[14px] font-medium text-ink">Auto-reply enabled</p>
                    <p className="text-[12px] text-ink-muted">Elsie responds to new messages automatically</p>
                  </div>
                  <button
                    onClick={() => setAutoReply(!autoReply)}
                    className={cn('relative h-6 w-11 rounded-full transition-colors', autoReply ? 'bg-brand' : 'bg-border')}
                  >
                    <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', autoReply ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div>
                    <p className="text-[14px] font-medium text-ink">Draft mode</p>
                    <p className="text-[12px] text-ink-muted">Review AI replies before they're sent</p>
                  </div>
                  <button
                    onClick={() => setDraftMode(!draftMode)}
                    className={cn('relative h-6 w-11 rounded-full transition-colors', draftMode ? 'bg-brand' : 'bg-border')}
                  >
                    <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', draftMode ? 'translate-x-5' : 'translate-x-0.5')} />
                  </button>
                </div>
              </div>
            </div>

            {/* Follow-ups master toggle */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
                    <MessageSquare size={16} className="text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-ink">Automatic Follow-ups</h2>
                    <p className="text-[12px] text-ink-muted">
                      Elsie follows up with leads who don't book
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setFollowUpEnabled(!followUpEnabled)}
                  className={cn('relative h-6 w-11 rounded-full transition-colors', followUpEnabled ? 'bg-brand' : 'bg-border')}
                >
                  <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', followUpEnabled ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </div>
            </div>

            <div className={cn('space-y-4 transition-opacity', !followUpEnabled && 'pointer-events-none opacity-40')}>
              {/* Persistence */}
              <div className="mt-4 rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h3 className="text-[14px] font-semibold text-ink">How persistent?</h3>
                <p className="mt-1 text-[12px] text-ink-muted">How many times should Elsie follow up before stopping</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {PERSISTENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setFollowUpAttempts(opt.value)
                        const defaults = opt.value === 1 ? [7200] : opt.value === 2 ? [7200, 86400] : [7200, 86400, 259200]
                        setFollowUpDelays(defaults.slice(0, opt.value))
                      }}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition',
                        followUpAttempts === opt.value
                          ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                          : 'border-border hover:border-ink-subtle'
                      )}
                    >
                      <p className="text-[13px] font-semibold text-ink">{opt.label}</p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{opt.description}</p>
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  {Array.from({ length: followUpAttempts }, (_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-[13px] font-medium text-ink">
                        {i === 0 ? '1st follow-up' : i === 1 ? '2nd follow-up' : '3rd follow-up'}
                      </span>
                      <span className="text-[12px] text-ink-muted">after</span>
                      <TimingPicker
                        value={followUpDelays[i] ?? (i === 0 ? 7200 : i === 1 ? 86400 : 259200)}
                        onChange={(s) => {
                          const newDelays = [...followUpDelays]
                          newDelays[i] = s
                          setFollowUpDelays(newDelays)
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Follow-up channel */}
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h3 className="text-[14px] font-semibold text-ink">Follow-up channel</h3>
                <p className="mt-1 text-[12px] text-ink-muted">Which channel to use for follow-up messages</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {FOLLOWUP_CHANNEL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFollowUpChannel(opt.value)}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition',
                        followUpChannel === opt.value
                          ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                          : 'border-border hover:border-ink-subtle'
                      )}
                    >
                      <p className="text-[13px] font-semibold text-ink">{opt.label}</p>
                      <p className="mt-0.5 text-[11px] text-ink-muted">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Follow-up tone */}
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h3 className="text-[14px] font-semibold text-ink">Follow-up tone</h3>
                <p className="mt-1 text-[12px] text-ink-muted">How the follow-up messages should sound</p>
                <div className="mt-3 flex gap-2">
                  {FOLLOWUP_TONE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setFollowUpTone(opt.value)}
                      className={cn(
                        'flex-1 rounded-xl border px-4 py-3 text-center transition',
                        followUpTone === opt.value
                          ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                          : 'border-border hover:border-ink-subtle'
                      )}
                    >
                      <p className="text-[12px] font-semibold text-ink">{opt.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Follow-up prompt */}
              <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
                <h3 className="text-[14px] font-semibold text-ink">Follow-up prompt</h3>
                <p className="mt-1 text-[12px] text-ink-muted">
                  Customise what Elsie says when following up. Use {'{name}'} for the customer's first name.
                </p>
                <textarea
                  value={followUpPrompt}
                  onChange={(e) => setFollowUpPrompt(e.target.value)}
                  rows={4}
                  placeholder={DEFAULT_FOLLOWUP_PROMPT}
                  className="mt-3 w-full rounded-xl border border-border bg-surface p-4 text-[14px] leading-relaxed text-ink outline-none resize-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => setFollowUpPrompt(DEFAULT_FOLLOWUP_PROMPT)}
                    className="flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink"
                  >
                    <RotateCcw size={12} />
                    Reset to default
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-ink-subtle">{followUpPrompt.length} characters</span>
                    {followUpPrompt.trim() && (
                      <button
                        onClick={() => refineText(followUpPrompt, 'followup', setFollowUpPrompt, 'followup', followUpTone)}
                        disabled={refining === 'followup'}
                        className="flex items-center gap-1.5 rounded-lg border border-brand px-3 py-1.5 text-[12px] font-medium text-brand transition hover:bg-brand/5 disabled:opacity-60"
                      >
                        {refining === 'followup' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Refine with AI
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 rounded-xl bg-elevated p-4">
                  <p className="text-[11px] font-medium text-ink-muted">Preview:</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink">
                    {followUpPrompt.replace('{name}', 'Sarah')}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface/50 p-4">
                <p className="text-[12px] leading-relaxed text-ink-muted">
                  <strong className="text-ink">How it works:</strong> When a conversation ends without a booking,
                  Elsie automatically sends a follow-up using your prompt above. If the lead replies or books,
                  follow-ups stop immediately.
                </p>
              </div>
            </div>
          </section>

          {/* ════════════ CONFIRMATIONS & REMINDERS ════════════ */}
          <section id="confirmations" data-section className="scroll-mt-20">
            <h2 className="text-[16px] font-semibold text-ink">Confirmations & Reminders</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Automatically confirm bookings and remind prospects before their appointment — like Calendly.
            </p>
            <div className="mt-5 space-y-6">

              {/* ── Prospect Confirmation ── */}
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-ink">Booking Confirmation to Prospect</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">Send the caller a confirmation after their booking</p>
                  </div>
                  <button
                    onClick={() => setConfirmEnabled(!confirmEnabled)}
                    className={`relative h-6 w-11 rounded-full transition ${confirmEnabled ? 'bg-brand' : 'bg-ink-subtle/30'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${confirmEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>

                {confirmEnabled && (
                  <div className="mt-4 space-y-4">
                    <TimingPicker label="Send after" value={confirmDelay} onChange={setConfirmDelay} />
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-ink">Channel priority (first available wins)</label>
                      <div className="flex flex-wrap gap-2">
                        {['whatsapp', 'sms', 'email'].map((ch) => {
                          const active = confirmChannels.includes(ch)
                          const label = ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'SMS' : 'Email'
                          return (
                            <button
                              key={ch}
                              onClick={() => {
                                if (active) {
                                  if (confirmChannels.length > 1) setConfirmChannels(confirmChannels.filter(c => c !== ch))
                                } else {
                                  setConfirmChannels([...confirmChannels, ch])
                                }
                              }}
                              className={`rounded-lg border px-4 py-2 text-[13px] font-medium transition ${
                                active ? 'border-brand bg-brand/10 text-brand' : 'border-border text-ink-muted hover:border-ink-subtle'
                              }`}
                            >
                              {active && <span className="mr-1.5">{confirmChannels.indexOf(ch) + 1}.</span>}
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="mt-1.5 text-[11px] text-ink-subtle">
                        Sends via the first channel the prospect has. Order: {confirmChannels.map(c => c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? 'SMS' : 'Email').join(' → ')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Prospect Reminders ── */}
              <div className="rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] font-semibold text-ink">Appointment Reminders to Prospect</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">Remind the prospect before their appointment</p>
                  </div>
                  <button
                    onClick={() => setReminderEnabled(!reminderEnabled)}
                    className={`relative h-6 w-11 rounded-full transition ${reminderEnabled ? 'bg-brand' : 'bg-ink-subtle/30'}`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${reminderEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>

                {reminderEnabled && (
                  <div className="mt-4 space-y-4">
                    <TimingMultiPicker label="Remind before appointment" values={reminderTimes} onChange={setReminderTimes} />
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-ink">Channel priority</label>
                      <div className="flex flex-wrap gap-2">
                        {['whatsapp', 'sms', 'email'].map((ch) => {
                          const active = reminderChannels.includes(ch)
                          const label = ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'SMS' : 'Email'
                          return (
                            <button
                              key={ch}
                              onClick={() => {
                                if (active) {
                                  if (reminderChannels.length > 1) setReminderChannels(reminderChannels.filter(c => c !== ch))
                                } else {
                                  setReminderChannels([...reminderChannels, ch])
                                }
                              }}
                              className={`rounded-lg border px-4 py-2 text-[13px] font-medium transition ${
                                active ? 'border-brand bg-brand/10 text-brand' : 'border-border text-ink-muted hover:border-ink-subtle'
                              }`}
                            >
                              {active && <span className="mr-1.5">{reminderChannels.indexOf(ch) + 1}.</span>}
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Owner Notifications ── */}
              <div className="rounded-2xl border border-border bg-surface p-5">
                <p className="text-[14px] font-semibold text-ink">Notifications to You (Business Owner)</p>
                <p className="mt-0.5 text-[12px] text-ink-muted">Get notified about bookings and upcoming appointments</p>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-elevated p-4">
                    <div>
                      <p className="text-[13px] font-medium text-ink">New booking alert</p>
                      <p className="text-[11px] text-ink-muted">Notify me when a new booking is made</p>
                    </div>
                    <button
                      onClick={() => setOwnerConfirmEnabled(!ownerConfirmEnabled)}
                      className={`relative h-6 w-11 rounded-full transition ${ownerConfirmEnabled ? 'bg-brand' : 'bg-ink-subtle/30'}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${ownerConfirmEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-xl bg-elevated p-4">
                    <div>
                      <p className="text-[13px] font-medium text-ink">Appointment reminders</p>
                      <p className="text-[11px] text-ink-muted">Remind me before upcoming appointments</p>
                    </div>
                    <button
                      onClick={() => setOwnerReminderEnabled(!ownerReminderEnabled)}
                      className={`relative h-6 w-11 rounded-full transition ${ownerReminderEnabled ? 'bg-brand' : 'bg-ink-subtle/30'}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${ownerReminderEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                    </button>
                  </div>

                  {ownerReminderEnabled && (
                    <div className="ml-4">
                      <TimingMultiPicker label="Remind me before" values={ownerReminderTimes} onChange={setOwnerReminderTimes} />
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-border bg-surface/50 p-4">
                  <p className="text-[12px] leading-relaxed text-ink-muted">
                    <strong className="text-ink">Notification channels</strong> are configured in{' '}
                    <a href="/account" className="text-brand hover:underline">Account Settings → Notifications</a>.
                    Enable WhatsApp, SMS, or email there to receive alerts.
                  </p>
                </div>
              </div>

            </div>
          </section>

        </div>
      </div>

      {/* ── Fixed save button (mobile) ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 p-4 backdrop-blur sm:hidden">
        {!isVoice && agent && (
          <button
            onClick={() => setShowTestChat(v => !v)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink/15 bg-surface text-[14px] font-medium text-ink transition hover:bg-elevated sm:hidden"
          >
            <MessageSquare size={16} />
            Test Agent
          </button>
        )}
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>

      {showTestChat && agent && !isVoice && session && (
        <AgentTestChat
          agentId={agent.id}
          agentName={agent.name}
          agentType={agent.agent_type}
          accessToken={session.access_token}
          onClose={() => setShowTestChat(false)}
        />
      )}
    </div>
  )
}
