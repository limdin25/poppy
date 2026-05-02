import type { BillingState, Plan } from '../types/domain'

export interface BillingTransitionInput {
  current: BillingState
  event:
    | 'trial_started'
    | 'trial_ended'
    | 'payment_succeeded'
    | 'payment_failed'
    | 'payment_recovered'
    | 'subscription_cancelled'
    | 'period_ended'
}

export function nextBillingState(input: BillingTransitionInput): BillingState {
  const { current, event } = input

  switch (current) {
    case 'trial_active':
      if (event === 'trial_ended') return 'trial_expired'
      if (event === 'payment_succeeded') return 'active'
      return current

    case 'trial_expired':
      if (event === 'payment_succeeded') return 'active'
      return current

    case 'active':
      if (event === 'payment_failed') return 'past_due'
      if (event === 'subscription_cancelled') return 'cancelled'
      return current

    case 'past_due':
      if (event === 'payment_recovered') return 'active'
      if (event === 'payment_succeeded') return 'active'
      if (event === 'subscription_cancelled') return 'cancelled'
      return current

    case 'cancelled':
      if (event === 'payment_succeeded') return 'active'
      return current

    default:
      return current
  }
}

export function isLockedOut(state: BillingState): boolean {
  return state === 'trial_expired' || state === 'cancelled'
}

export interface PlanLimits {
  max_team_members: number
  channels: ('voice' | 'sms' | 'whatsapp' | 'email')[]
  call_recording_days: number
}

export function planLimits(plan: Plan): PlanLimits {
  switch (plan) {
    case 'trial':
      return {
        max_team_members: 1,
        channels: ['voice'],
        call_recording_days: 7,
      }
    case 'starter':
      return {
        max_team_members: 1,
        channels: ['voice'],
        call_recording_days: 30,
      }
    case 'professional':
      return {
        max_team_members: 3,
        channels: ['voice', 'sms', 'whatsapp'],
        call_recording_days: 90,
      }
    case 'business':
      return {
        max_team_members: Infinity,
        channels: ['voice', 'sms', 'whatsapp', 'email'],
        call_recording_days: Infinity,
      }
  }
}
