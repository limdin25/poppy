import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  Inbox,
  Bot,
  User,
  Menu,
  X,
  ChevronRight,
  ChevronsLeft,
  Users,
  Calendar,
  FileText,
  Receipt,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'

const primaryNav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
]

const agentNav = { to: '/agent', icon: Bot, label: 'Agent Setup' }
const agentSubNav = [
  { to: '/agent/services', label: 'Services' },
  { to: '/agent/faqs', label: 'FAQs' },
  { to: '/agent/greeting', label: 'Greeting' },
  { to: '/agent/call-info', label: 'Call Info' },
  { to: '/agent/voice', label: 'Voice' },
  { to: '/agent/behaviour', label: 'Behaviour' },
  { to: '/agent/training', label: 'Training' },
]

const secondaryNav = [
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/appointments', icon: Calendar, label: 'Bookings' },
  { to: '/quotes', icon: FileText, label: 'Quotes' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
]

const accountNav = { to: '/account', icon: User, label: 'Account' }
const accountSubNav = [
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/company', label: 'Company' },
  { to: '/account/billing', label: 'Billing' },
  { to: '/account/team', label: 'Team' },
  { to: '/account/notifications', label: 'Notifications' },
  { to: '/account/integrations', label: 'Integrations' },
]

const mobileNav = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/agent', icon: Bot, label: 'Agent' },
  { to: '/account', icon: User, label: 'Account' },
]

const FULL_BLEED_ROUTES = ['/calls', '/inbox', '/contacts']

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [agentExpanded, setAgentExpanded] = useState(false)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const location = useLocation()

  const isFullBleed = FULL_BLEED_ROUTES.includes(location.pathname)

  useEffect(() => {
    if (location.pathname.startsWith('/agent')) setAgentExpanded(true)
    if (location.pathname.startsWith('/account')) setAccountExpanded(true)
  }, [location.pathname])

  function isActive(to: string) {
    return to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  }

  function renderNavItem(
    item: { to: string; icon: React.ElementType; label: string },
    expandable?: { expanded: boolean; onToggle: () => void }
  ) {
    const active = isActive(item.to)
    const Icon = item.icon
    return (
      <div className="flex items-center">
        <NavLink
          to={item.to}
          onClick={() => setSidebarOpen(false)}
          title={collapsed ? item.label : undefined}
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
            active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-elevated hover:text-ink',
            collapsed && 'justify-center px-0'
          )}
        >
          <Icon size={18} className="shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
        {expandable && !collapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              expandable.onToggle()
            }}
            className="ml-auto rounded p-1 text-ink-subtle hover:bg-elevated hover:text-ink"
          >
            <ChevronRight
              size={14}
              className={cn('transition-transform duration-150', expandable.expanded && 'rotate-90')}
            />
          </button>
        )}
      </div>
    )
  }

  function renderSubNav(items: { to: string; label: string }[]) {
    if (collapsed) return null
    return (
      <div className="ml-7 mt-0.5 space-y-0.5 border-l border-border pl-2.5">
        {items.map((sub) => (
          <NavLink
            key={sub.to}
            to={sub.to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'block rounded-md px-2.5 py-1 text-[12px] transition-colors',
                isActive ? 'font-medium text-brand' : 'text-ink-muted hover:text-ink'
              )
            }
          >
            {sub.label}
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface transition-all duration-200 ease-apple lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-14' : 'lg:w-[220px]',
          'w-[220px]'
        )}
      >
        {/* Logo + collapse toggle */}
        <div className={cn('flex h-12 items-center justify-between border-b border-border', collapsed ? 'justify-center px-2' : 'px-4')}>
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink"
              title="Expand sidebar"
            >
              <ChevronsLeft size={16} className="rotate-180" />
            </button>
          ) : (
            <>
              <span className="text-lg font-semibold text-ink">Poppy</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCollapsed(true)}
                  className="hidden rounded-md p-1 text-ink-subtle hover:bg-elevated hover:text-ink lg:block"
                  title="Collapse sidebar"
                >
                  <ChevronsLeft size={16} />
                </button>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-md p-1 text-ink-muted hover:bg-elevated lg:hidden"
                >
                  <X size={18} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn('flex-1 overflow-y-auto py-1.5 scrollbar-thin', collapsed ? 'px-1.5' : 'px-2')}>
          <div className="space-y-0.5">
            {primaryNav.map((item) => (
              <div key={item.to}>{renderNavItem(item)}</div>
            ))}
          </div>

          <div className="my-2 h-px bg-border" />

          <div>
            {renderNavItem(agentNav, {
              expanded: agentExpanded,
              onToggle: () => setAgentExpanded(!agentExpanded),
            })}
            {agentExpanded && renderSubNav(agentSubNav)}
          </div>

          <div className="my-2 h-px bg-border" />

          <div className="space-y-0.5">
            {secondaryNav.map((item) => (
              <div key={item.to}>{renderNavItem(item)}</div>
            ))}
          </div>

          <div className="my-2 h-px bg-border" />

          <div>
            {renderNavItem(accountNav, {
              expanded: accountExpanded,
              onToggle: () => setAccountExpanded(!accountExpanded),
            })}
            {accountExpanded && renderSubNav(accountSubNav)}
          </div>
        </nav>

        {/* Trial banner */}
        {!collapsed && (
          <div className="border-t border-border p-3">
            <div className="rounded-lg bg-brand-50 p-2.5 text-center">
              <p className="text-[12px] font-medium text-brand-700">7-day free trial</p>
              <p className="mt-0.5 text-[11px] text-ink-muted">No credit card required</p>
            </div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile only */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-elevated"
          >
            <Menu size={22} />
          </button>
          <span className="text-[15px] font-semibold text-ink">Poppy</span>
        </header>

        {/* Page content */}
        <main className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          isFullBleed ? '' : 'overflow-y-auto'
        )}>
          <div className={cn(
            'h-full w-full flex-1',
            isFullBleed ? '' : 'overflow-y-auto p-4 sm:p-6 lg:px-8 lg:py-6'
          )}>
            {isFullBleed ? <Outlet /> : (
              <div className="max-w-6xl">
                <Outlet />
              </div>
            )}
          </div>
        </main>

        {/* Bottom tab bar — mobile only */}
        <nav className="sticky bottom-0 z-30 flex border-t border-border bg-surface safe-bottom lg:hidden">
          {mobileNav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                isActive(to) ? 'text-brand' : 'text-ink-muted'
              )}
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
