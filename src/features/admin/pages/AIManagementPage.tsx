import { useState, useEffect } from 'react'
import { Bot, ChevronDown, ChevronUp, Key, Save, Eye, EyeOff } from 'lucide-react'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface BusinessPrompt {
  id: string
  name: string
  ai_system_prompt: string | null
  greeting: string | null
  tone: string | null
}

interface AISettings {
  ai_model: string
  ai_provider: string
  anthropic_key_display: string
  openai_api_key: string
  grok_api_key: string
}

const MODELS_2026 = [
  { group: 'Anthropic (Claude)', models: [
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ]},
  { group: 'OpenAI', models: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  ]},
  { group: 'xAI (Grok)', models: [
    { id: 'grok-4.3', label: 'Grok 4.3' },
    { id: 'grok-4.20', label: 'Grok 4.20' },
    { id: 'grok-4.1-fast', label: 'Grok 4.1 Fast' },
  ]},
]

function getProviderFromModel(modelId: string): string {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('grok')) return 'xai'
  return 'anthropic'
}

export default function AIManagementPage() {
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data: prompts, error: promptsError } = useAdminApi<BusinessPrompt[]>('ai/prompts', [])
  const { data: settings, loading: settingsLoading, error: settingsError, refetch } = useAdminApi<AISettings>('ai/settings', {
    ai_model: 'claude-sonnet-4-6',
    ai_provider: 'anthropic',
    anthropic_key_display: '',
    openai_api_key: '',
    grok_api_key: '',
  })

  const saveSettings = useAdminMutation('ai/settings', 'PUT')

  const [model, setModel] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [grokKey, setGrokKey] = useState('')
  const [showOpenai, setShowOpenai] = useState(false)
  const [showGrok, setShowGrok] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!settingsLoading) {
      setModel(settings.ai_model)
      setOpenaiKey(settings.openai_api_key)
      setGrokKey(settings.grok_api_key)
    }
  }, [settingsLoading, settings.ai_model, settings.openai_api_key, settings.grok_api_key])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await saveSettings({
        ai_model: model,
        ai_provider: getProviderFromModel(model),
        openai_api_key: openaiKey,
        grok_api_key: grokKey,
      })
      setSaved(true)
      refetch()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // error handled by mutation
    } finally {
      setSaving(false)
    }
  }

  const error = promptsError || settingsError

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">AI Management</h1>
      {error && <AdminError error={error} />}
      <p className="mt-1 text-[13px] text-ink-muted">Configure AI providers, API keys, and review system prompts</p>

      {/* AI Configuration */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          <Key size={16} />
          AI Configuration
        </h2>

        {/* Model Selection */}
        <div className="mt-4">
          <label className="block text-[12px] font-medium text-ink-muted">Active Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 h-9 w-full max-w-sm rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            {MODELS_2026.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* API Keys */}
        <div className="mt-5 space-y-4">
          {/* Claude / Anthropic */}
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Anthropic (Claude) API Key</label>
            <div className="mt-1 flex h-9 w-full max-w-lg items-center rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink-muted">
              {settings.anthropic_key_display || 'Not set'}
              <span className="ml-auto text-[11px] text-ink-subtle">Set via env var</span>
            </div>
          </div>

          {/* OpenAI */}
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">OpenAI API Key</label>
            <div className="mt-1 flex max-w-lg gap-2">
              <div className="relative flex-1">
                <input
                  type={showOpenai ? 'text' : 'password'}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-9 w-full rounded-lg border border-border bg-elevated px-3 pr-9 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <button
                  type="button"
                  onClick={() => setShowOpenai(!showOpenai)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                >
                  {showOpenai ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>

          {/* Grok / xAI */}
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Grok (xAI) API Key</label>
            <div className="mt-1 flex max-w-lg gap-2">
              <div className="relative flex-1">
                <input
                  type={showGrok ? 'text' : 'password'}
                  value={grokKey}
                  onChange={(e) => setGrokKey(e.target.value)}
                  placeholder="xai-..."
                  className="h-9 w-full rounded-lg border border-border bg-elevated px-3 pr-9 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
                <button
                  type="button"
                  onClick={() => setShowGrok(!showGrok)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
                >
                  {showGrok ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {saved && <span className="text-[13px] text-emerald-600">Saved</span>}
        </div>
      </div>

      {/* System Prompts */}
      <h2 className="mt-8 flex items-center gap-2 text-[14px] font-semibold text-ink">
        <Bot size={16} />
        System Prompts by Business
      </h2>
      <div className="mt-3 space-y-2">
        {prompts.map((p) => (
          <div key={p.id} className="rounded-xl border border-border">
            <button
              onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">{p.name}</p>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ink-muted">
                  <span>Tone: {p.tone || '—'}</span>
                  <span>{p.ai_system_prompt ? 'Prompt set' : 'No prompt'}</span>
                </div>
              </div>
              {expanded === p.id ? (
                <ChevronUp size={14} className="text-ink-subtle" />
              ) : (
                <ChevronDown size={14} className="text-ink-subtle" />
              )}
            </button>
            {expanded === p.id && (
              <div className="border-t border-border px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Greeting</p>
                <p className="mt-1 rounded-lg bg-elevated p-3 text-[13px] leading-relaxed text-ink-muted">
                  {p.greeting || 'No greeting set'}
                </p>
                {p.ai_system_prompt && (
                  <>
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">System Prompt</p>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-elevated p-3 text-[12px] leading-relaxed text-ink-muted">
                      {p.ai_system_prompt.slice(0, 500)}{p.ai_system_prompt.length > 500 ? '...' : ''}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {prompts.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ink-muted">No businesses found</p>
        )}
      </div>
    </div>
  )
}
