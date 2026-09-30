import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Settings2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '../lib/useCrmAuth';
import { useResetViewAsForNonAdmin } from '../lib/ViewAsContext';
import CallbackBanner from '../components/followups/CallbackBanner';
import FollowupBanner from '../components/followups/FollowupBanner';
import DeskToggle from './DeskToggle';
import ViewAsSelector from './ViewAsSelector';
import Smsv2StatusBar from './Smsv2StatusBar';

export default function HostunicoCallHeader() {
  useResetViewAsForNonAdmin();
  const { isAdmin } = useAuth();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current) menu.current.open = false; };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, []);
  return <header data-testid="hostunico-crm-toolbar" className="relative z-[101] flex h-11 shrink-0 items-center gap-2 border-b bg-white px-2 sm:px-3">
    <Link to="/admin/crm/dialer-pro?script=sa_call" className="shrink-0 text-sm font-extrabold tracking-tight">Hostunico</Link>
    <div className="shrink-0 [&_button]:text-xs [&_button]:px-1.5"><ViewAsSelector /></div>
    <CallbackBanner compact />
    <FollowupBanner compact />
    <details ref={menu} className="relative shrink-0">
      <summary aria-label="CRM controls" title="CRM controls" className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2 text-xs font-medium hover:bg-slate-50 [&::-webkit-details-marker]:hidden"><Settings2 size={15} /><span className="hidden sm:inline">Controls</span></summary>
      <div className="absolute right-0 top-full z-[190] mt-2 w-[min(580px,92vw)] space-y-3 rounded-xl border bg-white p-3 shadow-xl">
        <div className="flex items-center justify-between gap-3"><DeskToggle /><Link to="/admin/crm/report-followups" className="text-xs font-medium text-blue-700">Report follow-ups</Link></div>
        {/* Keep the status hooks mounted while the controls are folded. */}
        <div className="[&>div]:flex-wrap [&>div]:rounded-lg"><Smsv2StatusBar /></div>
        <div className="flex items-center justify-end gap-4 border-t pt-2">
          {isAdmin && <Link to="/admin" className="text-xs text-slate-600">Admin</Link>}
          <button onClick={async () => { await supabase.auth.signOut(); window.location.assign('/login'); }} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-700"><LogOut size={14} />Sign out</button>
        </div>
      </div>
    </details>
  </header>;
}
