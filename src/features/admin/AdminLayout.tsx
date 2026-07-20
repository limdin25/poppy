import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  Sparkles,
  LayoutDashboard,
  BarChart3,
  Building2,
  Users,
  Phone,
  MessageSquare,
  CreditCard,
  Bot,
  Hash,
  Flag,
  Activity,
  ScrollText,
  Home,
  SearchCode,
  KanbanSquare,
  Headset,
  ShieldCheck,
  Menu,
  X,
  ArrowLeft,
  LogOut,
} from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { ImpersonationBanner } from './components/ImpersonationBanner'

const navGroups = [
  {
    label: 'Assistant',
    items: [
      { to: '/admin/ceo', icon: Sparkles, label: 'CEO' },
    ],
  },
  {
    label: 'Overview',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  },
  {
    label: 'Clients',
    items: [
      { to: '/admin/businesses', icon: Building2, label: 'Businesses' },
      { to: '/admin/users', icon: Users, label: 'Users' },
    ],
  },
  {
    label: 'Monitor',
    items: [
      { to: '/admin/calls', icon: Phone, label: 'Calls' },
      { to: '/admin/conversations', icon: MessageSquare, label: 'Conversations' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/admin/crm', icon: Headset, label: 'CRM' },
      { to: '/admin/phone-validation', icon: ShieldCheck, label: 'Phone Validator' },
    ],
  },
  {
    label: 'BRRR',
    items: [
      { to: '/admin/scraper', icon: SearchCode, label: 'Scraper' },
      { to: '/admin/properties', icon: Home, label: 'Properties' },
      { to: '/admin/pipeline', icon: KanbanSquare, label: 'Pipeline' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/admin/billing', icon: CreditCard, label: 'Billing' },
      { to: '/admin/ai', icon: Bot, label: 'AI Management' },
      { to: '/admin/numbers', icon: Hash, label: 'Numbers' },
      { to: '/admin/feature-flags', icon: Flag, label: 'Feature Flags' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/system', icon: Activity, label: 'Health' },
      { to: '/admin/audit-log', icon: ScrollText, label: 'Audit Log' },
    ],
  },
]

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { signOut } = useAuth()

  function isActive(to: string, end?: boolean) {
    if (end) return location.pathname === to
    return location.pathname.startsWith(to)
  }

  return (
    <div className="flex h-screen">
      <ImpersonationBanner />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-[#1a1a2e] transition-transform duration-200 lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-white">Elsie</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/70">Admin</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="text-white/50 hover:text-white lg:hidden">
            <X size={18} />
          </button>
        </div>

        {/* Back to app */}
        <div className="px-3">
          <NavLink
            to="/dashboard"
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-white/50 transition hover:bg-white/5 hover:text-white/80"
          >
            <ArrowLeft size={13} />
            Back to app
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="mt-3 flex-1 overflow-y-auto px-3 scrollbar-thin">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.to, (item as { end?: boolean }).end)
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={(item as { end?: boolean }).end}
                      onClick={() => setSidebarOpen(false)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition',
                        active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                      )}
                    >
                      <Icon size={15} className="shrink-0" />
                      {item.label}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="border-t border-white/10 p-3">
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-white/50 transition hover:bg-white/5 hover:text-white/80"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="text-ink-muted hover:text-ink">
            <Menu size={20} />
          </button>
          <span className="text-[14px] font-semibold text-ink">Elsie Admin</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
