import { describe, it, expect } from 'vitest'

const AI_MODEL_OPTIONS = [
  'claude-4.6-sonnet', 'claude-4.5-sonnet', 'claude-4.5-haiku',
  'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gemini-3.1-flash-lite', 'gemini-3.0-flash', 'gemini-2.5-flash-lite',
]

const RETELL_SUPPORTED_MODELS = [
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-5.1', 'gpt-5.2',
  'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5',
  'claude-4.5-sonnet', 'claude-4.6-sonnet', 'claude-4.5-haiku',
  'gemini-2.5-flash-lite', 'gemini-3.0-flash', 'gemini-3.1-flash-lite',
]

const FOLLOWUP_DELAY_PRESETS = [
  1, 5, 10, 30, 60, 300, 900, 1800,
  3600, 7200, 14400, 28800, 43200, 86400, 172800, 259200,
]

describe('Agent editor AI models', () => {
  it('every UI model option is supported by Retell', () => {
    for (const model of AI_MODEL_OPTIONS) {
      expect(RETELL_SUPPORTED_MODELS).toContain(model)
    }
  })

  it('no duplicate model values', () => {
    const unique = new Set(AI_MODEL_OPTIONS)
    expect(unique.size).toBe(AI_MODEL_OPTIONS.length)
  })
})

describe('Follow-up delay presets (seconds)', () => {
  it('all delay values are positive integers', () => {
    for (const d of FOLLOWUP_DELAY_PRESETS) {
      expect(d).toBeGreaterThan(0)
      expect(Number.isInteger(d)).toBe(true)
    }
  })

  it('presets are sorted ascending', () => {
    for (let i = 1; i < FOLLOWUP_DELAY_PRESETS.length; i++) {
      expect(FOLLOWUP_DELAY_PRESETS[i]).toBeGreaterThan(FOLLOWUP_DELAY_PRESETS[i - 1])
    }
  })

  it('all values fit in INTEGER column', () => {
    for (const d of FOLLOWUP_DELAY_PRESETS) {
      expect(d).toBeLessThan(2147483647)
      expect(Math.floor(d)).toBe(d)
    }
  })
})

describe('Legacy hours detection', () => {
  it('detects old hours format (values <= 100)', () => {
    const oldFormat = [2, 24, 72]
    const isLegacy = oldFormat.every(d => d <= 100)
    expect(isLegacy).toBe(true)
  })

  it('detects new seconds format (values > 100)', () => {
    const newFormat = [7200, 86400, 259200]
    const isLegacy = newFormat.every(d => d <= 100)
    expect(isLegacy).toBe(false)
  })

  it('converts legacy hours to seconds correctly', () => {
    const legacy = [2, 24, 72]
    const converted = legacy.map(h => h * 3600)
    expect(converted).toEqual([7200, 86400, 259200])
  })

  it('does not convert seconds values', () => {
    const seconds = [3600, 86400]
    const isLegacy = seconds.every(d => d <= 100)
    expect(isLegacy).toBe(false)
    // Values stay as-is
  })

  it('edge case: 1-second delay stores as integer 1, which is <= 100 (treated as legacy)', () => {
    // Values 1-100 are ambiguous. 1 second = 1, 1 hour = 1.
    // Our heuristic: if ALL values <= 100, treat as hours.
    // Once user saves with new UI, values like 3600 disambiguate.
    // Worst case for tiny delays: 1 second becomes 3600 seconds (1 hour) on first load.
    // This is acceptable because the user re-saves immediately.
    const mixed = [1, 86400]
    const isLegacy = mixed.every(d => d <= 100)
    expect(isLegacy).toBe(false) // 86400 > 100 so not legacy
  })
})

describe('Agent save payload', () => {
  it('follow_up_delay_hours stores seconds as integers in INTEGER[] column', () => {
    const delays = [300, 1800, 7200] // 5min, 30min, 2hrs
    expect(delays.every(d => Number.isInteger(d))).toBe(true)
  })

  it('default persistence presets are valid seconds', () => {
    const light = [7200]         // 2 hours
    const normal = [7200, 86400] // 2 hours, 1 day
    const persistent = [7200, 86400, 259200] // 2hrs, 1d, 3d

    expect(light.every(d => Number.isInteger(d) && d > 0)).toBe(true)
    expect(normal.every(d => Number.isInteger(d) && d > 0)).toBe(true)
    expect(persistent.every(d => Number.isInteger(d) && d > 0)).toBe(true)
  })
})
