import { useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { Search, Settings2, Bell, Building2, CreditCard } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { PageHeader } from '@/core/ui/PageHeader'
import ProfileSection from './sections/ProfileSection'
import CompanySection from './sections/CompanySection'
import BillingSection from './sections/BillingSection'
import NotificationsSection from './sections/NotificationsSection'

const navItems = [
  { to: '/account/general', label: 'General', icon: Settings2 },
  { to: '/account/notifications', label: 'Notifications', icon: Bell },
  { to: '/account/company', label: 'Organization', icon: Building2 },
  { to: '/account/billing', label: 'Billing & Plans', icon: CreditCard },
]

export default function AccountPage() {
  const [query, setQuery] = useState('')

  const visibleItems = navItems.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Manage your organization, Elsie, and integrations."
        bare
      />

      <div className="border-t border-border pt-6">
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          {/* Left vertical sub-nav */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search settings…"
                  className="h-9 w-full rounded-full border border-border bg-page pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-ink-subtle/50"
                />
              </div>

              <nav className="mt-3 space-y-1">
                {visibleItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                        isActive
                          ? 'bg-accent text-white'
                          : 'text-ink-muted hover:bg-elevated hover:text-ink'
                      )
                    }
                  >
                    <Icon size={16} />
                    {label}
                  </NavLink>
                ))}
                {visibleItems.length === 0 && (
                  <p className="px-3.5 py-2.5 text-[13px] text-ink-subtle">No matches.</p>
                )}
              </nav>
            </div>
          </aside>

          {/* Right content */}
          <div className="min-w-0">
            <Routes>
              <Route index element={<Navigate to="general" replace />} />
              <Route path="general" element={<ProfileSection />} />
              <Route path="profile" element={<Navigate to="/account/general" replace />} />
              <Route path="notifications" element={<NotificationsSection />} />
              <Route path="company" element={<CompanySection />} />
              <Route path="team" element={<Navigate to="/account/company" replace />} />
              <Route path="integrations" element={<Navigate to="/account/company" replace />} />
              <Route path="billing" element={<BillingSection />} />
              <Route path="*" element={<Navigate to="/account/general" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </div>
  )
}
