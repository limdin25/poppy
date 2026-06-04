import { useEffect, useState } from 'react'
import {
  CalendarCheck, Loader2, Bot, Plus, X, Sparkles, Check,
  Trash2, ChevronDown, ChevronUp, LayoutTemplate,
} from 'lucide-react'
import { SectionCard } from '@/core/ui/SectionCard'
import { Input, Textarea, Label } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { Switch } from '@/core/ui/Switch'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'
import { useDefaultAgent } from '../hooks/useDefaultAgent'
import { stripClassificationBlock, CLASSIFICATION_START, CLASSIFICATION_END } from './ClassificationPage'
import { AGENT_TEMPLATES, DEFAULT_SYSTEM_PROMPT } from './agentTemplates'

/**
 * AI Personality (waslo-faithful layout, Elsie voice). Renders only the right-
 * column settings content — the page shell lives in AgentLayout.
 *
 * Wired to the business's default WhatsApp agent.
 *
 * - EASY mode: simple guided fields (assistant name, tone, services,
 *   available days/hours) + the FAQs editor — a fast path for non-technical
 *   owners.
 * - ADVANCED mode: a business-type Template picker, the full "AI Personality"
 *   System Prompt (ai_system_prompt), a "Welcome Message" toggle + template
 *   (greeting), plus behaviour toggles and language.
 *
 * Save persists ai_system_prompt (System Prompt, with the Classification block
 * preserved) + greeting (Welcome template) + tone/language/behaviour/hours to
 * the agents table, and replaces the services + faqs rows.
 */

type Mode = 'easy' | 'advanced'

