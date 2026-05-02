import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp } from 'lucide-react'
import { useAdminApi } from '../hooks/useAdminApi'

interface BusinessPrompt {
  id: string
  name: string
  ai_system_prompt: string | null
  greeting: string | null
  tone: string | null
}

export default function AIManagementPage() {
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data: prompts } = useAdminApi<BusinessPrompt[]>('ai/prompts', [])

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">AI Management</h1>
      <p className="mt-1 text-[13px] text-ink-muted">Review and manage system prompts and quality</p>

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
