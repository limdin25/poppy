import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Save, Plus, X, Pencil, Trash2,
  ChevronDown, ChevronUp, Globe, FileText, RefreshCw,
  CheckCircle2, AlertCircle, RotateCcw, Phone,
  GripVertical, Clock, Moon, Calendar, Play, Check,
  Upload, Type, Sparkles,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useAgent } from './hooks/useAgent'
import { useAgents } from './hooks/useAgents'
import type { Agent, AgentType } from '@/core/types/database'

// ─── Constants ────────────────────────────────────────────────────────

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
]

const VOICES = [
  { id: 'retell-Willa', name: 'Willa', description: 'Warm and professional', accent: 'British' },
  { id: 'retell-Maren', name: 'Maren', description: 'Friendly and upbeat', accent: 'British' },
  { id: '11labs-Dorothy', name: 'Dorothy', description: 'Calm and reassuring', accent: 'British' },
  { id: '11labs-Amy', name: 'Amy', description: 'Bright and clear', accent: 'British' },
  { id: '11labs-Anthony', name: 'Anthony', description: 'Confident and clear', accent: 'British' },
  { id: 'cartesia-Adam', name: 'Adam', description: 'Polished and articulate', accent: 'British' },
]

const DELAY_OPTIONS = [
  { value: 0, label: 'Immediately', desc: 'Responds right away' },
  { value: 30, label: '30s', desc: 'Quick pause' },
  { value: 60, label: '1m', desc: 'Short wait' },
  { value: 120, label: '2m', desc: 'Moment to see message' },
  { value: 300, label: '5m', desc: 'Finish a quick task' },
  { value: 600, label: '10m', desc: 'Wrap up a conversation' },
  { value: 1200, label: '20m', desc: 'Default for salons/trades' },
  { value: 1800, label: '30m', desc: 'Long appointments' },
]

