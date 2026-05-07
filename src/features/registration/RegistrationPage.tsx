import { useState } from 'react'
import StepIndicator from './components/StepIndicator'
import BusinessSearch from './steps/BusinessSearch'
import AITraining from './steps/AITraining'
import AccountCreation from './steps/AccountCreation'
import NumberSetup from './steps/NumberSetup'
import TestCall from './steps/TestCall'

export interface BusinessData {
  name: string
  address: string
  phone: string
  website: string
  googlePlaceId: string
  industry: string
}

export interface RegistrationState {
  step: number
  business: BusinessData
  businessId: string
  userName: string
  userEmail: string
  agentNumber: string
}

const INITIAL_STATE: RegistrationState = {
  step: 1,
  business: {
    name: '',
    address: '',
    phone: '',
    website: '',
    googlePlaceId: '',
    industry: '',
  },
  businessId: '',
  userName: '',
  userEmail: '',
  agentNumber: '',
}

const STEP_LABELS = [
  'Find your business',
  'Training Elsie',
  'Create account',
  'Setting up number',
  'Test call',
]

export default function RegistrationPage() {
  const [state, setState] = useState<RegistrationState>(INITIAL_STATE)

  function goNext() {
    setState((s) => ({ ...s, step: Math.min(s.step + 1, 5) }))
  }

  function updateBusiness(business: BusinessData) {
    setState((s) => ({ ...s, business }))
  }

  function updateBusinessId(businessId: string) {
    setState((s) => ({ ...s, businessId }))
  }

  function updateAccount(userName: string, userEmail: string) {
    setState((s) => ({ ...s, userName, userEmail }))
  }

  function updateNumber(agentNumber: string) {
    setState((s) => ({ ...s, agentNumber }))
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Header */}
      <header className="flex h-14 items-center justify-center border-b border-border bg-surface">
        <span className="text-lg font-semibold text-ink">Elsie</span>
      </header>

      {/* Step indicator */}
      <div className="mx-auto w-full max-w-lg px-4 pt-6">
        <StepIndicator current={state.step} labels={STEP_LABELS} />
      </div>

      {/* Step content */}
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6">
        {state.step === 1 && (
          <BusinessSearch
            business={state.business}
            onUpdate={updateBusiness}
            onNext={goNext}
          />
        )}
        {state.step === 2 && (
          <AITraining
            business={state.business}
            onBusinessCreated={updateBusinessId}
            onNext={goNext}
          />
        )}
        {state.step === 3 && (
          <AccountCreation
            businessId={state.businessId}
            businessName={state.business.name}
            onSubmit={(name, email) => {
              updateAccount(name, email)
              goNext()
            }}
          />
        )}
        {state.step === 4 && (
          <NumberSetup
            businessId={state.businessId}
            onNumberReady={(number) => {
              updateNumber(number)
              goNext()
            }}
          />
        )}
        {state.step === 5 && <TestCall agentNumber={state.agentNumber} />}
      </div>

      {/* Trust footer */}
      <footer className="border-t border-border bg-surface py-4 text-center text-[12px] text-ink-subtle">
        No setup fee · Only pay per booking · Cancel anytime
      </footer>
    </div>
  )
}
