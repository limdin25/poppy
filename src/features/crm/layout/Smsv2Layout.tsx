import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import ErrorBoundary from '@/core/components/ErrorBoundary';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import CrmGuard from '../components/CrmGuard';
import Smsv2Sidebar from './Smsv2Sidebar';
import Smsv2StatusBar from './Smsv2StatusBar';
import ViewAsSelector from './ViewAsSelector';
import { ViewAsProvider, useViewAs, useResetViewAsForNonAdmin } from '../lib/ViewAsContext';
import Softphone from '../components/softphone/Softphone';
import { ActiveCallProvider } from '../components/live-call/ActiveCallContext';
import IncomingCallModal from '../components/live-call/IncomingCallModal';
import { SmsV2Provider } from '../store/SmsV2Store';
import GlobalToasts from '../store/GlobalToasts';
import { useHydrateContacts } from '../hooks/useHydrateContacts';
import { useHydratePipelineColumns } from '../hooks/useHydratePipelineColumns';
import FollowupBanner from '../components/followups/FollowupBanner';
import { DialerProModalProvider } from './DialerProModalContext';
import DialerProModal from './DialerProModal';

// Side-effect-only component: pumps real wk_contacts and wk_pipeline_columns
// into the store so every /smsv2 page reads live data with real UUIDs
// instead of mocks. Must live inside <SmsV2Provider>.
function StoreHydrator() {
  useHydrateContacts();
  useHydratePipelineColumns();
  return null;
}

// Thin amber strip while an admin is impersonating an agent, so it's never a
// surprise that the CRM is filtered. Rendered under the top bar.
function ViewAsBanner() {
  useResetViewAsForNonAdmin();
  const { viewAsId, viewAsName, setViewAs } = useViewAs();
  if (!viewAsId) return null;
  return (
    <div className="bg-[#FEF3C7] text-[#92400E] text-[12.5px] font-semibold px-5 py-1.5 flex items-center gap-2 border-b border-[#FDE68A] flex-shrink-0">
      <span>👁 Viewing the CRM as <b>{viewAsName || 'this agent'}</b> — you're seeing only their leads.</span>
      <button onClick={() => setViewAs(null, null)} className="ml-auto underline hover:no-underline">
        Back to everyone
      </button>
    </div>
  );
}

export default function Smsv2Layout() {
  // Start collapsed the first time, then remember the user's choice across
  // loads (localStorage). Default collapsed keeps the dialer clean out of the box.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('crm_sidebar_collapsed');
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('crm_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [sidebarCollapsed]);
  const { isAdmin } = useAuth();
  const location = useLocation();

  // The dialer room always OPENS with the rail shut. Hugo 2026-08-12: "the menu
  // on the left always starts minimized." The call room is the one page where
  // every pixel is script, house and coach, so arriving there folds the rail
  // away. It is only on arrival: he can still open it by hand and it stays open
  // while he is in the room.
  const onDialer = location.pathname.startsWith('/admin/crm/dialer');
  const wasOnDialer = useRef(false);
  useEffect(() => {
    if (onDialer && !wasOnDialer.current) setSidebarCollapsed(true);
    wasOnDialer.current = onDialer;
  }, [onDialer]);

  return (
    <CrmGuard>
      <SmsV2Provider>
      <ViewAsProvider>
        <StoreHydrator />
        <ActiveCallProvider>
          <DialerProModalProvider>
            <div
              data-feature="SMSV2__LAYOUT"
              /* h-dvh, not h-screen: on iOS Safari 100vh is taller than the
                 visible area (it assumes the address bar is hidden), so the
                 reply box sat below the fold on every phone. */
              className="h-dvh flex flex-col bg-[#F3F3EE]"
            >
              {/* Follow-up banner — above nav per Hugo */}
              <FollowupBanner />
              <ViewAsBanner />

              {/* Top bar */}
              <header className="h-14 bg-white border-b border-[#E5E7EB] flex items-center px-5 z-[101] flex-shrink-0 gap-3">
                <Link
                  to="/admin"
                  className="text-[17px] font-extrabold text-[#1A1A1A] tracking-tight hover:opacity-70 transition-opacity"
                >
                  Elsie
                </Link>
                <span className="text-sm font-medium text-[#9CA3AF]">CRM</span>

                <div className="ml-auto flex items-center gap-3">
                  <ViewAsSelector />
                  <Smsv2StatusBar />
                  {isAdmin && (
                    <Link
                      to="/admin"
                      className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors px-3 py-1.5 rounded-lg hover:bg-black/[0.04]"
                    >
                      <ArrowLeft className="w-4 h-4" strokeWidth={1.8} />
                      <span className="hidden sm:inline">Admin</span>
                    </Link>
                  )}
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      window.location.assign('/login');
                    }}
                    title="Sign out"
                    className="flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#B91C1C] transition-colors px-3 py-1.5 rounded-lg hover:bg-black/[0.04]"
                  >
                    <LogOut className="w-4 h-4" strokeWidth={1.8} />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                </div>
              </header>

              {/* Sidebar + main */}
              <div className="flex-1 flex overflow-hidden">
                <Smsv2Sidebar
                  collapsed={sidebarCollapsed}
                  onCollapse={setSidebarCollapsed}
                />
                <main className="flex-1 overflow-auto flex flex-col">
                  <div className="flex-1 overflow-auto">
                    {/* Per-route boundary: a page crash shows a recoverable
                        card here and keeps the header/sidebar/softphone alive
                        (no more whole-app blank screen). key resets it on nav. */}
                    <ErrorBoundary label={`page:${location.pathname}`} key={location.pathname}>
                      <Outlet />
                    </ErrorBoundary>
                  </div>
                </main>
              </div>

              {/* Softphone floating launcher — on EVERY page so agents can
                  free-dial from anywhere, including the dialer-pro room
                  (Hugo 2026-07-22: one room, softphone everywhere). Isolated in
                  its own boundary so a softphone throw can never blank a page. */}
              <ErrorBoundary label="softphone" silent>
                <Softphone />
              </ErrorBoundary>
              <DialerProModal />
              <IncomingCallModal />
              <GlobalToasts />
            </div>
          </DialerProModalProvider>
        </ActiveCallProvider>
      </ViewAsProvider>
      </SmsV2Provider>
    </CrmGuard>
  );
}
