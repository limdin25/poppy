import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  PhoneCall,
  Radio,
  Users,
  Kanban,
  BarChart3,
  Trophy,
  Clapperboard,
  Workflow,
  FileText,
  ListChecks,
  Megaphone,
  Bot,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/core/hooks/useMediaQuery';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

interface Smsv2SidebarProps {
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}

// PR 115 (Hugo 2026-04-28): nav order — Dialer first (action-first
// for agents), then Inbox, Pipelines, Contacts, Reports, Leaderboard,
// then Call history at the bottom. Dashboard + Settings stay
// admin-only at the ends. "Calls" renamed to "Call history".
interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/admin/crm/dashboard', icon: LayoutDashboard, adminOnly: true },
  { label: 'Dialer', path: '/admin/crm/dialer-pro', icon: Radio },
  { label: 'Inbox', path: '/admin/crm/inbox', icon: MessageSquare },
  { label: 'Pipelines', path: '/admin/crm/pipelines', icon: Kanban },
  { label: 'Contacts', path: '/admin/crm/contacts', icon: Users },
  { label: 'Broadcasts', path: '/admin/crm/broadcasts', icon: Megaphone },
  { label: 'AI agent', path: '/admin/crm/agent', icon: Bot, adminOnly: true },
  { label: 'Reports', path: '/admin/crm/reports', icon: BarChart3 },
  { label: 'Leaderboard', path: '/admin/crm/leaderboard', icon: Trophy },
  { label: 'Video funnel', path: '/admin/crm/video-funnel', icon: Clapperboard },
  { label: 'Website flow', path: '/admin/crm/site-flow', icon: Workflow },
  { label: 'Call history', path: '/admin/crm/calls', icon: PhoneCall },
  { label: 'AI calls', path: '/admin/crm/ai-calls', icon: Bot, adminOnly: true },
  { label: 'Templates', path: '/admin/crm/templates', icon: FileText },
  // Directly under Templates, Hugo 2026-08-12. Pedro opens it mid-call, so it
  // is its own page at its own URL rather than a tab inside Templates.
  { label: 'Deal process', path: '/admin/crm/deal-process', icon: ListChecks },
  { label: 'Settings', path: '/admin/crm/settings', icon: Settings, adminOnly: true },
];

const MOBILE_TAB_ITEMS = NAV_ITEMS.filter(({ label }) =>
  ['Dialer', 'Inbox', 'Pipelines', 'Contacts', 'Dashboard'].includes(label)
);

export default function Smsv2Sidebar({ collapsed, onCollapse }: Smsv2SidebarProps) {
  const location = useLocation();
  const isMobile = useIsMobile();
  // PR 62 (Hugo 2026-04-27): admin-only items (Dashboard + Settings)
  // are hidden entirely from agents — no point showing a row that
  // CrmGuard would block. Resolve workspace_role from profiles + the
  // admin_users allow-list that useCrmAuth's isAdmin resolves from.
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [workspaceRole, setWorkspaceRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // Wait for auth to settle before resolving the role.
    if (authLoading) return;
    if (!user) { setWorkspaceRole(null); return; }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles' as any) as any)
        .select('workspace_role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) setWorkspaceRole((data?.workspace_role as string | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [authLoading, user]);

  // PR 63 (Hugo 2026-04-27): workspace_role wins when explicitly set.
  // Aligns the sidebar with AdminOnlyRoute so an account that is in the
  // admin_users list but whose workspace_role has been set to 'agent'
  // is treated as an agent.
  const isAdminOrWorkspaceAdmin =
    workspaceRole === 'admin' || (workspaceRole === null && isAdmin);

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  if (isMobile) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-[100] bg-white border-t border-[#E5E7EB] flex items-center justify-around px-1 py-1.5">
        {MOBILE_TAB_ITEMS.map(({ label, path, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] transition-colors',
              isActive(path) ? 'text-[#3C5A87] font-medium' : 'text-[#6B7280]'
            )}
          >
            <Icon className="w-5 h-5" strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <aside
      data-feature="SMSV2__SIDEBAR"
      className={cn(
        'hidden md:flex flex-col border-r border-[#E5E7EB] bg-white/80 backdrop-blur-xl transition-all duration-300 ease-out flex-shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]/60">
        {!collapsed && (
          <span className="text-sm font-semibold text-[#1A1A1A] tracking-tight">CRM</span>
        )}
        <button
          onClick={() => onCollapse(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[#6B7280]"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 py-2 px-2 space-y-1">
        {NAV_ITEMS
          // PR 62: hide admin-only items from agents entirely.
          .filter(({ adminOnly }) => !adminOnly || isAdminOrWorkspaceAdmin)
          .map(({ label, path, icon: Icon, adminOnly }) => (
          <Link
            key={path}
            to={path}
            title={collapsed ? label : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors relative',
              isActive(path)
                ? 'bg-[#EEF2F8] text-[#3C5A87] font-medium'
                : 'text-[#6B7280] hover:bg-black/[0.04] hover:text-[#1A1A1A]'
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
            {!collapsed && (
              <>
                <span className="flex-1">{label}</span>
                {adminOnly && (
                  <span className="text-[9px] text-[#9CA3AF] font-medium uppercase">admin</span>
                )}
              </>
            )}
          </Link>
        ))}
      </nav>

      {!collapsed && (
        <div className="px-4 py-3 border-t border-[#E5E7EB]/60 text-[11px] text-[#9CA3AF]">
          <span className="block">Elsie CRM</span>
        </div>
      )}
    </aside>
  );
}
