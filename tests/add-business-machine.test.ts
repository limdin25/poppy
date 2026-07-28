import { describe, it, expect } from 'vitest'
import {
  wizardReducer, canAdvance, stepIndex, initialWizard, STEPS, type WizardState,
} from '../src/features/reviews/add-business-machine'

const at = (over: Partial<WizardState>): WizardState => ({ ...initialWizard, ...over })

describe('add-business wizard machine', () => {
  it('starts on connect with nothing complete', () => {
    expect(initialWizard.step).toBe('connect')
    expect(canAdvance(initialWizard)).toBe(false)
  })

  it('cannot advance past connect until a grant + business exist', () => {
    expect(wizardReducer(initialWizard, { type: 'next' }).step).toBe('connect')
    const connected = wizardReducer(initialWizard, { type: 'connected', businessId: 'b1', locationName: 'Kev Plumbing' })
    expect(connected.step).toBe('select')
    expect(connected.connected).toBe(true)
    expect(connected.businessId).toBe('b1')
  })

  it('OAuth failure returns to connect with an error', () => {
    const s = wizardReducer(at({ step: 'select', connected: true, businessId: 'b1' }), { type: 'oauthFailed', error: 'cancelled' })
    expect(s.step).toBe('connect')
    expect(s.connected).toBe(false)
    expect(s.error).toBe('cancelled')
  })

  it('select requires ≥1 connected location, then advances to plan', () => {
    const connected = at({ step: 'select', connected: true, businessId: 'b1', locationName: 'X' })
    expect(canAdvance(connected)).toBe(true)
    expect(wizardReducer(connected, { type: 'next' }).step).toBe('plan')
  })

  it('plan requires a selection before confirm', () => {
    const onPlan = at({ step: 'plan', connected: true, businessId: 'b1' })
    expect(canAdvance(onPlan)).toBe(false)
    expect(wizardReducer(onPlan, { type: 'next' }).step).toBe('plan') // blocked
    const picked = wizardReducer(onPlan, { type: 'selectPlan', plan: 'reviews_starter' })
    expect(picked.plan).toBe('reviews_starter')
    expect(canAdvance(picked)).toBe(true)
    expect(wizardReducer(picked, { type: 'next' }).step).toBe('confirm')
  })

  it('back moves exactly one step and never below connect', () => {
    expect(wizardReducer(at({ step: 'confirm' }), { type: 'back' }).step).toBe('plan')
    expect(wizardReducer(at({ step: 'connect' }), { type: 'back' }).step).toBe('connect')
  })

  it('error action keeps the step but records the message (retry on confirm)', () => {
    const s = wizardReducer(at({ step: 'confirm', connected: true, businessId: 'b1', plan: 'reviews_starter' }), { type: 'error', error: 'create failed' })
    expect(s.step).toBe('confirm')
    expect(s.error).toBe('create failed')
  })

  it('reset returns to the initial state', () => {
    expect(wizardReducer(at({ step: 'confirm', plan: 'x' }), { type: 'reset' })).toEqual(initialWizard)
  })

  it('stepIndex reflects order', () => {
    expect(STEPS.map(stepIndex)).toEqual([0, 1, 2, 3])
  })
})
