import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { cn } from '@/core/lib/cn'
import ProfileSection from './sections/ProfileSection'
import CompanySection from './sections/CompanySection'
import BillingSection from './sections/BillingSection'
import TeamSection from './sections/TeamSection'
import NotificationsSection from './sections/NotificationsSection'
import IntegrationsSection from './sections/IntegrationsSection'
import FollowUpSection from './sections/FollowUpSection'

const tabs = [
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/company', label: 'Company' },
  { to: '/account/billing', label: 'Billing' },
  { to: '/account/team', label: 'Team' },
  { to: '/account/notifications', label: 'Notifications' },
  { to: '/account/integrations', label: 'Integrations' },
  { to: '/account/follow-ups', label: 'Follow-ups' },
]

export default function AccountPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Account</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        Manage your profile, billing, and team.
      </p>

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
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSection />} />
          <Route path="company" element={<CompanySection />} />
          <Route path="billing" element={<BillingSection />} />
          <Route path="team" element={<TeamSection />} />
          <Route path="notifications" element={<NotificationsSection />} />
          <Route path="integrations" element={<IntegrationsSection />} />
          <Route path="follow-ups" element={<FollowUpSection />} />
        </Routes>
      </div>
    </div>
  )
}
