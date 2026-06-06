/**
 * Pure per-agent (per phone-number / per A-B-variant) metric aggregation.
 * Shared by the analytics API endpoint and the UI so the maths is tested once.
 *
 * A "booking" is an appointment whose conversation was handled by that agent
 * (appointments have no agent_id of their own — it comes via the conversation).
 */
export interface AgentMeta {
  agentId: string
  label: string
}

export interface CallRow {
  agent_id: string | null
  duration_seconds: number | null
}

export interface ApptAgentRow {
  agent_id: string | null
}

export interface AgentMetrics {
  agentId: string
  label: string
  calls: number
  bookings: number
  /** Average call length in seconds ("hold time"). */
  avgDurationSec: number
  /** Bookings ÷ calls, as a whole percentage. */
  conversionPct: number
}

export function aggregateByAgent(
  agents: AgentMeta[],
  calls: CallRow[],
  appts: ApptAgentRow[],
): AgentMetrics[] {
  return agents.map((a) => {
    const myCalls = calls.filter((c) => c.agent_id === a.agentId)
    const callCount = myCalls.length
    const totalDur = myCalls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0)
    const bookings = appts.filter((p) => p.agent_id === a.agentId).length
    return {
      agentId: a.agentId,
      label: a.label,
      calls: callCount,
      bookings,
      avgDurationSec: callCount ? Math.round(totalDur / callCount) : 0,
      conversionPct: callCount ? Math.round((bookings / callCount) * 100) : 0,
    }
  })
}
