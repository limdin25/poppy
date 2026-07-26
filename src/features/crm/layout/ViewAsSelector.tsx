// "See as: <agent>" nav-bar dropdown — ADMIN ONLY. Lets Hugo view the CRM as a
// specific agent sees it (their inbox today; more surfaces adopt
// useEffectiveAgentId over time). Selecting an agent scopes the agent-scoped
// hooks to that agent; "Everyone" restores the whole-workspace admin view.

import { useEffect, useRef, useState } from 'react';
import { Eye, ChevronDown, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useViewAs } from '@/features/crm/lib/ViewAsContext';

interface AgentOpt { id: string; name: string }

export default function ViewAsSelector() {
  const { isAdmin, loading } = useAuth();
  const { viewAsId, viewAsName, setViewAs } = useViewAs();
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Load the agent roster once, the first time the menu opens.
  useEffect(() => {
    if (!open || agents.length > 0) return;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, workspace_role')
        .in('workspace_role', ['agent', 'admin'])
        .order('name');
      setAgents(
        ((data ?? []) as Array<{ id: string; name: string | null }>)
          .map((p) => ({ id: p.id, name: (p.name || '').trim() || 'Unnamed agent' })),
      );
    })();
  }, [open, agents.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (loading || !isAdmin) return null;

  const impersonating = !!viewAsId;
  const label = impersonating ? (viewAsName || 'agent') : 'Everyone';

  const pick = (id: string | null, name: string | null) => {
    setViewAs(id, name);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="View the CRM as a specific agent"
        className={
          'flex items-center gap-1.5 text-[13px] font-medium px-2.5 py-1.5 rounded-lg transition-colors ' +
          (impersonating
            ? 'bg-[#FEF3C7] text-[#92400E] hover:bg-[#FDE68A]'
            : 'text-[#6B7280] hover:text-[#1A1A1A] hover:bg-black/[0.04]')
        }
      >
        <Eye className="w-4 h-4" strokeWidth={1.8} />
        <span className="hidden sm:inline">See as:</span>
        <span className="font-semibold max-w-[120px] truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 max-h-[60vh] overflow-y-auto bg-white border border-[#E5E7EB] rounded-xl shadow-lg py-1 z-[120]">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">
            View the CRM as
          </div>
          <button
            onClick={() => pick(null, null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-[#F3F3EE] text-left"
          >
            <span className="flex-1">Everyone <span className="text-[#9CA3AF]">(admin — see all)</span></span>
            {!impersonating && <Check className="w-4 h-4 text-[#3C5A87]" />}
          </button>
          <div className="my-1 border-t border-[#F0F0EC]" />
          {agents.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-[#9CA3AF] italic">Loading agents…</div>
          ) : (
            agents.map((a) => (
              <button
                key={a.id}
                onClick={() => pick(a.id, a.name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-[#F3F3EE] text-left"
              >
                <span className="flex-1 truncate">{a.name}</span>
                {viewAsId === a.id && <Check className="w-4 h-4 text-[#3C5A87]" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
