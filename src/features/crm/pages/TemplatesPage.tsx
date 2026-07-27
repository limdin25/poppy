import { useState, useEffect } from 'react';
import { MessageSquare, Mail, FileText, Clapperboard } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import TemplateList from '../components/templates/TemplateList';
import AgreementTemplateList from '../components/templates/AgreementTemplateList';
import VideoTemplateList from '../components/templates/VideoTemplateList';

const TABS = [
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  // The video messages live in platform_settings, not wk_sms_templates — so
  // this page could never have listed them (Hugo 2026-07-27).
  { id: 'video', label: 'Video', icon: Clapperboard },
  { id: 'agreements', label: 'Agreements', icon: FileText },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function TemplatesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('sms');
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [workspaceRole, setWorkspaceRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
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

  const isAdminOrWorkspaceAdmin =
    workspaceRole === 'admin' || (workspaceRole === null && isAdmin);

  return (
    <div className="h-full flex flex-col bg-[#F3F3EE]">
      <div className="bg-white border-b border-[#E5E7EB] px-6 py-4">
        <h1 className="text-[20px] font-bold text-[#1A1A1A]">Templates</h1>
        <p className="text-[12px] text-[#6B7280] mt-0.5">
          Manage your SMS, WhatsApp, Email, and Agreement templates.
          {isAdminOrWorkspaceAdmin
            ? ' As an admin, you can edit global templates.'
            : ' Create personal templates or use global ones.'}
        </p>
      </div>

      <div className="flex border-b border-[#E5E7EB] bg-white px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors',
                active
                  ? 'border-[#3C5A87] text-[#3C5A87]'
                  : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-5">
          {activeTab === 'sms' && (
            <TemplateList filterChannel="sms" isAdmin={isAdminOrWorkspaceAdmin} />
          )}
          {activeTab === 'whatsapp' && (
            <TemplateList filterChannel="whatsapp" isAdmin={isAdminOrWorkspaceAdmin} />
          )}
          {activeTab === 'email' && (
            <TemplateList filterChannel="email" isAdmin={isAdminOrWorkspaceAdmin} />
          )}
          {activeTab === 'video' && (
            <VideoTemplateList isAdmin={isAdminOrWorkspaceAdmin} />
          )}
          {activeTab === 'agreements' && (
            <AgreementTemplateList isAdmin={isAdminOrWorkspaceAdmin} />
          )}
        </div>
      </div>
    </div>
  );
}