const AFTER_HOURS_OPTIONS = [
  { value: 0, label: 'Immediately', desc: 'No one is around' },
  { value: 30, label: '30s', desc: 'Feels natural' },
  { value: 60, label: '1m', desc: 'Short wait' },
  { value: 300, label: '5m', desc: 'Slight delay' },
]

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
      { id: 'timing', label: 'Timing' },
    ]
  }
  return [
    { id: 'training', label: 'Training' },
    { id: 'behaviour', label: 'Behaviour' },
    { id: 'greeting', label: 'Greeting' },
    { id: 'services', label: 'Services' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'timing', label: 'Timing' },
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

  // ── Voice state ──
  const [voiceId, setVoiceId] = useState('retell-Willa')
  const [voiceSpeed, setVoiceSpeed] = useState(1.0)
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
  const [customDelayMin, setCustomDelayMin] = useState(0)
  const [customDelaySec, setCustomDelaySec] = useState(0)
  const [useCustomDelay, setUseCustomDelay] = useState(false)
  const [afterHoursDelay, setAfterHoursDelay] = useState(0)
  const [customAfterMin, setCustomAfterMin] = useState(0)
  const [customAfterSec, setCustomAfterSec] = useState(0)
  const [useCustomAfter, setUseCustomAfter] = useState(false)
  const [workStart, setWorkStart] = useState(8)
  const [workEnd, setWorkEnd] = useState(18)
  const [workDays, setWorkDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

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

  // ── Save state ──
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // ── Copy from dropdown ──
  const [showCopyMenu, setShowCopyMenu] = useState(false)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  const isVoice = agent?.agent_type === 'voice'
  const sections = agent ? getSections(agent.agent_type) : []

  // ── Load agent data into state ──
  useEffect(() => {
    if (!agent) return
    setName(agent.name)
    setTone(agent.tone || 'professional')
    setInstructions(agent.ai_system_prompt || '')
    setGreeting(agent.greeting || '')
    setVoiceId(agent.voice_id || 'retell-Willa')
    setVoiceSpeed(agent.voice_speed ?? 1.0)
    setDelay(agent.takeover_delay_seconds ?? 1200)
    setAfterHoursDelay(agent.after_hours_delay_seconds ?? 0)
    setWorkStart(agent.working_hours_start ?? 8)
    setWorkEnd(agent.working_hours_end ?? 18)
    setWorkDays(agent.working_days?.length ? agent.working_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

    // Check custom delays
    const isStdDelay = DELAY_OPTIONS.some((o) => o.value === (agent.takeover_delay_seconds ?? 1200))
    if (!isStdDelay && agent.takeover_delay_seconds != null) {
      setUseCustomDelay(true)
      setCustomDelayMin(Math.floor(agent.takeover_delay_seconds / 60))
      setCustomDelaySec(agent.takeover_delay_seconds % 60)
    }
    const isStdAfter = AFTER_HOURS_OPTIONS.some((o) => o.value === (agent.after_hours_delay_seconds ?? 0))
    if (!isStdAfter && agent.after_hours_delay_seconds != null) {
      setUseCustomAfter(true)
      setCustomAfterMin(Math.floor(agent.after_hours_delay_seconds / 60))
      setCustomAfterSec(agent.after_hours_delay_seconds % 60)
    }
  }, [agent])

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

  async function handleGenerate() {
    if (generating) return
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
          if (data.config.greeting) setGreeting(data.config.greeting)
          if (data.config.services) setServices(data.config.services.map((s: { name: string }) => s.name))
          if (data.config.faqs) setFaqs(data.config.faqs.map((f: { question: string; answer: string }, i: number) => ({
            id: `gen-${i}`,
            question: f.question,
            answer: f.answer,
          })))
          if (data.config.tone) setTone(data.config.tone)
        }
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

      const effectiveDelay = useCustomDelay ? customDelayMin * 60 + customDelaySec : delay
      const effectiveAfter = useCustomAfter ? customAfterMin * 60 + customAfterSec : afterHoursDelay

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
          takeover_delay_seconds: effectiveDelay,
          after_hours_delay_seconds: effectiveAfter,
          working_hours_start: workStart,
          working_hours_end: workEnd,
          working_days: workDays,
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

      // 5. Sync prompt for voice agents
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
  const statusColor = agent.status === 'active' ? 'bg-success/10 text-success' : agent.status === 'paused' ? 'bg-amber-100 text-amber-700' : 'bg-elevated text-ink-muted'

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
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize', statusColor)}>
              {agent.status}
            </span>
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

            {/* Save button (desktop) */}
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
                    onClick={handleGenerate}
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
                <button
                  onClick={addPastedText}
                  disabled={pastingText}
                  className="mt-2 flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
                >
                  {pastingText && <Loader2 size={14} className="animate-spin" />}
                  Add text
                </button>
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
              <span className="mt-1 block text-[12px] text-ink-subtle">
                {instructions.length} / 2000 characters
              </span>
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
                <button
                  onClick={() => setAddingRule(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
                >
                  <Plus size={14} />
                  Add Rule
                </button>
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
                <span className="text-[12px] text-ink-subtle">{greeting.length} characters</span>
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

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {DELAY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setDelay(opt.value); setUseCustomDelay(false) }}
                      className={cn(
                        'rounded-xl border px-3 py-3 text-left transition',
                        !useCustomDelay && delay === opt.value
                          ? 'border-brand bg-brand/5 ring-1 ring-brand'
                          : 'border-border hover:border-brand/40'
                      )}
                    >
                      <p className={cn(
                        'text-[13px] font-semibold',
                        !useCustomDelay && delay === opt.value ? 'text-brand' : 'text-ink'
                      )}>
                        {opt.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{opt.desc}</p>
                    </button>
                  ))}
                  <button
                    onClick={() => setUseCustomDelay(true)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left transition',
                      useCustomDelay
                        ? 'border-brand bg-brand/5 ring-1 ring-brand'
                        : 'border-border hover:border-brand/40'
                    )}
                  >
                    <p className={cn('text-[13px] font-semibold', useCustomDelay ? 'text-brand' : 'text-ink')}>Custom</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">Set your own</p>
                  </button>
                </div>

                {useCustomDelay && (
                  <div className="mt-4 flex items-center gap-3">
                    <div>
                      <label className="text-[12px] font-medium text-ink-muted">Minutes</label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={customDelayMin}
                        onChange={(e) => setCustomDelayMin(Number(e.target.value))}
                        className="mt-1 block w-20 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-ink-muted">Seconds</label>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={customDelaySec}
                        onChange={(e) => setCustomDelaySec(Number(e.target.value))}
                        className="mt-1 block w-20 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <p className="mt-5 text-[12px] text-ink-subtle">
                      = {customDelayMin * 60 + customDelaySec}s total
                    </p>
                  </div>
                )}
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

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AFTER_HOURS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setAfterHoursDelay(opt.value); setUseCustomAfter(false) }}
                      className={cn(
                        'rounded-xl border px-3 py-3 text-left transition',
                        !useCustomAfter && afterHoursDelay === opt.value
                          ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                          : 'border-border hover:border-purple-300'
                      )}
                    >
                      <p className={cn(
                        'text-[13px] font-semibold',
                        !useCustomAfter && afterHoursDelay === opt.value ? 'text-purple-700' : 'text-ink'
                      )}>
                        {opt.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">{opt.desc}</p>
                    </button>
                  ))}
                  <button
                    onClick={() => setUseCustomAfter(true)}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left transition',
                      useCustomAfter
                        ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                        : 'border-border hover:border-purple-300'
                    )}
                  >
                    <p className={cn('text-[13px] font-semibold', useCustomAfter ? 'text-purple-700' : 'text-ink')}>Custom</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-ink-muted">Set your own</p>
                  </button>
                </div>

                {useCustomAfter && (
                  <div className="mt-4 flex items-center gap-3">
                    <div>
                      <label className="text-[12px] font-medium text-ink-muted">Minutes</label>
                      <input
                        type="number"
                        min={0}
                        max={60}
                        value={customAfterMin}
                        onChange={(e) => setCustomAfterMin(Number(e.target.value))}
                        className="mt-1 block w-20 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[12px] font-medium text-ink-muted">Seconds</label>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        value={customAfterSec}
                        onChange={(e) => setCustomAfterSec(Number(e.target.value))}
                        className="mt-1 block w-20 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <p className="mt-5 text-[12px] text-ink-subtle">
                      = {customAfterMin * 60 + customAfterSec}s total
                    </p>
                  </div>
                )}
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
        </div>
      </div>

      {/* ── Fixed save button (mobile) ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 p-4 backdrop-blur sm:hidden">
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[14px] font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>
    </div>
  )
}
