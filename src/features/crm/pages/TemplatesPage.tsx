import { useState, useEffect } from 'react';
import { MessageSquare, Mail, FileText, Clapperboard } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import TemplateList from '../components/templates/TemplateList';
import AgreementTemplateList from '../components/templates/AgreementTemplateList';
import VideoTemplateList from '../components/templates/VideoTemplateList';
import WhatsAppMetaTemplates from '../components/templates/WhatsAppMetaTemplates';
import WhatsAppProfileCard from '../components/templates/WhatsAppProfileCard';

const TABS = [
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  // The video messages live in platform_settings, not wk_sms_templates — so
  // this page could never have listed them (Hugo 2026-07-27).
  { id: 'video', label: 'Video', icon: Clapperboard },
  { id: 'agreements', label: 'Agreements', icon: FileText },
  // The property deal process is NOT a tab here. Hugo 2026-08-12: "it should not
  // be inside the templates, it should be below the templates on the menu." It
  // lives at /admin/crm/deal-process.
] as const;

type TabId = (typeof TABS)[number]['id'];

const CARD = 'bg-white border border-[#E5E7EB] rounded-2xl p-5';

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

      {/* One card per thing (Hugo 2026-08-03). The WhatsApp tab holds three
          unrelated things with their own Save buttons; sharing a single box
          made it look like saving the profile also saved the templates. */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {activeTab === 'sms' && (
            <section className={CARD}>
              <TemplateList filterChannel="sms" isAdmin={isAdminOrWorkspaceAdmin} />
            </section>
          )}
          {activeTab === 'whatsapp' && (
            <>
              {/* The Meta sender is shared workspace infrastructure, so only
                  admins manage its templates + profile. */}
              {isAdminOrWorkspaceAdmin && <WhatsAppMetaTemplates />}
              {isAdminOrWorkspaceAdmin && <WhatsAppProfileCard />}
              <section className={CARD} data-testid="wa-quick-replies-card">
                <h2 className="text-[15px] font-bold text-[#1A1A1A] mb-1">Quick replies</h2>
                <p className="text-[11px] text-[#6B7280] leading-snug mb-3">
                  Your own saved wording, for replying inside the 24 hour window. These are
                  never seen by Meta and need no approval.
                </p>
                <TemplateList filterChannel="whatsapp" isAdmin={isAdminOrWorkspaceAdmin} />
              </section>
            </>
          )}
          {activeTab === 'email' && (
            <section className={CARD}>
              <TemplateList filterChannel="email" isAdmin={isAdminOrWorkspaceAdmin} />
            </section>
          )}
          {activeTab === 'video' && (
            <section className={CARD}>
              <VideoTemplateList isAdmin={isAdminOrWorkspaceAdmin} />
            </section>
          )}
          {activeTab === 'agreements' && (
            <section className={CARD}>
              <AgreementTemplateList isAdmin={isAdminOrWorkspaceAdmin} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
