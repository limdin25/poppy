// The brain: a bounded Claude tool-use loop. ONE slice runs per heartbeat tick
// (the app is serverless, so "the heartbeat is the loop" — each tick advances a
// little, persists, and yields). Plain raw fetch to the Messages API, matching
// the style of api/lib/llm.ts, with a tools array and a stop_reason loop added.

const ANTHROPIC_VERSION = '2023-06-01'

export type Role = 'user' | 'assistant'
export interface AMessage { role: Role; content: unknown }
export interface ToolDef { name: string; description: string; input_schema: unknown }

export interface LoopResult {
  messages: AMessage[]
  stopReason: string
  steps: number
  hitCap: boolean
  madeToolCalls: boolean
}

interface RunOpts {
  apiKey: string
  model: string
  system: string
  messages: AMessage[]
  tools: ToolDef[]
  maxSteps: number
  maxTokens?: number
  execTool: (name: string, args: Record<string, unknown>) => Promise<{ result: unknown; summary: string }>
  onEvent: (e: { role: 'assistant' | 'tool'; kind: string; content: unknown; summary: string }) => Promise<void>
}

interface Block { type: string; [k: string]: unknown }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Block[]).filter((b) => b?.type === 'text').map((b) => String(b.text || '')).join(' ').trim()
  }
  return ''
}

export async function runAgentLoop(opts: RunOpts): Promise<LoopResult> {
  const { apiKey, model, system, tools, execTool, onEvent } = opts
  const messages: AMessage[] = [...opts.messages]
  const maxTokens = opts.maxTokens ?? 1500
  let steps = 0
  let madeToolCalls = false
  let stopReason = 'end_turn'

  while (steps < opts.maxSteps) {
    steps++
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools }),
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Anthropic error ${res.status}: ${errText.slice(0, 300)}`)
    }
    const data = (await res.json()) as { content?: Block[]; stop_reason?: string }
    const content = data.content ?? []
    stopReason = data.stop_reason ?? 'end_turn'

    const toolUses = content.filter((b) => b?.type === 'tool_use')
    const assistantText = textOf(content)
    const assistantSummary = toolUses.length
      ? `${assistantText ? assistantText + ' ' : ''}→ ${toolUses.map((t) => String(t.name)).join(', ')}`
      : assistantText || '(thinking)'
    await onEvent({ role: 'assistant', kind: toolUses.length ? 'tool_use' : 'message', content, summary: assistantSummary })
    messages.push({ role: 'assistant', content })

    if (stopReason !== 'tool_use' || toolUses.length === 0) break

    madeToolCalls = true
    const toolResults: Block[] = []
    for (const tu of toolUses) {
      let result: unknown
      let summary: string
      try {
        const out = await execTool(String(tu.name), (tu.input as Record<string, unknown>) || {})
        result = out.result
        summary = out.summary
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'tool failed'
        result = { error: msg }
        summary = `⚠️ ${String(tu.name)} failed: ${msg}`
      }
      const block: Block = { type: 'tool_result', tool_use_id: String(tu.id), content: JSON.stringify(result).slice(0, 12000) }
      toolResults.push(block)
      await onEvent({ role: 'tool', kind: 'tool_result', content: [block], summary })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  const hitCap = steps >= opts.maxSteps && stopReason === 'tool_use'
  return { messages, stopReason, steps, hitCap, madeToolCalls }
}
