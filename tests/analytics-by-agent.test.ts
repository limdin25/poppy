import { describe, it, expect } from 'vitest'
import { aggregateByAgent } from '@/features/analytics/aggregateByAgent'

describe('aggregateByAgent (per-number / A-B metrics)', () => {
  const agents = [
    { agentId: 'a', label: '+1 (272) 347-1167' },
    { agentId: 'b', label: 'USA Sales — English (A/B)' },
  ]

  it('counts calls, bookings, avg hold time and conversion per agent', () => {
    const calls = [
      { agent_id: 'a', duration_seconds: 120 },
      { agent_id: 'a', duration_seconds: 60 },
      { agent_id: 'b', duration_seconds: 30 },
      { agent_id: null, duration_seconds: 999 }, // unattributed → ignored
    ]
    const appts = [{ agent_id: 'a' }, { agent_id: 'a' }, { agent_id: 'b' }]
    const out = aggregateByAgent(agents, calls, appts)
    const a = out.find((x) => x.agentId === 'a')!
    const b = out.find((x) => x.agentId === 'b')!
    expect(a.calls).toBe(2)
    expect(a.bookings).toBe(2)
    expect(a.avgDurationSec).toBe(90)
    expect(a.conversionPct).toBe(100)
    expect(b.calls).toBe(1)
    expect(b.bookings).toBe(1)
    expect(b.avgDurationSec).toBe(30)
    expect(b.conversionPct).toBe(100)
  })

  it('never divides by zero when an agent has no calls', () => {
    const out = aggregateByAgent([{ agentId: 'a', label: 'x' }], [], [])
    expect(out[0]).toMatchObject({ calls: 0, bookings: 0, avgDurationSec: 0, conversionPct: 0 })
  })

  it('rounds avg duration and conversion sensibly', () => {
    const calls = [
      { agent_id: 'a', duration_seconds: 10 },
      { agent_id: 'a', duration_seconds: 20 },
      { agent_id: 'a', duration_seconds: 30 },
    ]
    const out = aggregateByAgent([{ agentId: 'a', label: 'x' }], calls, [{ agent_id: 'a' }])
    expect(out[0].avgDurationSec).toBe(20)
    expect(out[0].conversionPct).toBe(33) // 1 of 3
  })
})
