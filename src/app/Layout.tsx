import { useState, useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  Inbox,
  BarChart3,
  Bot,
  Menu,
  X,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  Bell,
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
  BookOpen,
  Settings as SettingsIcon,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { Avatar } from '@/core/ui/Avatar'
import { useAuth } from '@/core/auth/AuthProvider'
import { useBusiness } from '@/core/hooks/useBusiness'
import { useVoiceEnabled } from '@/core/hooks/useVoiceEnabled'
import { supabase } from '@/core/hooks/useSupabaseQuery'

type NavItem = { to: string; icon: React.ElementType; label: string }

// Waslo-style grouped sidebar. Voice-only items (Calls, Quotes, Invoices,
// Billing) appear only when the business has voice_ai provisioned. WhatsApp is
// the core product for everyone else.
const workNav: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/leads', icon: Flame, label: 'Leads' },
  { to: '/appointments', icon: Calendar, label: 'Appointments' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
]

const callsNav: NavItem = { to: '/calls', icon: Phone, label: 'Calls' }

// AI group. AI Agent is expandable into its behaviour sub-pages.
const aiNav: NavItem[] = [
  { to: '/knowledge', icon: BookOpen, label: 'Knowledge Base' },
  { to: '/templates', icon: FileText, label: 'Templates' },
]
const agentNav: NavItem = { to: '/agents', icon: Bot, label: 'AI Agent' }
const agentSubNav = [
  { to: '/agents/personality', label: 'AI Personality' },
  { to: '/agents/classification', label: 'Classification' },
  { to: '/agents/followup', label: 'Auto Follow-up' },
  { to: '/agents/handoff', label: 'Human Handoff' },
]

// Growth group. Quotes/Invoices/Billing are voice-only extras.
const growthNav: NavItem[] = [
  { to: '/connections', icon: Link2, label: 'Integrations' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
]
const voiceGrowthNav: NavItem[] = [
  { to: '/quotes', icon: FileText, label: 'Quotes' },
  { to: '/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/billing', icon: CreditCard, label: 'Billing' },
]

const accountNav: NavItem = { to: '/account', icon: SettingsIcon, label: 'Settings' }
const accountSubNav = [
  { to: '/account/general', label: 'General' },
  { to: '/account/notifications', label: 'Notifications' },
  { to: '/account/company', label: 'Organization' },
  { to: '/account/billing', label: 'Billing & Plans' },
]

const FULL_BLEED_ROUTES = ['/calls', '/inbox', '/contacts']

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const [agentExpanded, setAgentExpanded] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const location = useLocation()
  const { user, impersonating, stopImpersonation, signOut } = useAuth()
  const { data: business } = useBusiness()
  const { enabled: voiceEnabled } = useVoiceEnabled()
  const navigate = useNavigate()

  // Voice accounts get Calls in WORK; WhatsApp-only accounts never see it.
  const workItems: NavItem[] = voiceEnabled ? [...workNav, callsNav] : workNav
  const growthItems: NavItem[] = voiceEnabled ? [...growthNav, ...voiceGrowthNav] : growthNav

  const mobileNav: NavItem[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
    { to: '/inbox', icon: Inbox, label: 'Inbox' },
    { to: '/leads', icon: Flame, label: 'Leads' },
    { to: '/agents', icon: Bot, label: 'Agent' },
    { to: '/account', icon: SettingsIcon, label: 'Settings' },
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
    if (location.pathname.startsWith('/agents')) setAgentExpanded(true)
  }, [location.pathname])

  function isActive(to: string) {
    // Overview/Home own "/dashboard" exactly (and "/" before the host-aware redirect).
    if (to === '/dashboard') return location.pathname === '/dashboard' || location.pathname === '/'
    return location.pathname.startsWith(to)
  }

  const displayName = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'You'
  const orgName = business?.name ?? `${displayName}'s Organization`

  function renderNavItem(
    item: NavItem,
    expandable?: { expanded: boolean; onToggle: () => void },
    exact?: boolean
  ) {
    // Expandable parents (AI Agent, Settings) only own the active highlight on their
    // exact page — when a sub-route is open, the active sub-item carries it instead.
    const active = exact ? location.pathname === item.to : isActive(item.to)
    const Icon = item.icon
    return (
      <div className="flex items-center">
        <NavLink
          to={item.to}
          onClick={() => setSidebarOpen(false)}
          title={collapsed ? item.label : undefined}
          className={cn(
            'relative flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
            active
              ? 'bg-elevated font-semibold text-ink'
              : 'font-medium text-ink-muted hover:bg-elevated/60 hover:text-ink',
            collapsed && 'justify-center px-0'
          )}
        >
          {active && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
          )}
          <Icon size={18} className="shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
        {expandable && !collapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              expandable.onToggle()
            }}
            className="ml-0.5 rounded p-1 text-ink-subtle hover:bg-elevated hover:text-ink"
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
          <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
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
                isActive ? 'bg-elevated font-semibold text-ink' : 'text-ink-muted hover:text-ink'
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
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" />
            <span>Add a payment method to activate your account.</span>
          </div>
          <NavLink
            to="/billing"
            className="rounded-md bg-amber-500 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-amber-600"
          >
            Add Card
          </NavLink>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface transition-all duration-200 ease-apple lg:static lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            collapsed ? 'lg:w-16' : 'lg:w-[232px]',
            'w-[232px]'
          )}
        >
          {/* Logo + collapse toggle */}
          <div
            className={cn(
              'flex h-14 items-center border-b border-border',
              collapsed ? 'justify-center px-2' : 'justify-between px-4'
            )}
          >
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
                <div className="flex items-center gap-2">
                  <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-[14px] font-bold text-white">
                    E
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-whatsapp ring-2 ring-surface" />
                  </div>
                  <span className="text-[17px] font-semibold tracking-tight text-ink">Elsie</span>
                </div>
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
          <nav className={cn('min-h-0 flex-1 overflow-y-auto py-1.5 scrollbar-thin', collapsed ? 'px-1.5' : 'px-2')}>
            {renderSection('Work', workItems)}

            {collapsed && <div className="my-2 h-px bg-border" />}
            {!collapsed && (
              <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
                AI
              </p>
            )}
            <div className="space-y-0.5">
              {aiNav.map((item) => (
                <div key={item.to}>{renderNavItem(item)}</div>
              ))}
              <div>
                {renderNavItem(
                  agentNav,
                  { expanded: agentExpanded, onToggle: () => setAgentExpanded(!agentExpanded) },
                  true
                )}
                {agentExpanded && renderSubNav(agentSubNav)}
              </div>
            </div>

            {collapsed && <div className="my-2 h-px bg-border" />}
            {renderSection('Growth', growthItems)}

            {collapsed && <div className="my-2 h-px bg-border" />}
            {!collapsed && (
              <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-ink-subtle">
                Admin
              </p>
            )}
            <div>
              {renderNavItem(
                accountNav,
                { expanded: accountExpanded, onToggle: () => setAccountExpanded(!accountExpanded) },
                true
              )}
              {accountExpanded && renderSubNav(accountSubNav)}
            </div>

            {isAdmin && (
              <NavLink
                to="/super"
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? 'Super Panel' : undefined}
                className={cn(
                  'mt-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-amber-600 transition-colors hover:bg-amber-50',
                  collapsed && 'justify-center px-0'
                )}
              >
                <Shield size={18} className="shrink-0" />
                {!collapsed && <span>Super Panel</span>}
              </NavLink>
            )}
          </nav>

          {/* Footer: org switcher + My Account */}
          <div className={cn('shrink-0 border-t border-border', collapsed ? 'space-y-1 px-1.5 py-2' : 'space-y-1.5 px-2 py-2')}>
            {collapsed ? (
              <>
                <button
                  onClick={() => navigate('/account/company')}
                  title={orgName}
                  className="mx-auto flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[12px] font-semibold text-white"
                >
                  {orgName.charAt(0).toUpperCase()}
                </button>
                <button
                  onClick={() => signOut()}
                  title="Sign out"
                  className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-elevated hover:text-ink"
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => navigate('/account/company')}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-page px-2.5 py-2 text-left transition-colors hover:bg-elevated"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-[12px] font-semibold text-white">
                    {orgName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-ink">{orgName}</p>
                    <p className="text-[11px] text-ink-subtle">Owner</p>
                  </div>
                  <ChevronsUpDown size={14} className="shrink-0 text-ink-subtle" />
                </button>
                <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
                  <Avatar name={displayName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">{displayName}</p>
                    <p className="truncate text-[11px] text-ink-subtle">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => navigate('/account/notifications')}
                    title="Notifications"
                    className="rounded-md p-1.5 text-ink-muted hover:bg-elevated hover:text-ink"
                  >
                    <Bell size={15} />
                  </button>
                  <button
                    onClick={() => signOut()}
                    title="Sign out"
                    className="rounded-md p-1.5 text-ink-muted hover:bg-elevated hover:text-ink"
                  >
                    <LogOut size={15} />
                  </button>
                </div>
              </>
            )}
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
            <div className="flex items-center gap-2">
              <div className="relative flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[12px] font-bold text-white">
                E
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-whatsapp ring-2 ring-surface" />
              </div>
              <span className="text-[15px] font-semibold text-ink">Elsie</span>
            </div>
          </header>

          {/* Page content */}
          <main className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', isFullBleed ? '' : 'overflow-y-auto')}>
            <div
              className={cn(
                'h-full w-full flex-1',
                isFullBleed ? '' : 'overflow-y-auto p-4 sm:p-6 lg:px-8 lg:py-6'
              )}
            >
              {isFullBleed ? (
                <Outlet />
              ) : (
                <div className="mx-auto max-w-6xl">
                  <Outlet />
                </div>
              )}
            </div>
          </main>

          {/* Bottom tab bar — mobile only */}
          <nav className="safe-bottom sticky bottom-0 z-30 flex border-t border-border bg-surface lg:hidden">
            {mobileNav.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                  isActive(to) ? 'text-ink' : 'text-ink-muted'
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
