// Pure state machine for the Add-Business wizard (connect → select → plan →
// confirm). No React/I-O so it's unit-tested in isolation. The UI drives it with
// useReducer; guards enforce that you can't skip an incomplete step.

export type Step = 'connect' | 'select' | 'plan' | 'confirm'
export const STEPS: Step[] = ['connect', 'select', 'plan', 'confirm']

export interface WizardState {
  step: Step
  connected: boolean          // Google connected + a business exists
  businessId: string | null
  locationName: string | null // the connected GBP location (Zernio hosts the picker)
  plan: string | null
  error: string | null
}

export const initialWizard: WizardState = {
  step: 'connect', connected: false, businessId: null, locationName: null, plan: null, error: null,
}

export type WizardAction =
  | { type: 'connected'; businessId: string; locationName: string | null }
  | { type: 'oauthFailed'; error: string }
  | { type: 'selectPlan'; plan: string }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'error'; error: string }
  | { type: 'reset' }

export function stepIndex(step: Step): number {
  return STEPS.indexOf(step)
}

/** Whether the current step is complete enough to advance. */
export function canAdvance(state: WizardState): boolean {
  switch (state.step) {
    case 'connect': return state.connected && !!state.businessId
    case 'select': return state.connected           // ≥1 location connected via Zernio
    case 'plan': return !!state.plan
    case 'confirm': return true
  }
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: true, businessId: action.businessId, locationName: action.locationName, step: 'select', error: null }
    case 'oauthFailed':
      return { ...state, step: 'connect', connected: false, error: action.error }
    case 'selectPlan':
      return { ...state, plan: action.plan, error: null }
    case 'next': {
      if (!canAdvance(state)) return state
      const next = STEPS[Math.min(stepIndex(state.step) + 1, STEPS.length - 1)]
      return { ...state, step: next, error: null }
    }
    case 'back': {
      const prev = STEPS[Math.max(stepIndex(state.step) - 1, 0)]
      return { ...state, step: prev, error: null }
    }
    case 'error':
      return { ...state, error: action.error }
    case 'reset':
      return initialWizard
  }
}
