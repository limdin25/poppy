import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { ArrowLeft, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import CrmGuard from '../components/CrmGuard';
import Smsv2Sidebar from './Smsv2Sidebar';
import Smsv2StatusBar from './Smsv2StatusBar';
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

export default function Smsv2Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const onDialerPage = useLocation().pathname === '/admin/crm/dialer-pro';
  const { isAdmin } = useAuth();

  return (
    <CrmGuard>
      <SmsV2Provider>
        <StoreHydrator />
        <ActiveCallProvider>
          <DialerProModalProvider>
            <div
              data-feature="SMSV2__LAYOUT"
              className="h-screen flex flex-col bg-[#F3F3EE]"
            >
              {/* Follow-up banner — above nav per Hugo */}
              <FollowupBanner />

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
                <Smsv2Sidebar collapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} />
                <main className="flex-1 overflow-auto flex flex-col">
                  <div className="flex-1 overflow-auto">
                    <Outlet />
                  </div>
                </main>
              </div>

              {/* Softphone hidden on /crm/dialer — CallerPad inside DialerPage handles it */}
              {!onDialerPage && <Softphone />}
              <DialerProModal />
              <IncomingCallModal />
              <GlobalToasts />
            </div>
          </DialerProModalProvider>
        </ActiveCallProvider>
      </SmsV2Provider>
    </CrmGuard>
  );
}
