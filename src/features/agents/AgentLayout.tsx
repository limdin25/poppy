import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Bot, Brain, RefreshCw, UserPlus, Search, Globe } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/core/ui/PageHeader'
import { Input } from '@/core/ui/Input'
import { Select } from '@/core/ui/Select'
import { cn } from '@/core/lib/cn'

/**
 * AI Agent shared shell (waslo-faithful layout, Elsie voice). Renders the page
 * header + a left sub-nav + a context dropdown, with an <Outlet/> for the active
 * sub-page (Personality / Classification / Follow-up / Handoff).
 *
 * Phase A: local state only. Phase B: the context dropdown will scope settings
 * to a specific number/channel; routes wired separately in App.tsx.
 */

interface NavItem {
  to: string
  label: string
  description: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  {
    to: '/agents/personality',
    label: 'AI Personality',
    description: 'Tone, language, prompt, welcome message',
    icon: Bot,
  },
  {
    to: '/agents/classification',
    label: 'Goals',
    description: 'What Elsie optimises each lead toward',
    icon: Brain,
  },
  {
    to: '/agents/followup',
    label: 'Auto Follow-up',
    description: 'Re-engage cold leads automatically',
    icon: RefreshCw,
  },
  {
    to: '/agents/handoff',
    label: 'Human Handoff',
    description: 'When + how Elsie escalates to your team',
    icon: UserPlus,
  },
]

export default function AgentLayout() {
  const [search, setSearch] = useState('')
  const [context, setContext] = useState('org')

  const q = search.trim().toLowerCase()
  const items = q
    ? NAV.filter(
        (n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q),
      )
    : NAV

  return (
    <div>
      <PageHeader
        bare
        eyebrow="AI Agent"
        title="Your AI agent"
        description="Shape how Elsie thinks, replies, and escalates."
      />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* LEFT — sub-nav */}
        <nav className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
          <div className="relative mb-2">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="h-9 pl-9 text-[13px]"
              aria-label="Search agent settings"
            />
          </div>

          <ul className="space-y-1">
            {items.map((n) => {
              const Icon = n.icon
              return (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
                        isActive
                          ? 'bg-accent text-white'
                          : 'text-ink hover:bg-elevated/60',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={16}
                          className={cn('mt-0.5 shrink-0', isActive ? 'text-white' : 'text-ink-muted')}
                        />
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold leading-tight">
                            {n.label}
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 block truncate text-[11.5px] leading-tight',
                              isActive ? 'text-white/70' : 'text-ink-subtle',
                            )}
                          >
                            {n.description}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-[12.5px] text-ink-subtle">
                No settings match “{search}”.
              </li>
            )}
          </ul>
        </nav>

        {/* RIGHT — context selector + active sub-page */}
        <div className="min-w-0">
          <div className="mb-5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
              Configure settings for
            </p>
            <div className="relative">
              <Globe
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-ink-subtle"
              />
              <Select
                value={context}
                onChange={(e) => setContext(e.target.value)}
                className="pl-9"
                aria-label="Configure settings for"
              >
                <option value="org">All WhatsApp numbers (default)</option>
                <option value="whatsapp">WhatsApp</option>
              </Select>
            </div>
          </div>

          <Outlet />
        </div>
      </div>
    </div>
  )
}
