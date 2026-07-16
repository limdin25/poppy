import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { Bot, Phone, MessageSquare, Mail, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/core/lib/cn';

/**
 * CRM AI agent shell — the /agents UI ported for Maya. Left sub-nav
 * (AI Personality / Call behaviour) + a "Configure settings for" channel pill
 * bar (Calls / SMS / Email / WhatsApp) that scopes both sub-pages via ?ch=.
 * Same structure as src/features/agents/AgentLayout.tsx, CRM design language.
 */

interface NavItem { to: string; label: string; description: string; icon: LucideIcon }

const NAV: NavItem[] = [
  { to: 'personality', label: 'AI Personality', description: 'Prompt, greeting, model, guardrails', icon: Bot },
  { to: 'calling', label: 'Call behaviour', description: 'Voice, timing, interruptions, ambience', icon: Phone },
];

export const CRM_CHANNELS = [
  { key: 'voice', label: 'Calls', icon: Phone },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'email', label: 'Email', icon: Mail },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
] as const;

export type CrmChannel = (typeof CRM_CHANNELS)[number]['key'];

export function useCrmChannel(): CrmChannel {
  const [searchParams] = useSearchParams();
  return (CRM_CHANNELS.find((c) => c.key === searchParams.get('ch'))?.key) ?? 'voice';
}

export default function CrmAgentLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  // No ?ch= in the URL simply means Calls — everything below defaults to
  // 'voice' in code, so no URL rewrite is needed (a mount-time rewrite races
  // the index route's redirect to /personality and can cancel it).
  const channel = (CRM_CHANNELS.find((c) => c.key === searchParams.get('ch'))?.key) ?? 'voice';

  function setChannel(key: string) {
    const next = new URLSearchParams(searchParams);
    next.set('ch', key);
    setSearchParams(next, { replace: true });
  }

  // Call behaviour is phone-only — hide it for the writing channels.
  const channelNav = channel === 'voice' ? NAV : NAV.filter((n) => n.to !== 'calling');
  const currentLabel = CRM_CHANNELS.find((c) => c.key === channel)?.label ?? 'Calls';

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <header className="mb-5">
        <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">AI agent — Maya</h1>
        <p className="text-[13px] text-[#6B7280]">Shape how Maya answers calls and warms up leads, per channel.</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        {/* LEFT — sub-nav */}
        <nav className="bg-white border border-[#E5E7EB] rounded-2xl p-2.5 self-start">
          <ul className="space-y-1">
            {channelNav.map((n) => {
              const Icon = n.icon;
              return (
                <li key={n.to}>
                  <NavLink
                    to={{ pathname: n.to, search: `?ch=${channel}` }}
                    className={({ isActive }) => cn(
                      'flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
                      isActive ? 'bg-[#3C5A87] text-white' : 'text-[#1A1A1A] hover:bg-[#F3F3EE]',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', isActive ? 'text-white' : 'text-[#6B7280]')} strokeWidth={1.8} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold leading-tight">{n.label}</span>
                          <span className={cn('mt-0.5 block truncate text-[11px] leading-tight', isActive ? 'text-white/70' : 'text-[#9CA3AF]')}>{n.description}</span>
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* RIGHT — channel picker + active sub-page */}
        <div className="min-w-0">
          <div className="mb-5 bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Configure settings for</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {CRM_CHANNELS.map((c) => {
                const Icon = c.icon;
                const active = c.key === channel;
                return (
                  <button
                    key={c.key}
                    onClick={() => setChannel(c.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition',
                      active ? 'bg-[#3C5A87] text-white' : 'text-[#6B7280] hover:bg-[#F3F3EE] hover:text-[#1A1A1A]',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" strokeWidth={1.8} /> {c.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-[#9CA3AF]">
              Each channel has its own prompt and behaviour. Changes here apply to <strong className="text-[#6B7280]">{currentLabel}</strong>.
            </p>
          </div>

          <Outlet />
        </div>
      </div>
    </div>
  );
}