interface FAQItem {
  id: string
  question: string
  answer: string
}

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
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

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i.toString().padStart(2, '0')}:00` }))

const savedBtn =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60'

/**
 * Read-only view of the COMPLETE prompt the platform sends to the voice engine —
 * fetched live from /api/agent/sync-prompt in preview mode (no push to Retell).
 * This is the full assembled prompt (greeting + services + FAQs + behaviour +
 * tools + custom instructions), not just the System Prompt field above.
 */
function FullPromptPreview({ agentId }: { agentId?: string }) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [tools, setTools] = useState<string[]>([])
  const [model, setModel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!session) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/agent/sync-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ preview: true, agentId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not load the prompt.'); return }
      setPrompt(data.prompt || ''); setTools(data.tools || []); setModel(data.model || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the prompt.')
    } finally { setLoading(false) }
  }

  function toggle() {
    const next = !open; setOpen(next)
    if (next && prompt === null) void load()
  }

  return (
    <SectionCard eyebrow="Advanced" title="The full prompt Elsie actually uses">
      <p className="text-[13px] text-ink-muted">
        This is the exact, complete prompt your platform sends to the voice engine — assembled live from your
        greeting, services, FAQs, behaviour rules, the actions Elsie can take, and the System Prompt above.
        Read-only: change it by editing the fields on this page (editing it inside Retell gets overwritten).
      </p>
      <button
        onClick={toggle}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {open ? 'Hide full prompt' : 'View full prompt'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</div>}
          {(tools.length > 0 || model) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {model && <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-ink-muted">model: {model}</span>}
              {tools.length > 0 && <span className="text-[11.5px] font-medium text-ink-subtle">· actions:</span>}
              {tools.map((t) => (
                <span key={t} className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-ink-muted">{t}</span>
              ))}
            </div>
          )}
          {prompt !== null && (
            <pre className="max-h-[460px] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-page/60 p-4 font-mono text-[12px] leading-relaxed text-ink">{prompt}</pre>
          )}
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-muted transition hover:text-ink">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Refresh
          </button>
        </div>
      )}
    </SectionCard>
  )
}

export default function AiPersonalityPage() {
  const { agent, businessId, loading, reload } = useDefaultAgent()
  const { session } = useAuth()
  const agentId = agent?.id

  const [mode, setMode] = useState<Mode>('easy')

  // ── Agent fields ──
  const [name, setName] = useState('')
  const [greeting, setGreeting] = useState('')
  const [tone, setTone] = useState('professional')
  const [instructions, setInstructions] = useState('') // bound to ai_system_prompt (System Prompt)
  const [language, setLanguage] = useState('en-GB')
  const [autoReply, setAutoReply] = useState(true)
  const [draftMode, setDraftMode] = useState(false)
  const [confirmEnabled, setConfirmEnabled] = useState(true)
  const [workStart, setWorkStart] = useState(8)
  const [workEnd, setWorkEnd] = useState(18)
  const [workDays, setWorkDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  // Easy-setup business fields (persisted to agents.location / instructions / cancellation_policy)
  const [location, setLocation] = useState('')
  const [preInstructions, setPreInstructions] = useState('')
  const [cancellation, setCancellation] = useState('')

  // ── Advanced: template picker + welcome toggle ──
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [welcomeEnabled, setWelcomeEnabled] = useState(true)

  // ── Services ──
  const [services, setServices] = useState<string[]>([])
  const [newService, setNewService] = useState('')

  // ── FAQs ──
  const [faqs, setFaqs] = useState<FAQItem[]>([])
  const [newFaqQ, setNewFaqQ] = useState('')
  const [newFaqA, setNewFaqA] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null)

  // ── Save / refine state ──
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)

  // ── Load agent fields ──
  useEffect(() => {
    if (!agent) return
    setName(agent.name || '')
    setGreeting(agent.greeting || '')
    setWelcomeEnabled(Boolean(agent.greeting && agent.greeting.trim()))
    setTone(agent.tone || 'professional')
    // Strip the Classification block — that slice is owned by ClassificationPage.
    // Seed an original default System Prompt if the agent has none yet.
    setInstructions(stripClassificationBlock(agent.ai_system_prompt) || DEFAULT_SYSTEM_PROMPT)
    setLanguage(agent.language || 'en-GB')
    setAutoReply(agent.auto_reply_enabled ?? true)
    setDraftMode(agent.draft_mode ?? false)
    setConfirmEnabled(agent.confirmation_enabled ?? true)
    setWorkStart(agent.working_hours_start ?? 8)
    setWorkEnd(agent.working_hours_end ?? 18)
    setWorkDays(agent.working_days?.length ? agent.working_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    setLocation(agent.location || '')
    setPreInstructions(agent.instructions || '')
    setCancellation(agent.cancellation_policy || '')
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
        if (data) setServices((data as { name: string }[]).map((s) => s.name))
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

  function toggleDay(day: string) {
    setWorkDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))
  }

  function addService() {
    const v = newService.trim()
    if (!v) return
    setServices((prev) => [...prev, v])
    setNewService('')
  }

  function addFaq() {
    if (!newFaqQ.trim() || !newFaqA.trim()) return
    setFaqs((prev) => [...prev, { id: `new-${Date.now()}`, question: newFaqQ.trim(), answer: newFaqA.trim() }])
    setNewFaqQ('')
    setNewFaqA('')
  }

  // Pre-fill the System Prompt + Welcome template from a business-type preset.
  function applyTemplate(id: string) {
    const tpl = AGENT_TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    setSelectedTemplate(id)
    setInstructions(tpl.systemPrompt)
    setGreeting(tpl.welcome)
    setWelcomeEnabled(true)
  }

  async function refineGreeting() {
    if (!greeting.trim() || refining || !session) return
    setRefining(true)
    try {
      const res = await fetch('/api/agent/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ text: greeting, type: 'greeting', tone, agentId, businessId }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.refined) setGreeting(data.refined)
      }
    } catch { /* silent */ }
    setRefining(false)
  }

  async function handleSave() {
    if (!businessId || !agentId) return
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      // Preserve the Classification block (owned by ClassificationPage) when
      // writing ai_system_prompt, so the two pages don't clobber each other.
      const raw = agent?.ai_system_prompt ?? ''
      const cStart = raw.indexOf(CLASSIFICATION_START)
      const cEnd = raw.indexOf(CLASSIFICATION_END)
      const classificationBlock =
        cStart !== -1 && cEnd !== -1 && cEnd > cStart
          ? raw.slice(cStart, cEnd + CLASSIFICATION_END.length)
          : ''
      const base = instructions.trim()
      const mergedPrompt = [base, classificationBlock].filter(Boolean).join('\n\n') || null

      // Welcome message: only persist the template when the toggle is on,
      // otherwise clear it so no welcome is sent.
      const greetingToSave = welcomeEnabled && greeting.trim() ? greeting.trim() : null

      const { error: agentErr } = await supabase
        .from('agents')
        .update({
          name,
          greeting: greetingToSave,
          tone,
          ai_system_prompt: mergedPrompt,
          language,
          auto_reply_enabled: autoReply,
          draft_mode: draftMode,
          confirmation_enabled: confirmEnabled,
          working_hours_start: workStart,
          working_hours_end: workEnd,
          working_days: workDays,
          location: location.trim() || null,
          instructions: preInstructions.trim() || null,
          cancellation_policy: cancellation.trim() || null,
        })
        .eq('id', agentId)
        .eq('business_id', businessId)
      if (agentErr) throw agentErr

      // Replace services
      await supabase.from('services').delete().eq('agent_id', agentId).eq('business_id', businessId)
      if (services.length > 0) {
        await supabase.from('services').insert(
          services.map((svcName, i) => ({ business_id: businessId, agent_id: agentId, name: svcName, sort_order: i })),
        )
      }

      // Replace FAQs
      await supabase.from('faqs').delete().eq('agent_id', agentId).eq('business_id', businessId)
      if (faqs.length > 0) {
        await supabase.from('faqs').insert(
          faqs.map((f, i) => ({ business_id: businessId, agent_id: agentId, question: f.question, answer: f.answer, sort_order: i })),
        )
      }

      // Keep channels assigned to this agent in sync (auto-reply / draft mode)
      await supabase
        .from('channels')
        .update({ auto_reply_enabled: autoReply, draft_mode: draftMode })
        .eq('agent_id', agentId)
        .eq('business_id', businessId)

      reload()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError('Failed to save changes. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={22} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  if (!agent) return <NoAgentEmptyState />

  return (
    <div className="space-y-6">
      {/* Easy / Advanced segmented toggle */}
      <div className="inline-flex rounded-xl border border-border bg-elevated/50 p-1">
        {(['easy', 'advanced'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-[13px] font-medium capitalize transition',
              mode === m ? 'bg-accent text-white shadow-soft' : 'text-ink-muted hover:text-ink',
            )}
          >
            {m === 'easy' ? 'Easy Setup' : 'Advanced'}
          </button>
        ))}
      </div>

      {/* Appointment Booking row */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-elevated text-ink">
            <CalendarCheck size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">Appointment Booking</p>
            <p className="text-[12px] text-ink-muted">
              Elsie books straight into your connected calendar.
            </p>
          </div>
        </div>
        <a
          href="/connections"
          className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink transition hover:bg-elevated"
        >
          Change
        </a>
      </div>

      {/* ── EASY ── simple guided fields for non-technical owners */}
      {mode === 'easy' && (
        <SectionCard eyebrow="Setup" title="What Elsie needs to answer accurately">
          <div className="space-y-4">
            <div>
              <Label htmlFor="agent-name">Assistant name</Label>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Elsie"
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">How Elsie introduces herself.</p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label htmlFor="greeting" className="mb-0">Welcome message</Label>
                <button
                  type="button"
                  onClick={refineGreeting}
                  disabled={refining || !greeting.trim()}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-accent transition hover:opacity-80 disabled:opacity-40"
                >
                  {refining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Refine with AI
                </button>
              </div>
              <Textarea
                id="greeting"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={3}
                placeholder="The first thing Elsie says when a new conversation starts."
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">Shown at the start of every new conversation.</p>
            </div>

            <div>
              <Label htmlFor="tone">Tone of voice</Label>
              <Select id="tone" value={tone} onChange={(e) => setTone(e.target.value)} className="sm:w-56">
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>

            {/* Services list */}
            <ServicesEditor
              services={services}
              setServices={setServices}
              newService={newService}
              setNewService={setNewService}
              addService={addService}
            />

            {/* Availability */}
            <div>
              <Label>Available days</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition',
                      workDays.includes(day)
                        ? 'border-accent bg-accent text-white'
                        : 'border-border text-ink-muted hover:bg-elevated',
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
              <div>
                <Label htmlFor="work-start">Opens</Label>
                <Select id="work-start" value={workStart} onChange={(e) => setWorkStart(Number(e.target.value))}>
                  {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="work-end">Closes</Label>
                <Select id="work-end" value={workEnd} onChange={(e) => setWorkEnd(Number(e.target.value))}>
                  {HOURS.map((h) => <option key={h.value} value={h.value}>{h.label}</option>)}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="location">Location / address</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. 123 High Street, London — or 'Online via Zoom'"
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">Where you're based, so Elsie can answer “where are you?”.</p>
            </div>

            <div>
              <Label htmlFor="pre-instructions">Pre-appointment instructions</Label>
              <Textarea
                id="pre-instructions"
                value={preInstructions}
                onChange={(e) => setPreInstructions(e.target.value)}
                rows={2}
                placeholder="e.g. Arrive 10 minutes early and bring your ID."
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">Shared with customers when they book.</p>
            </div>

            <div>
              <Label htmlFor="cancellation">Cancellation policy</Label>
              <Textarea
                id="cancellation"
                value={cancellation}
                onChange={(e) => setCancellation(e.target.value)}
                rows={2}
                placeholder="e.g. Free cancellation up to 24 hours before your appointment."
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">Elsie quotes this when customers ask about changes or refunds.</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ── ADVANCED ── */}
      {mode === 'advanced' && (
        <>
          {/* 1) Start from a Template */}
          <SectionCard eyebrow="Advanced" title="Start from a Template">
            <div className="mb-4 flex items-center gap-2 text-[12px] text-ink-muted">
              <LayoutTemplate size={14} className="shrink-0" />
              Pick a business type to pre-fill the System Prompt and Welcome message — then tweak.
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AGENT_TEMPLATES.map((tpl) => {
                const selected = selectedTemplate === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl.id)}
                    className={cn(
                      'relative rounded-xl border bg-surface p-4 text-left transition',
                      selected ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-ink-subtle/50',
                    )}
                  >
                    {selected && (
                      <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                        <Check size={12} />
                      </span>
                    )}
                    <p className="pr-6 text-[13.5px] font-semibold text-ink">{tpl.label}</p>
                    <p className="mt-1 text-[12px] leading-snug text-ink-muted">{tpl.description}</p>
                  </button>
                )
              })}
            </div>
          </SectionCard>

          {/* 2) AI Personality — System Prompt */}
          <SectionCard eyebrow="Advanced" title="AI Personality">
            <Label htmlFor="instructions">System Prompt</Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={9}
              placeholder="Describe how Elsie should answer, what she knows, and how she should behave."
            />
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              This defines how Elsie answers. Be specific about your services, hours and tone.
            </p>
          </SectionCard>

          {/* 2b) The full assembled prompt (read-only preview) */}
          <FullPromptPreview agentId={agentId} />

          {/* 3) Welcome Message */}
          <SectionCard eyebrow="Advanced" title="Welcome Message">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink">Enable welcome message</p>
                <p className="text-[12.5px] text-ink-muted">
                  Send an opening message when a new conversation starts.
                </p>
              </div>
              <Switch checked={welcomeEnabled} onChange={setWelcomeEnabled} label="Enable welcome message" />
            </div>

            <div className={cn('mt-4', !welcomeEnabled && 'pointer-events-none opacity-50')}>
              <div className="mb-1.5 flex items-center justify-between">
                <Label htmlFor="welcome-template" className="mb-0">Welcome template</Label>
                <button
                  type="button"
                  onClick={refineGreeting}
                  disabled={refining || !greeting.trim() || !welcomeEnabled}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-accent transition hover:opacity-80 disabled:opacity-40"
                >
                  {refining ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  Refine with AI
                </button>
              </div>
              <Textarea
                id="welcome-template"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={3}
                disabled={!welcomeEnabled}
                placeholder="Hi {{first_name}}, thanks for getting in touch. How can I help?"
              />
              <p className="mt-1.5 text-[11px] text-ink-subtle">
                Variables you can use: <code className="text-ink-muted">{'{{name}}'}</code>,{' '}
                <code className="text-ink-muted">{'{{first_name}}'}</code>,{' '}
                <code className="text-ink-muted">{'{{phone}}'}</code>
              </p>
            </div>
          </SectionCard>

          {/* Services (also available in Advanced) */}
          <SectionCard eyebrow="Advanced" title="Services">
            <ServicesEditor
              services={services}
              setServices={setServices}
              newService={newService}
              setNewService={setNewService}
              addService={addService}
            />
          </SectionCard>

          <SectionCard eyebrow="Advanced" title="Behaviour">
            <div className="divide-y divide-border">
              <ToggleRow
                title="Auto-reply"
                desc="Elsie replies to customers automatically."
                checked={autoReply}
                onChange={setAutoReply}
              />
              <ToggleRow
                title="Approve before sending"
                desc="Elsie drafts a reply and waits for you to approve it."
                checked={draftMode}
                onChange={setDraftMode}
              />
              <ToggleRow
                title="Confirm before booking"
                desc="Elsie double-checks the details before booking an appointment."
                checked={confirmEnabled}
                onChange={setConfirmEnabled}
              />
            </div>
          </SectionCard>

          <SectionCard eyebrow="Advanced" title="Language">
            <Label htmlFor="language">Reply language</Label>
            <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} className="sm:w-56">
              {LANGUAGE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </Select>
          </SectionCard>

          {/* FAQs editor */}
          <SectionCard eyebrow="Advanced" title="FAQs">
            <div className="space-y-3">
              {faqs.map((f) => {
                const open = expandedFaq === f.id
                return (
                  <div key={f.id} className="rounded-xl border border-border bg-elevated/40">
                    <button
                      type="button"
                      onClick={() => setExpandedFaq(open ? null : f.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{f.question}</span>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setFaqs((prev) => prev.filter((x) => x.id !== f.id)) }}
                          className="rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove FAQ"
                        >
                          <Trash2 size={13} />
                        </button>
                        {open ? <ChevronUp size={15} className="text-ink-subtle" /> : <ChevronDown size={15} className="text-ink-subtle" />}
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-2 px-4 pb-4">
                        <Input
                          value={f.question}
                          onChange={(e) => setFaqs((prev) => prev.map((x) => x.id === f.id ? { ...x, question: e.target.value } : x))}
                          placeholder="Question"
                          className="bg-surface text-[13px]"
                        />
                        <Textarea
                          value={f.answer}
                          onChange={(e) => setFaqs((prev) => prev.map((x) => x.id === f.id ? { ...x, answer: e.target.value } : x))}
                          rows={3}
                          placeholder="Answer"
                          className="bg-surface text-[13px]"
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="space-y-2 rounded-xl border border-dashed border-border p-4">
                <Input
                  value={newFaqQ}
                  onChange={(e) => setNewFaqQ(e.target.value)}
                  placeholder="New question — e.g. Do you bring your own products?"
                  className="text-[13px]"
                />
                <Textarea
                  value={newFaqA}
                  onChange={(e) => setNewFaqA(e.target.value)}
                  rows={2}
                  placeholder="Answer Elsie should give"
                  className="text-[13px]"
                />
                <button
                  type="button"
                  onClick={addFaq}
                  disabled={!newFaqQ.trim() || !newFaqA.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-elevated disabled:opacity-40"
                >
                  <Plus size={14} /> Add FAQ
                </button>
              </div>
            </div>
          </SectionCard>
        </>
      )}

      {saveError && <p className="text-[13px] text-danger">{saveError}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
            <Check size={14} /> Saved
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className={savedBtn}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Shared bits ───────────────────────────────────────────────────────

function ServicesEditor({
  services,
  setServices,
  newService,
  setNewService,
  addService,
}: {
  services: string[]
  setServices: React.Dispatch<React.SetStateAction<string[]>>
  newService: string
  setNewService: (v: string) => void
  addService: () => void
}) {
  return (
    <div>
      <Label>Services</Label>
      <div className="space-y-2">
        {services.map((svc, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-elevated/40 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{svc}</span>
            <button
              type="button"
              onClick={() => setServices((prev) => prev.filter((_, idx) => idx !== i))}
              className="rounded-md p-1 text-ink-subtle transition hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove ${svc}`}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            value={newService}
            onChange={(e) => setNewService(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addService() } }}
            placeholder="e.g. Deep clean — 4h — £95"
            className="text-[13px]"
          />
          <button
            type="button"
            onClick={addService}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-[13px] font-medium text-ink transition hover:bg-elevated"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-subtle">Elsie quotes from this when customers ask.</p>
    </div>
  )
}

function ToggleRow({ title, desc, checked, onChange }: {
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-ink">{title}</p>
        <p className="text-[12.5px] text-ink-muted">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

export function NoAgentEmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-14 text-center shadow-soft">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-ink-muted">
        <Bot size={22} />
      </span>
      <h3 className="text-[15px] font-semibold text-ink">Set up your AI agent</h3>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-muted">
        You don't have an AI agent yet. Connect WhatsApp and finish onboarding to create Elsie, then come back to fine-tune her here.
      </p>
      <a
        href="/connections"
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:opacity-90"
      >
        Connect WhatsApp
      </a>
    </div>
  )
}
