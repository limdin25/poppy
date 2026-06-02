import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  Inbox,
  BarChart3,
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
  CreditCard,
  AlertTriangle,
  Shield,
  Eye,
  LogOut,
  Link2,
  Flame,
  Megaphone,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { useVoiceEnabled } from '@/core/hooks/useVoiceEnabled'
import { supabase } from '@/core/hooks/useSupabaseQuery'

type NavItem = { to: string; icon: React.ElementType; label: string }

// Waslo-style grouped sidebar. Calls is appended to WORK only when the
// business has voice provisioned (voice_ai flag). WhatsApp is the core product.
const workNav: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/leads', icon: Flame, label: 'Leads' },
  { to: '/contacts', icon: Users, label: 'Contacts' },
  { to: '/appointments', icon: Calendar, label: 'Bookings' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
]

const aiNav: NavItem[] = [
  { to: '/agents', icon: Bot, label: 'AI Agent' },
  { to: '/connections', icon: Link2, label: 'Integrations' },
]

const growthNav: NavItem[] = [
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/quotes', icon: FileText, label: 'Quotes' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
]

const callsNav: NavItem = { to: '/calls', icon: Phone, label: 'Calls' }

const accountNav = { to: '/account', icon: User, label: 'Settings' }
const accountSubNav = [
  { to: '/account/profile', label: 'Profile' },
  { to: '/account/company', label: 'Company' },
  { to: '/account/billing', label: 'Billing' },
  { to: '/account/team', label: 'Team' },
  { to: '/account/notifications', label: 'Notifications' },
  { to: '/account/integrations', label: 'Integrations' },
]

const FULL_BLEED_ROUTES = ['/calls', '/inbox', '/contacts']

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const location = useLocation()
  const { user, impersonating, stopImpersonation, signOut } = useAuth()
  const { data: business } = useBusiness()
  const { enabled: voiceEnabled } = useVoiceEnabled()
  const navigate = useNavigate()

  // Voice accounts get Calls in WORK; WhatsApp-only accounts never see it.
  const workItems: NavItem[] = voiceEnabled
    ? [workNav[0], workNav[1], callsNav, ...workNav.slice(2)]
    : workNav

  const mobileNav: NavItem[] = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/inbox', icon: Inbox, label: 'Inbox' },
    { to: '/leads', icon: Flame, label: 'Leads' },
    { to: '/agents', icon: Bot, label: 'Agent' },
    { to: '/account', icon: User, label: 'Settings' },
  ]

  useEffect(() => {
    if (!user?.email) return
    supabase
      .from('admin_users')
      .select('email')
      .eq('email', user.email)
      .single()
      .then(({ data }) => setIsAdmin(!!data))
  }, [user?.email])

  const isFullBleed = FULL_BLEED_ROUTES.includes(location.pathname)

  useEffect(() => {
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

  function renderSection(heading: string, items: NavItem[]) {
    return (
      <div className="space-y-0.5">
        {!collapsed && (
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {heading}
          </p>
        )}
        {items.map((item) => (
          <div key={item.to}>{renderNavItem(item)}</div>
        ))}
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
    <div className="flex h-full flex-col">
      {impersonating && (
        <div className="flex items-center justify-between bg-amber-500 px-4 py-2 text-[13px] font-medium text-black">
          <div className="flex items-center gap-2">
            <Eye size={14} />
            <span>Viewing as: {impersonating.businessName}</span>
          </div>
          <button
            onClick={() => {
              stopImpersonation()
              navigate('/super')
            }}
            className="flex items-center gap-1 rounded-md bg-black/10 px-2 py-0.5 text-[12px] hover:bg-black/20"
          >
            <X size={12} />
            Exit
          </button>
        </div>
      )}
      {business?.billing_active && !business.stripe_customer_id && !impersonating && (
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-[13px] text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <span>Add a payment method to activate your account.</span>
          </div>
          <NavLink
            to="/billing"
            className="rounded-md bg-amber-500 px-3 py-1 text-[12px] font-medium text-white hover:bg-amber-600 transition-colors"
          >
            Add Card
          </NavLink>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
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
              <span className="text-lg font-semibold text-ink">Elsie</span>
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
          {renderSection('Work', workItems)}

          {collapsed && <div className="my-2 h-px bg-border" />}
          {renderSection('AI', aiNav)}

          {collapsed && <div className="my-2 h-px bg-border" />}
          {renderSection('Growth', growthNav)}

          {collapsed && <div className="my-2 h-px bg-border" />}
          {!collapsed && (
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Admin
            </p>
          )}
          <div>
            {renderNavItem(accountNav, {
              expanded: accountExpanded,
              onToggle: () => setAccountExpanded(!accountExpanded),
            })}
            {accountExpanded && renderSubNav(accountSubNav)}
          </div>
        </nav>

        {/* Admin link */}
        {isAdmin && (
          <div className={cn('border-t border-border', collapsed ? 'px-1.5 py-1.5' : 'px-2 py-1.5')}>
            <NavLink
              to="/super"
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? 'Super Panel' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                'text-amber-600 hover:bg-amber-50',
                collapsed && 'justify-center px-0'
              )}
            >
              <Shield size={18} className="shrink-0" />
              {!collapsed && <span>Super Panel</span>}
            </NavLink>
          </div>
        )}

        {/* Sign out */}
        <div className={cn('border-t border-border', collapsed ? 'px-1.5 py-1.5' : 'px-2 py-1.5')}>
          <button
            onClick={() => signOut()}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink',
              collapsed && 'justify-center px-0'
            )}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
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
          <span className="text-[15px] font-semibold text-ink">Elsie</span>
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
    </div>
  )
}
