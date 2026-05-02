import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { cn } from '@/core/lib/cn'
import ServicesSection from './sections/ServicesSection'
import FAQsSection from './sections/FAQsSection'
import GreetingSection from './sections/GreetingSection'
import CallInfoSection from './sections/CallInfoSection'
import VoiceSection from './sections/VoiceSection'
import BehaviourSection from './sections/BehaviourSection'
import TrainingSection from './sections/TrainingSection'

const tabs = [
  { to: '/agent/services', label: 'Services' },
  { to: '/agent/faqs', label: 'FAQs' },
  { to: '/agent/greeting', label: 'Greeting' },
  { to: '/agent/call-info', label: 'Call Info' },
  { to: '/agent/voice', label: 'Voice' },
  { to: '/agent/behaviour', label: 'Behaviour' },
  { to: '/agent/training', label: 'Training' },
]

export default function AgentSetupPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Agent Setup</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        Configure how your AI receptionist handles calls.
      </p>

      {/* Horizontal scrolling tabs on mobile */}
      <div className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 border-b border-border pb-px">
          {tabs.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-t-lg px-4 py-2.5 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'border-b-2 border-brand text-brand'
                    : 'text-ink-muted hover:text-ink'
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Routes>
          <Route index element={<Navigate to="services" replace />} />
          <Route path="services" element={<ServicesSection />} />
          <Route path="faqs" element={<FAQsSection />} />
          <Route path="greeting" element={<GreetingSection />} />
          <Route path="call-info" element={<CallInfoSection />} />
          <Route path="voice" element={<VoiceSection />} />
          <Route path="behaviour" element={<BehaviourSection />} />
          <Route path="training" element={<TrainingSection />} />
        </Routes>
      </div>
    </div>
  )
}
