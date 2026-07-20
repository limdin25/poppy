import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Kanban,
  MessageSquare,
  Megaphone,
  Users,
  Phone,
  Bot,
  Activity,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Sparkles,
  Clock,
  PhoneMissed,
  X,
  Voicemail,
  Ban,
  Key,
  KeyRound,
  LogOut,
  Eye,
  EyeOff,
  Mail,
  FileText,
  Radio,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { cn } from '@/core/lib/cn';
import { ACTIVE_PIPELINE } from '../data/mockPipelines';
import { COACH_PROMPTS } from '../data/mockCampaigns';
import { formatPence } from '../data/helpers';
import { useKillSwitch } from '../hooks/useKillSwitch';
import { useAiSettings } from '../hooks/useAiSettings';
import { useDialerCampaigns } from '../hooks/useDialerCampaigns';
import { usePipelines } from '../hooks/usePipelines';
import { useDefaultCallScript } from '../hooks/useDefaultCallScript';
import { useAgentScript } from '../hooks/useAgentScript';
import { useSmsTemplates } from '../hooks/useSmsTemplates';
import { useTerminologies, type Terminology } from '../hooks/useTerminologies';
import { useCoachFacts, type CoachFact } from '../hooks/useCoachFacts';
import { useCampaignAgents } from '../hooks/useCampaignAgents';
import { useCampaignNumbers, type CampaignNumber } from '../hooks/useCampaignNumbers';
import { useAgentsToday } from '../hooks/useAgentsToday';
import BulkUploadModal from '../components/contacts/BulkUploadModal';
import { useTwilioAccount } from '../hooks/useTwilioAccount';
import { useColumnPersistence } from '../hooks/useColumnPersistence';
import ChannelsTab from '../components/settings/ChannelsTab';
import { useSmsV2 } from '../store/SmsV2Store';
import type { Agent, PipelineColumn } from '../types';

// The Campaign type in ../types predates the real wk_dialer_campaigns
// mapper (useDialerCampaigns.rowToCampaign), which sets `isActive` from
// the DB `is_active` column. The interface was never updated to declare
// it. Augment it here so code and the true runtime shape agree without
// casting. (Settings toggles is_active via the pause/resume controls.)
declare module '../types' {
  interface Campaign {
    isActive: boolean;
  }
}

interface CreateAgentInvoke {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    data: {
      user_id?: string;
      email?: string;
      role?: string;
      extension?: string | null;
      daily_limit_pence?: number;
      error?: string;
    } | null;
    error: { message: string } | null;
  }>;
}

// PR (Hugo 2026-04-28): typed invoke for wk-delete-agent — admin
// soft-deletes an agent (clears workspace_role, hides from leaderboard,
// re-pools their queue rows + assignments, drops campaign_agents links).
interface DeleteAgentInvoke {
  invoke: (
    name: string,
    options: { body: Record<string, unknown> }
  ) => Promise<{
    data: {
      agent_id?: string;
      email?: string;
      mode?: string;
      ok?: boolean;
      error?: string;
    } | null;
    error: { message: string } | null;
  }>;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Clock,
  PhoneMissed,
  X,
  Voicemail,
  Ban,
};

const COLOUR_PALETTE = [
  '#3C5A87', '#F59E0B', '#3B82F6', '#EF4444',
  '#9CA3AF', '#525252', '#8B5CF6', '#EC4899',
];

// PR 56: a tiny inline pill that reflects whether a field is
// inheriting a workspace default ('inherited') or has a per-campaign
// override ('override'). When the user is in workspace mode the
// badge is hidden. When the user has overridden a field in campaign
// mode, the badge shows a "↺" reset action that clears the override.
function ScopeBadge({
  source,
  campaignId,
  onReset,
}: {
  source: 'workspace' | 'campaign' | undefined;
  campaignId: string | null;
  onReset?: () => void;
}) {
  if (!campaignId) return null;
  if (source === 'campaign') {
    return (
      <span className="inline-flex items-center gap-1 ml-2 text-[9px] uppercase font-bold tracking-wide text-[#3C5A87] bg-[#EEF2F8] px-1.5 py-0.5 rounded">
        override
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="hover:text-[#283C5C]"
            title="Clear override + fall back to workspace default"
          >
            ↺
          </button>
        )}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center ml-2 text-[9px] uppercase font-bold tracking-wide text-[#9CA3AF] bg-[#F3F3EE] px-1.5 py-0.5 rounded"
      title="Inherited from workspace default — edit to create a campaign override"
    >
      inherited
    </span>
  );
}

// ChannelBadge extracted to ../components/templates/ChannelBadge.tsx

// PR 62 (Hugo 2026-04-27): scope = which "container" the user is editing.
//   - 'workspace'         → workspace defaults (the master template)
//   - 'campaign:<uuid>'   → a specific campaign's overrides + bundle
//   - 'workspace-only:<id>' → workspace-level only (Agents, Numbers,
//                              Pacing, Kill switches — no campaign override)
type Scope =
  | { kind: 'workspace' }
  | { kind: 'campaign'; campaignId: string }
  | { kind: 'workspace-only'; tabId: 'agents' | 'numbers' | 'channels' | 'pacing' | 'kill' };

const WORKSPACE_BUNDLE_TABS = [
  { id: 'pipelines', label: 'Pipeline & outcomes', icon: Kanban },
  { id: 'templates', label: 'Templates (SMS / WA / Email)', icon: MessageSquare },
  { id: 'ai', label: 'AI Coach', icon: Bot },
] as const;

const CAMPAIGN_BUNDLE_TABS = [
  { id: 'overview', label: 'Overview', icon: Megaphone },
  { id: 'pipelines', label: 'Pipeline', icon: Kanban },
  { id: 'templates', label: 'Templates (SMS / WA / Email)', icon: MessageSquare },
  { id: 'ai', label: 'AI Coach', icon: Bot },
  { id: 'agents', label: 'Assigned agents', icon: Users },
  { id: 'numbers', label: 'Assigned channels (SMS/WA/Email)', icon: Phone },
  { id: 'leads', label: 'Upload leads (CSV)', icon: Plus },
] as const;

const WORKSPACE_ONLY_TABS = [
  { id: 'agents' as const, label: 'Agents & spend', icon: Users },
  { id: 'numbers' as const, label: 'Numbers (workspace pool)', icon: Phone },
  { id: 'channels' as const, label: 'Channels (WhatsApp / Email)', icon: Radio },
  // PR 111 (Hugo 2026-04-28): "Pacing & safety" tab hidden from sidebar.
  // The PacingTab component is a stub (disabled inputs, nothing saves).
  // Component kept for future implementation; entry removed so agents
  // don't click into a dead-end. Re-add this line when pacing is real.
  // { id: 'pacing' as const, label: 'Pacing & safety', icon: Shield },
  { id: 'kill' as const, label: 'Kill switches & audit', icon: Activity },
];

export default function SettingsPage() {
  // PR 110 (Hugo 2026-04-28): scope + tab live in the URL so a browser
  // tab switch (or refresh, or share-link) preserves where the agent
  // was. Falls back to workspace + overview defaults on first visit.
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = useMemo<Scope>(() => {
    const kind = searchParams.get('scope') ?? 'workspace';
    if (kind === 'campaign') {
      const campaignId = searchParams.get('campaignId') ?? '';
      if (campaignId) return { kind: 'campaign', campaignId };
    }
    if (kind === 'workspace-only') {
      const tabId = (searchParams.get('section') ?? 'agents') as
        | 'agents' | 'numbers' | 'channels' | 'pacing' | 'kill';
      return { kind: 'workspace-only', tabId };
    }
    return { kind: 'workspace' };
  }, [searchParams]);
  const bundleTab = searchParams.get('tab') ?? (scope.kind === 'campaign' ? 'overview' : 'pipelines');

  const setScope = (next: Scope) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('scope', next.kind);
    if (next.kind === 'campaign') sp.set('campaignId', next.campaignId);
    else sp.delete('campaignId');
    if (next.kind === 'workspace-only') sp.set('section', next.tabId);
    else sp.delete('section');
    sp.set('tab', next.kind === 'campaign' ? 'overview' : 'pipelines');
    setSearchParams(sp, { replace: false });
  };
  const setBundleTab = (tab: string) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', tab);
    setSearchParams(sp, { replace: false });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="mb-5">
        <h1 className="text-[26px] font-bold text-[#1A1A1A] tracking-tight">Settings</h1>
        <p className="text-[13px] text-[#6B7280]">
          Nothing in the agent UI is hardcoded — everything below is editable here
        </p>
      </header>

      <div className="grid grid-cols-12 gap-5">
        <SettingsSidebar scope={scope} onScopeChange={setScope} />
        <main className="col-span-12 lg:col-span-9">
          {scope.kind === 'workspace' && (
            <WorkspaceBundle
              tab={bundleTab}
              onTabChange={setBundleTab}
            />
          )}
          {scope.kind === 'campaign' && (
            <CampaignBundle
              campaignId={scope.campaignId}
              tab={bundleTab}
              onTabChange={setBundleTab}
              onCampaignDeleted={() => setScope({ kind: 'workspace' })}
            />
          )}
          {scope.kind === 'workspace-only' && (
            <>
              {scope.tabId === 'agents' && <AgentsTab />}
              {scope.tabId === 'numbers' && <NumbersTab />}
              {scope.tabId === 'channels' && <ChannelsTab />}
              {scope.tabId === 'pacing' && <PacingTab />}
              {scope.tabId === 'kill' && <KillTab />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Sidebar (campaign-first, PR 62) ───────────────────────────────────
function SettingsSidebar({
  scope,
  onScopeChange,
}: {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
}) {
  // Always read all campaigns including inactive — admin needs to see
  // what they just created.
  const { campaigns, refetch } = useDialerCampaigns({ includeInactive: true });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);

  const create = async () => {
    setCreateErr(null);
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_dialer_campaigns' as any) as any)
        .insert({
          name: newName.trim(),
          parallel_lines: 3,
          auto_advance_seconds: 10,
          ai_coach_enabled: true,
          is_active: true,
        })
        .select('id')
        .single();
      if (error) {
        setCreateErr(error.message);
        return;
      }
      setNewName('');
      refetch();
      if (data?.id) onScopeChange({ kind: 'campaign', campaignId: data.id as string });
    } finally {
      setCreating(false);
    }
  };

  const isWorkspace = scope.kind === 'workspace';
  return (
    <nav className="col-span-12 lg:col-span-3 space-y-3">
      {/* Workspace defaults */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-bold px-2 mb-1">
          Workspace defaults
        </div>
        <button
          onClick={() => onScopeChange({ kind: 'workspace' })}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] text-left transition-colors',
            isWorkspace
              ? 'bg-white border border-[#E5E7EB] text-[#3C5A87] font-semibold shadow-sm'
              : 'text-[#6B7280] hover:bg-white/50'
          )}
        >
          <Settings className="w-4 h-4" strokeWidth={1.8} />
          ★ Master template
        </button>
      </div>

      {/* Campaigns list */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-bold px-2 mb-1">
          Campaigns
        </div>
        {campaigns.map((c) => {
          const isSelected = scope.kind === 'campaign' && scope.campaignId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onScopeChange({ kind: 'campaign', campaignId: c.id })}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] text-left transition-colors',
                isSelected
                  ? 'bg-white border border-[#E5E7EB] text-[#3C5A87] font-semibold shadow-sm'
                  : 'text-[#6B7280] hover:bg-white/50'
              )}
            >
              <Megaphone className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
              <span className="flex-1 truncate">{c.name}</span>
              {!c.isActive && (
                <span className="text-[9px] text-[#B45309] bg-[#FEF3C7] px-1 rounded">paused</span>
              )}
            </button>
          );
        })}
        {/* Create new campaign */}
        <div className="flex gap-1.5 mt-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            placeholder="New campaign…"
            className="flex-1 px-2 py-1.5 text-[12px] bg-white border border-[#E5E7EB] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/40"
          />
          <button
            onClick={() => void create()}
            disabled={creating || !newName.trim()}
            className="bg-[#3C5A87] text-white text-[11px] font-semibold px-2 py-1.5 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            {creating ? '…' : '+'}
          </button>
        </div>
        {createErr && (
          <div className="text-[10px] text-[#B91C1C] px-2">{createErr}</div>
        )}
      </div>

      {/* Workspace-only */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-bold px-2 mb-1">
          Workspace-only
        </div>
        {WORKSPACE_ONLY_TABS.map((t) => {
          const isSelected = scope.kind === 'workspace-only' && scope.tabId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onScopeChange({ kind: 'workspace-only', tabId: t.id })}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] text-left transition-colors',
                isSelected
                  ? 'bg-white border border-[#E5E7EB] text-[#3C5A87] font-semibold shadow-sm'
                  : 'text-[#6B7280] hover:bg-white/50'
              )}
            >
              <t.icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─── Workspace Bundle: master template view (PR 62) ───────────────────
function WorkspaceBundle({ tab, onTabChange }: { tab: string; onTabChange: (t: string) => void }) {
  // Default to first tab if invalid
  const validTab = WORKSPACE_BUNDLE_TABS.some((t) => t.id === tab) ? tab : 'pipelines';
  return (
    <>
      <div className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-3 mb-3">
        <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-bold mb-1">
          ★ Workspace defaults
        </div>
        <div className="text-[14px] font-semibold text-[#1A1A1A]">Master template</div>
        <div className="text-[11px] text-[#6B7280]">
          Every campaign inherits these defaults until you override a specific item inside that campaign.
        </div>
      </div>
      <div className="flex gap-1 mb-3 overflow-x-auto">
        {WORKSPACE_BUNDLE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-medium whitespace-nowrap transition-colors',
              validTab === t.id
                ? 'bg-white border border-[#E5E7EB] text-[#3C5A87] shadow-sm'
                : 'text-[#6B7280] hover:bg-white/50'
            )}
          >
            <t.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t.label}
          </button>
        ))}
      </div>
      {validTab === 'pipelines' && <PipelinesTab campaignId={null} />}
      {validTab === 'templates' && <TemplatesTab />}
      {validTab === 'ai' && <UnifiedCoachTab campaignId={null} />}
    </>
  );
}

// ─── Campaign Bundle: ONE screen with everything for a campaign (PR 62) ─
function CampaignBundle({
  campaignId,
  tab,
  onTabChange,
  onCampaignDeleted,
}: {
  campaignId: string;
  tab: string;
  onTabChange: (t: string) => void;
  onCampaignDeleted: () => void;
}) {
  const { campaigns, refetch } = useDialerCampaigns({ includeInactive: true });
  const camp = campaigns.find((c) => c.id === campaignId);
  const validTab = CAMPAIGN_BUNDLE_TABS.some((t) => t.id === tab) ? tab : 'overview';

  if (!camp) {
    return (
      <div className="p-6 text-center text-[#9CA3AF] italic">
        Campaign not found. Pick another from the sidebar.
      </div>
    );
  }

  return (
    <>
      <CampaignBundleHeader
        campaign={camp}
        onChanged={refetch}
        onSelected={(id) => { void id; }}
        onScopeReset={onCampaignDeleted}
      />
      <div className="flex gap-1 mb-3 overflow-x-auto">
        {CAMPAIGN_BUNDLE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-medium whitespace-nowrap transition-colors',
              validTab === t.id
                ? 'bg-white border border-[#E5E7EB] text-[#3C5A87] shadow-sm'
                : 'text-[#6B7280] hover:bg-white/50'
            )}
          >
            <t.icon className="w-3.5 h-3.5" strokeWidth={1.8} />
            {t.label}
          </button>
        ))}
      </div>
      {validTab === 'overview' && <CampaignOverviewTab campaignId={campaignId} />}
      {validTab === 'pipelines' && <PipelinesTab campaignId={campaignId} />}
      {validTab === 'templates' && <TemplatesTab campaignId={campaignId} />}
      {validTab === 'ai' && <UnifiedCoachTab campaignId={campaignId} />}
      {validTab === 'agents' && <CampaignAgentsPanelStandalone campaignId={campaignId} />}
      {validTab === 'numbers' && <CampaignNumbersPanelStandalone campaignId={campaignId} />}
      {validTab === 'leads' && <CampaignLeadsCsvPanel campaignId={campaignId} campaignName={camp.name} />}
    </>
  );
}

// Header for the campaign bundle — name + active toggle + duplicate + delete.
function CampaignBundleHeader({
  campaign,
  onChanged,
  onSelected,
  onScopeReset,
}: {
  campaign: {
    id: string;
    name: string;
    isActive: boolean;
    aiCoachEnabled: boolean;
    parallelLines: number;
    totalLeads: number;
    voicemailRecordingUrl?: string | null;
    voicemailDropEnabled?: boolean;
  };
  onChanged: () => void;
  onSelected: (id: string) => void;
  onScopeReset: () => void;
}) {
  const [actionErr, setActionErr] = useState<string | null>(null);

  const patch = async (p: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_dialer_campaigns' as any) as any)
      .update(p)
      .eq('id', campaign.id);
    if (error) setActionErr(error.message);
    else onChanged();
  };

  const duplicate = async () => {
    const newName = window.prompt(`Duplicate "${campaign.name}" — name for the copy?`, `${campaign.name} (copy)`);
    if (!newName?.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('wk_duplicate_campaign', {
      p_source_id: campaign.id,
      p_new_name: newName.trim(),
    });
    if (error) setActionErr(error.message);
    else {
      onChanged();
      if (typeof data === 'string') onSelected(data);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${campaign.name}"?\nThis removes the campaign + its bundle (AI overrides, facts, glossary, agent + number assignments, SMS templates). Queue rows are deleted via ON DELETE CASCADE.`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_dialer_campaigns' as any) as any)
      .delete()
      .eq('id', campaign.id);
    if (error) {
      setActionErr(error.message);
      return;
    }
    // PR 115 (Hugo 2026-04-28): after delete, navigate the URL back to
    // workspace scope so the user isn't staring at "Campaign not found"
    // on the deleted campaign + the sidebar list updates immediately
    // (the realtime DELETE event sometimes lags up to 500ms; this gives
    // an instant UI flip).
    onChanged();
    onScopeReset();
  };

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl px-5 py-3 mb-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-bold mb-0.5">
            Campaign
          </div>
          <div className="text-[16px] font-bold text-[#1A1A1A] truncate">{campaign.name}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void patch({ is_active: !campaign.isActive })}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border',
              campaign.isActive
                ? 'bg-[#EEF2F8] text-[#3C5A87] border-[#3C5A87]/30'
                : 'bg-[#FEF3C7] text-[#B45309] border-[#F59E0B]/30'
            )}
          >
            {campaign.isActive ? '🟢 Active' : '⏸ Paused'}
          </button>
          <button
            onClick={() => void patch({ ai_coach_enabled: !campaign.aiCoachEnabled })}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border',
              campaign.aiCoachEnabled
                ? 'bg-[#EEF2F8] text-[#3C5A87] border-[#3C5A87]/30'
                : 'bg-[#F3F3EE] text-[#9CA3AF] border-[#E5E7EB]'
            )}
          >
            <Bot className="w-3 h-3" /> Coach: {campaign.aiCoachEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => void patch({ voicemail_drop_enabled: !campaign.voicemailDropEnabled })}
            disabled={!campaign.voicemailRecordingUrl}
            title={
              campaign.voicemailRecordingUrl
                ? 'Voicemail drop on the speed dialer — agents get a Drop VM button on live calls'
                : 'Upload a voicemail recording first (Leads tab) to enable the drop'
            }
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border',
              !campaign.voicemailRecordingUrl
                ? 'bg-[#F3F3EE] text-[#9CA3AF] border-[#E5E7EB] cursor-not-allowed'
                : campaign.voicemailDropEnabled
                  ? 'bg-[#EEF2F8] text-[#3C5A87] border-[#3C5A87]/30'
                  : 'bg-[#F3F3EE] text-[#9CA3AF] border-[#E5E7EB]'
            )}
          >
            <Voicemail className="w-3 h-3" /> Drop VM: {campaign.voicemailDropEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => void duplicate()}
            className="text-[11px] text-[#1A1A1A] border border-[#E5E7EB] hover:bg-[#F3F3EE] px-3 py-1 rounded-[8px]"
          >
            Duplicate
          </button>
          <button
            onClick={() => void remove()}
            className="text-[11px] text-[#EF4444] hover:bg-[#FEE2E2] px-3 py-1 rounded-[8px]"
          >
            Delete
          </button>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-[#6B7280]">
        {campaign.parallelLines} parallel lines · {campaign.totalLeads} leads in queue
      </div>
      {actionErr && (
        <div className="mt-2 text-[11px] text-[#B91C1C]">⚠ {actionErr}</div>
      )}
    </div>
  );
}

function CampaignOverviewTab({ campaignId }: { campaignId: string }) {
  const { campaigns, refetch } = useDialerCampaigns({ includeInactive: true });
  const camp = campaigns.find((c) => c.id === campaignId);
  const { pipelines } = usePipelines();

  if (!camp) return null;
  return (
    <Card title="Settings" hint="Per-campaign defaults that the dialer uses on Start">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Pipeline</Label>
          <select
            value={camp.pipelineId || ''}
            onChange={async (e) => {
              const next = e.target.value || null;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('wk_dialer_campaigns' as any) as any)
                .update({ pipeline_id: next })
                .eq('id', campaignId);
              refetch();
            }}
            className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[8px] bg-white"
          >
            <option value="">— none —</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="text-[11px] text-[#6B7280] mt-1">
            Outcome buttons + queue routing on the dialer use this pipeline's columns.
          </div>
        </div>
        <div>
          <Label>Parallel lines (1–5)</Label>
          <input
            type="number"
            min={1}
            max={5}
            defaultValue={camp.parallelLines}
            onBlur={async (e) => {
              const n = Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 1));
              if (n === camp.parallelLines) return;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('wk_dialer_campaigns' as any) as any)
                .update({ parallel_lines: n }).eq('id', campaignId);
              refetch();
            }}
            className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[8px] tabular-nums bg-white"
          />
        </div>
        <div>
          <Label>Auto-advance (seconds)</Label>
          <input
            type="number"
            min={1}
            defaultValue={camp.autoAdvanceSeconds}
            onBlur={async (e) => {
              const n = Math.max(1, parseInt(e.target.value, 10) || 10);
              if (n === camp.autoAdvanceSeconds) return;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase.from('wk_dialer_campaigns' as any) as any)
                .update({ auto_advance_seconds: n }).eq('id', campaignId);
              refetch();
            }}
            className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[8px] tabular-nums bg-white"
          />
        </div>
      </div>
    </Card>
  );
}

// Standalone wrappers around the existing CampaignAgentsPanel /
// CampaignNumbersPanel functions so they can render as full tabs in
// the campaign bundle.
function CampaignAgentsPanelStandalone({ campaignId }: { campaignId: string }) {
  return (
    <Card title="Assigned agents" hint="Only these agents can dial this campaign. None assigned = anyone with workspace access.">
      <CampaignAgentsPanel campaignId={campaignId} />
    </Card>
  );
}

function CampaignNumbersPanelStandalone({ campaignId }: { campaignId: string }) {
  return (
    <Card title="Assigned channels" hint="Pin SMS / WhatsApp / Email channels to this campaign. Dialer + senders use the first active channel of the matching kind. None pinned = falls back to the workspace pool.">
      <CampaignNumbersPanel campaignId={campaignId} />
    </Card>
  );
}

// PR 62: CSV upload of leads, scoped to a campaign. Reuses the existing
// BulkUploadModal but locks the campaign picker so the admin can't
// accidentally upload to the wrong campaign.
function CampaignLeadsCsvPanel({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Upload leads" hint={`CSV → wk_contacts + wk_dialer_queue rows pinned to "${campaignName}"`}>
      <div className="space-y-3">
        <div className="text-[12px] text-[#6B7280] leading-relaxed">
          Upload a CSV of leads (phone number, optional name + custom fields).
          Each row becomes a contact + a queue entry pinned to <strong className="text-[#1A1A1A]">{campaignName}</strong>.
          Agents on this campaign immediately see them in the dialer queue.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setOpen(true)}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Upload CSV
          </button>
          {/* PR 110 (Hugo 2026-04-28): "Download CSV template" so the agent
              gets the exact header row + an example. Browser-side blob, no
              server hit. */}
          <button
            onClick={() => {
              const csv =
                'name,phone,email,property_address,property_url,company,notes\n' +
                'Jane Doe,+447700900001,jane@example.com,12 Acacia Avenue London W1 5AB,https://www.rightmove.co.uk/properties/123,Acme Lettings,Knows the area\n' +
                'John Smith,023 8210 9587,,5 High Street Manchester M1 1AA,https://example.com/listing/456,,\n';
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'elsie-leads-template.csv';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="bg-white border border-[#E5E7EB] text-[#1A1A1A] text-[12px] font-medium px-4 py-2 rounded-[10px] hover:bg-[#F3F3EE] inline-flex items-center gap-1.5"
            title="Download a template CSV with the right headers + an example row"
          >
            ↓ Download template
          </button>
        </div>
        <div className="text-[10px] text-[#9CA3AF]">
          Accepted columns (case-insensitive):{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">phone</code> /{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">mobile</code> /{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">number</code> + optional{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">name</code>,{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">email</code>,{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">property_address</code> (also accepts{' '}
          <em>address</em>, <em>street_address</em>, <em>location</em>),{' '}
          <code className="bg-[#F3F3EE] px-1 rounded">property_url</code> (also accepts{' '}
          <em>url</em>, <em>website</em>, <em>link</em>, <em>listing_url</em>).
          Anything else is stored as a custom field under its column name.
          <br />
          The pipeline + initial stage selectors appear after you pick a file.
        </div>
      </div>
      <BulkUploadModal
        open={open}
        onClose={() => setOpen(false)}
        prefillCampaignId={campaignId}
        lockCampaign
      />
    </Card>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1A1A1A]">{title}</h3>
        {hint && <span className="text-[11px] text-[#9CA3AF]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Pipelines tab — fully editable ────────────────────────────────

const SETTINGS_PIPELINES_LS_KEY = 'crm_settings_pipelines_selected_id';

function PipelinesTab({ campaignId }: { campaignId: string | null }) {
  const { columns: allCols, patchColumn, upsertColumn, removeColumn } = useSmsV2();
  const persist = useColumnPersistence();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { campaigns } = useDialerCampaigns({ includeInactive: true });

  // Pipeline picker — uses the shared usePipelines() hook so this tab
  // benefits from the same TanStack Query cache used by /crm/pipelines
  // and the BulkUploadModal. Stops the modal-open / tab-switch hang.
  const { pipelines } = usePipelines();
  const campaignPipelineId = useMemo(() => {
    if (!campaignId) return null;
    const c = campaigns.find((c) => c.id === campaignId);
    return c?.pipelineId || null;
  }, [campaigns, campaignId]);
  const [pickedPipelineId, setPickedPipelineId] = useState<string>('');

  // Resolve the active pipeline: campaign-locked > localStorage > first.
  const activePipelineId = useMemo(() => {
    if (campaignPipelineId) return campaignPipelineId;
    if (pickedPipelineId) return pickedPipelineId;
    const stored = typeof window !== 'undefined'
      ? localStorage.getItem(SETTINGS_PIPELINES_LS_KEY)
      : null;
    if (stored && pipelines.some((p) => p.id === stored)) return stored;
    return pipelines[0]?.id ?? null;
  }, [campaignPipelineId, pickedPipelineId, pipelines]);

  const onPickPipeline = (id: string) => {
    setPickedPipelineId(id);
    try { localStorage.setItem(SETTINGS_PIPELINES_LS_KEY, id); } catch { /* ignore */ }
  };

  // Only show columns for the active pipeline. Falls back to everything
  // if we haven't resolved yet (transient).
  const cols = useMemo(() => {
    if (!activePipelineId) return allCols;
    return allCols.filter((c) => c.pipelineId === activePipelineId);
  }, [allCols, activePipelineId]);

  const activePipelineName = pipelines.find((p) => p.id === activePipelineId)?.name ?? '—';
  // PR 90: real templates from wk_sms_templates (was iterating MOCK_TEMPLATES,
  // so admin couldn't see actual templates in the stage-automation dropdown).
  const { items: realTemplates } = useSmsTemplates();
  // v17: load all coach profiles for the per-column profile dropdown.
  const [allProfiles, setAllProfiles] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_coach_profiles' as any) as any)
        .select('id, name')
        .order('name', { ascending: true });
      if (data) setAllProfiles(data as { id: string; name: string }[]);
    })();
  }, []);

  // PR 84: every store mutation also persists to wk_pipeline_columns +
  // wk_pipeline_automations so changes survive a refresh. Previously the
  // tab was local-only — Hugo's stages reverted on reload.
  const update = (id: string, patch: Partial<PipelineColumn>) => {
    patchColumn(id, patch);
    void persist.updateColumn(id, patch);
  };
  const updateAuto = (id: string, patch: Partial<PipelineColumn['automation']>) => {
    const target = cols.find((c) => c.id === id);
    if (!target) return;
    patchColumn(id, { automation: { ...target.automation, ...patch } });
    void persist.updateAutomation(id, patch);
  };

  // PR 116 (Hugo 2026-04-28): real HTML5 drag-and-drop. PR 115's arrows
  // were too clunky — Hugo wants to drag rows. Swap-on-drop via row
  // index. Each row gets draggable + onDragStart/Over/Drop. Reorder
  // happens on drop, persists both swap positions.
  const [draggedColId, setDraggedColId] = useState<string | null>(null);

  const moveColumn = async (idx: number, dir: -1 | 1) => {
    const sorted = [...cols].sort((a, b) => a.position - b.position);
    const a = sorted[idx];
    const b = sorted[idx + dir];
    if (!a || !b) return;
    patchColumn(a.id, { position: b.position });
    patchColumn(b.id, { position: a.position });
    await Promise.all([
      persist.updateColumn(a.id, { position: b.position }),
      persist.updateColumn(b.id, { position: a.position }),
    ]);
  };

  const dropOnRow = async (targetId: string) => {
    if (!draggedColId || draggedColId === targetId) {
      setDraggedColId(null);
      return;
    }
    const sorted = [...cols].sort((a, b) => a.position - b.position);
    const fromIdx = sorted.findIndex((c) => c.id === draggedColId);
    const toIdx = sorted.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedColId(null);
      return;
    }
    // Re-order: pull dragged out, splice at target index.
    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    // Re-number positions sequentially (1..N) and persist.
    setDraggedColId(null);
    await Promise.all(
      reordered.map((c, i) => {
        const newPos = i + 1;
        if (c.position === newPos) return Promise.resolve(true);
        patchColumn(c.id, { position: newPos });
        return persist.updateColumn(c.id, { position: newPos });
      })
    );
  };

  const addColumn = async () => {
    const tempId = `col-new-${Date.now()}`;
    const realPipelineId = activePipelineId ?? cols[0]?.pipelineId ?? ACTIVE_PIPELINE.id;
    const draft: PipelineColumn = {
      id: tempId,
      pipelineId: realPipelineId,
      name: 'New stage',
      colour: COLOUR_PALETTE[cols.length % COLOUR_PALETTE.length],
      icon: 'Sparkles',
      position: cols.length + 1,
      automation: {
        sendSms: false,
        createTask: false,
        retryDial: false,
        addTag: false,
      },
    };
    upsertColumn(draft); // optimistic local insert
    setExpandedId(tempId);
    // Persist + replace tempId with the real UUID so future edits hit
    // the right row.
    const newId = await persist.insertColumn(draft);
    if (newId) {
      removeColumn(tempId);
      upsertColumn({ ...draft, id: newId });
      setExpandedId(newId);
    }
  };
  const remove = (id: string) => {
    removeColumn(id);
    if (expandedId === id) setExpandedId(null);
    void persist.deleteColumn(id);
  };
  const setTimeoutDefault = (id: string, checked: boolean) => {
    cols.forEach((c) => {
      const shouldBe = c.id === id ? checked : false;
      if ((c.isDefaultOnTimeout ?? false) !== shouldBe) {
        patchColumn(c.id, { isDefaultOnTimeout: shouldBe });
        void persist.updateColumn(c.id, { isDefaultOnTimeout: shouldBe });
      }
    });
  };

  return (
    <>
      <Card
        title="Pipeline"
        hint={campaignPipelineId
          ? `Locked to "${activePipelineName}" — change it on the Overview tab to switch this campaign to a different pipeline.`
          : 'Choose which pipeline you are editing. Only this pipeline\'s columns appear below.'}
      >
        <select
          value={activePipelineId ?? ''}
          onChange={(e) => onPickPipeline(e.target.value)}
          disabled={!!campaignPipelineId}
          className="w-full max-w-md px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white disabled:bg-[#F3F3EE] disabled:text-[#6B7280]"
        >
          {pipelines.length === 0 && <option value="">Loading…</option>}
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Card>

      <Card
        title="Pipeline columns = outcome buttons (CRITICAL)"
        hint="Click a row to edit automations · drag rows or use ↑↓ to reorder · 1–9 = keyboard"
      >
        <div className="space-y-2">
          {cols.length === 0 && (
            <div className="text-[12px] text-[#6B7280] italic">
              No columns in this pipeline yet. Click "Add column" below.
            </div>
          )}
          {[...cols].sort((a, b) => a.position - b.position).map((col, idx, sortedArr) => {
            const Icon = ICON_MAP[col.icon] ?? Sparkles;
            const a = col.automation;
            const isOpen = expandedId === col.id;
            return (
              <div
                key={col.id}
                draggable
                onDragStart={(e) => {
                  setDraggedColId(col.id);
                  e.dataTransfer.effectAllowed = 'move';
                  // Some Firefox versions need data set to enable drag.
                  e.dataTransfer.setData('text/plain', col.id);
                }}
                onDragOver={(e) => {
                  if (draggedColId && draggedColId !== col.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void dropOnRow(col.id);
                }}
                onDragEnd={() => setDraggedColId(null)}
                className={cn(
                  'border border-[#E5E7EB] rounded-xl overflow-hidden transition-colors',
                  draggedColId === col.id && 'opacity-40',
                  draggedColId && draggedColId !== col.id &&
                    'hover:border-[#3C5A87] hover:bg-[#EEF2F8]/50'
                )}
              >
                <div className="flex items-center gap-3 p-3">
                  {/* PR 116 (Hugo 2026-04-28): proper drag-and-drop. Grip
                      icon is the drag handle (cursor-grab). Up/down arrows
                      kept as keyboard-friendly fallback. */}
                  <span
                    className="text-[#9CA3AF] cursor-grab active:cursor-grabbing flex-shrink-0"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <div className="inline-flex flex-col flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => void moveColumn(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      className="p-0.5 text-[#6B7280] hover:text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveColumn(idx, 1)}
                      disabled={idx === sortedArr.length - 1}
                      title="Move down"
                      className="p-0.5 text-[#6B7280] hover:text-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${col.colour}1A`, color: col.colour }}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#9CA3AF] tabular-nums">
                        {col.position}
                      </span>
                      <input
                        value={col.name}
                        onChange={(e) => update(col.id, { name: e.target.value })}
                        className="text-[13px] font-semibold bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 rounded px-1 max-w-[200px]"
                      />
                      {col.isDefaultOnTimeout && (
                        <span className="text-[9px] font-medium bg-[#FEF7E6] text-[#B45309] px-1 py-0.5 rounded">
                          TIMEOUT DEFAULT
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[#6B7280] mt-1 flex flex-wrap gap-1">
                      {a.sendSms && (
                        <Chip label={`+SMS (${a.smsTemplateId ?? 'inline'})`} colour="#3C5A87" />
                      )}
                      {a.createTask && (
                        <Chip
                          label={`+task (${a.taskTitle ?? '—'} · ${a.taskDueInHours}h)`}
                          colour="#3B82F6"
                        />
                      )}
                      {a.retryDial && (
                        <Chip label={`+retry ${a.retryInHours}h`} colour="#F59E0B" />
                      )}
                      {a.addTag && <Chip label={`+tag ${a.tag}`} colour="#9CA3AF" />}
                    </div>
                  </div>
                  <button
                    onClick={() => setExpandedId(isOpen ? null : col.id)}
                    className="text-[11px] font-medium text-[#3C5A87] hover:bg-[#EEF2F8] px-2 py-1 rounded"
                  >
                    {isOpen ? 'Close' : 'Edit'}
                  </button>
                  <button
                    onClick={() => remove(col.id)}
                    className="text-[#9CA3AF] hover:text-[#EF4444] p-1.5 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-[#E5E7EB] p-3 bg-[#F3F3EE]/40 space-y-3">
                    {/* Colour picker */}
                    <div>
                      <Label>Colour</Label>
                      <div className="flex gap-1.5">
                        {COLOUR_PALETTE.map((p) => (
                          <button
                            key={p}
                            onClick={() => update(col.id, { colour: p })}
                            className={cn(
                              'w-6 h-6 rounded-full border-2',
                              col.colour === p
                                ? 'border-[#1A1A1A]'
                                : 'border-transparent'
                            )}
                            style={{ background: p }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Default-on-timeout */}
                    <label className="flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={col.isDefaultOnTimeout ?? false}
                        onChange={(e) => setTimeoutDefault(col.id, e.target.checked)}
                      />
                      <span className="text-[#1A1A1A]">
                        Default outcome when auto-advance timer expires
                      </span>
                    </label>

                    {/* Coach profile selector */}
                    <div>
                      <div className="text-[11px] font-medium text-[#6B7280] mb-1">
                        AI Coach profile for leads in this column
                      </div>
                      <select
                        value={col.coachProfileId ?? ''}
                        onChange={(e) =>
                          update(col.id, {
                            coachProfileId: e.target.value || undefined,
                          })
                        }
                        className="px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white w-full"
                      >
                        <option value="">Inherit (campaign or default)</option>
                        {allProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Automations */}
                    <div className="border border-[#E5E7EB] rounded-xl bg-white p-3 space-y-3">
                      <div className="text-[10px] uppercase tracking-wide font-semibold text-[#9CA3AF]">
                        Pipeline automation engine — runs on click
                      </div>

                      {/* SMS */}
                      <ToggleRow
                        on={a.sendSms}
                        onToggle={(v) => updateAuto(col.id, { sendSms: v })}
                        title="Send SMS"
                      >
                        <select
                          disabled={!a.sendSms}
                          value={a.smsTemplateId ?? ''}
                          onChange={(e) =>
                            updateAuto(col.id, { smsTemplateId: e.target.value })
                          }
                          className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white disabled:opacity-50"
                        >
                          <option value="">Pick template…</option>
                          {realTemplates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}{t.channel ? ` · ${t.channel}` : ''}
                            </option>
                          ))}
                        </select>
                      </ToggleRow>

                      {/* Task */}
                      <ToggleRow
                        on={a.createTask}
                        onToggle={(v) => updateAuto(col.id, { createTask: v })}
                        title="Create follow-up task"
                      >
                        <input
                          disabled={!a.createTask}
                          value={a.taskTitle ?? ''}
                          onChange={(e) =>
                            updateAuto(col.id, { taskTitle: e.target.value })
                          }
                          placeholder="Task title"
                          className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] flex-1 disabled:opacity-50"
                        />
                        <input
                          disabled={!a.createTask}
                          type="number"
                          value={a.taskDueInHours ?? ''}
                          onChange={(e) =>
                            updateAuto(col.id, {
                              taskDueInHours: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          placeholder="hrs"
                          className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] w-16 tabular-nums disabled:opacity-50"
                        />
                      </ToggleRow>

                      {/* Retry */}
                      <ToggleRow
                        on={a.retryDial}
                        onToggle={(v) => updateAuto(col.id, { retryDial: v })}
                        title="Retry dial in"
                      >
                        <input
                          disabled={!a.retryDial}
                          type="number"
                          value={a.retryInHours ?? ''}
                          onChange={(e) =>
                            updateAuto(col.id, {
                              retryInHours: parseInt(e.target.value, 10) || 0,
                            })
                          }
                          placeholder="hrs"
                          className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] w-16 tabular-nums disabled:opacity-50"
                        />
                        <span className="text-[11px] text-[#6B7280]">hours</span>
                      </ToggleRow>

                      {/* Tag */}
                      <ToggleRow
                        on={a.addTag}
                        onToggle={(v) => updateAuto(col.id, { addTag: v })}
                        title="Add tag to contact"
                      >
                        <input
                          disabled={!a.addTag}
                          value={a.tag ?? ''}
                          onChange={(e) => updateAuto(col.id, { tag: e.target.value })}
                          placeholder="tag-name"
                          className="px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] flex-1 disabled:opacity-50"
                        />
                      </ToggleRow>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={addColumn}
          className="mt-3 flex items-center gap-1 text-[12px] font-medium text-[#3C5A87] hover:bg-[#EEF2F8] px-2 py-1.5 rounded-[10px]"
        >
          <Plus className="w-3.5 h-3.5" /> Add column
        </button>
      </Card>

      <Card title="Live preview — what the agent sees post-call" hint="Changes above reflect here instantly">
        <div className="grid grid-cols-3 gap-2">
          {cols.slice(0, 9).map((col) => {
            const Icon = ICON_MAP[col.icon] ?? Sparkles;
            const a = col.automation;
            return (
              <div
                key={col.id}
                className="border-2 border-[#E5E7EB] rounded-2xl p-2.5 bg-white"
              >
                <div className="flex items-start gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: `${col.colour}1A`, color: col.colour }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-[#9CA3AF]">
                      {col.position}.
                    </div>
                    <div className="text-[12px] font-semibold text-[#1A1A1A] truncate">
                      {col.name}
                    </div>
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {a.sendSms && <span className="text-[8px] text-[#3C5A87]">+SMS</span>}
                      {a.createTask && (
                        <span className="text-[8px] text-[#3B82F6]">+task</span>
                      )}
                      {a.retryDial && (
                        <span className="text-[8px] text-[#F59E0B]">
                          +retry {a.retryInHours}h
                        </span>
                      )}
                      {a.addTag && (
                        <span className="text-[8px] text-[#9CA3AF]">+tag</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function ToggleRow({
  on,
  onToggle,
  title,
  children,
}: {
  on: boolean;
  onToggle: (v: boolean) => void;
  title: string;
  children?: React.ReactNode;
}) {
  // PR 40 (Hugo 2026-04-27): "When you click toggle SMS, it overlaps
  // things." Three fixes:
  //   - Bigger track (40×20) + bigger knob (16×16) so the visual is
  //     more legible and matches the Numbers tab toggle (consistent
  //     across the app).
  //   - Knob centred via top calc so it never clips the track edge
  //     (was top-0.5 + h-3 inside h-4 = 1px clearance — fragile).
  //   - flex-wrap on the row so when the children content (template
  //     dropdown, task title, retry hours) is too wide for the
  //     remaining space, it wraps under the title instead of pushing
  //     the row's height + colliding with the column-detail border.
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => onToggle(!on)}
        className={cn(
          'w-10 h-5 rounded-full relative transition-colors flex-shrink-0',
          on ? 'bg-[#3C5A87]' : 'bg-[#E5E7EB]'
        )}
        aria-pressed={on}
      >
        <span
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
            on ? 'translate-x-[22px]' : 'translate-x-0.5'
          )}
        />
      </button>
      <span className="text-[12px] font-medium text-[#1A1A1A] w-[140px] flex-shrink-0">
        {title}
      </span>
      <div className="flex-1 flex gap-1.5 items-center min-w-[200px]">
        {children}
      </div>
    </div>
  );
}

function WebhookUrlRow({ label, path }: { label: string; path: string }) {
  // Use the build-time SUPABASE_URL so admins always see the right host.
  const projectRef = new URL(import.meta.env.VITE_SUPABASE_URL).host.split('.')[0];
  const url = `https://${projectRef}.supabase.co${path}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="py-2 border-b border-[#E5E7EB] last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 text-[11px] font-mono bg-[#F3F3EE] px-2 py-1.5 rounded-[8px] truncate">
          {url}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-[11px] font-medium border border-[#E5E7EB] hover:bg-[#F3F3EE] text-[#1A1A1A] px-2.5 py-1.5 rounded-[8px] flex-shrink-0"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Chip({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ background: `${colour}15`, color: colour }}
    >
      {label}
    </span>
  );
}

import TemplateList from '../components/templates/TemplateList';

function TemplatesTab({ campaignId = null }: { campaignId?: string | null } = {}) {
  return (
    <Card title="SMS / WhatsApp / Email templates" hint="pick channel per template · stage-coupled = sending moves contact">
      <TemplateList campaignId={campaignId} isAdmin />
    </Card>
  );
}

// ─── PR 57: per-campaign agent assignments ────────────────────────
// Lives inside RealCampaignsPanel as a sub-panel for each expanded
// campaign row. wk-dialer-start enforces these on Start.
function CampaignAgentsPanel({ campaignId }: { campaignId: string }) {
  const { rows, add, remove } = useCampaignAgents(campaignId);
  const { agents } = useAgentsToday();
  const [pickingAgentId, setPickingAgentId] = useState<string>('');
  const assignedIds = new Set(rows.map((r) => r.agent_id));
  const available = agents.filter((a) => !assignedIds.has(a.id) && !a.isAdmin);

  const onAdd = async () => {
    if (!pickingAgentId) return;
    try {
      await add(pickingAgentId);
      setPickingAgentId('');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'add failed');
    }
  };

  return (
    <div className="border border-[#E5E7EB] bg-white rounded-[10px] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
        Assigned agents
        <span className="ml-2 text-[10px] text-[#6B7280] normal-case font-normal">
          {rows.length === 0
            ? 'no rows → any agent may dial this campaign'
            : `${rows.length} agent${rows.length === 1 ? '' : 's'} — only these may dial`}
        </span>
      </div>
      <div className="space-y-1.5 mb-2">
        {rows.length === 0 && (
          <div className="text-[11px] text-[#9CA3AF] italic">
            None assigned. Add at least one to lock this campaign down.
          </div>
        )}
        {rows.map((r) => {
          const a = agents.find((x) => x.id === r.agent_id);
          return (
            <div key={r.id} className="flex items-center justify-between text-[12px]">
              <span className="text-[#1A1A1A]">
                {a?.name ?? r.agent_id.slice(0, 8)}{' '}
                <span className="text-[10px] text-[#9CA3AF]">({r.role})</span>
              </span>
              <button
                onClick={() => void remove(r.id)}
                className="text-[10px] text-[#EF4444] hover:underline"
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <select
          value={pickingAgentId}
          onChange={(e) => setPickingAgentId(e.target.value)}
          className="flex-1 px-2 py-1.5 text-[12px] bg-white border border-[#E5E7EB] rounded-[8px]"
        >
          <option value="">Pick an agent…</option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void onAdd()}
          disabled={!pickingAgentId}
          className="bg-[#3C5A87] text-white text-[11px] font-semibold px-3 py-1.5 rounded-[8px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
        >
          + Add
        </button>
      </div>
    </div>
  );
}

// ─── PR 57: per-campaign number assignments ───────────────────────
// wk-dialer-start picks the from-line from these rows by priority
// ASC. When empty it falls back to the agent's caller-ID then to any
// voice-enabled workspace number.
function CampaignNumbersPanel({ campaignId }: { campaignId: string }) {
  // PR 94 (Hugo 2026-04-28): up/down reorder arrows replaced with a
  // per-row dropdown. Hugo's mental model: each row is one channel;
  // the dropdown picks WHICH SMS / WhatsApp / email is assigned to that
  // slot. Reordering wasn't the right abstraction.
  const { rows, add, remove, swapNumber } = useCampaignNumbers(campaignId);
  // PR 85 (Hugo 2026-04-27): show all channels — SMS / WhatsApp / Email —
  // not just SMS numbers. Each row gets a channel-aware label + icon so
  // it's obvious what's assigned. Picker groups by channel.
  type Row = {
    id: string;
    e164: string;
    channel: 'sms' | 'whatsapp' | 'email';
    provider: 'twilio' | 'resend' | 'unipile';
    voice_enabled: boolean;
    sms_enabled: boolean;
    is_active: boolean;
  };
  const [allNumbers, setAllNumbers] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('wk_numbers' as any) as any)
        .select('id, e164, channel, provider, voice_enabled, sms_enabled, is_active')
        .eq('is_active', true)
        .order('channel', { ascending: true })
        .order('e164', { ascending: true });
      if (!cancelled) setAllNumbers((data ?? []) as Row[]);
    };
    void load();
    // PR 96 (Hugo 2026-04-28): when admin connects a new WhatsApp /
    // Twilio number, the campaign-channel-slot dropdown should show it
    // without a refresh. Subscribe to wk_numbers changes.
    const ch = supabase
      .channel('wk_numbers-campaign-panel')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_numbers' },
        () => { if (!cancelled) void load(); }
      )
      .subscribe();
    return () => {
      cancelled = true;
      try { void supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  }, []);

  const channelLabel = (c: Row['channel']) =>
    c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'Email' : 'SMS';

  // PR 95 (Hugo 2026-04-28): radically simplified UI to three fixed
  // slots \u2014 one per channel. Hugo: "you only assign one SMS, one
  // WhatsApp, one email per campaign." So no priority, no order, no
  // arrows, no Add button. Each slot is a labelled dropdown.
  //
  // Picking a number creates the wk_campaign_numbers row. Picking
  // "(unassigned)" deletes any existing rows for that channel. If
  // multiple legacy rows exist (from PR 56 era), we treat the first one
  // as the assigned slot and quietly drop extras when the user changes
  // selection. This collapses cleanly to the new model.

  const SLOTS: Array<{ channel: Row['channel']; label: string; icon: string }> = [
    { channel: 'sms', label: 'SMS', icon: '📱' },
    { channel: 'whatsapp', label: 'WhatsApp', icon: '💬' },
    { channel: 'email', label: 'Email', icon: '✉️' },
  ];

  const slotState = (channel: Row['channel']) => {
    const matching = rows
      .map((r) => ({ r, n: allNumbers.find((x) => x.id === r.number_id) }))
      .filter((x) => x.n?.channel === channel);
    return {
      current: matching[0] ?? null,
      extras: matching.slice(1).map((x) => x.r),
      options: allNumbers.filter((n) => n.channel === channel && n.is_active),
    };
  };

  const onSlotChange = async (
    _channel: Row['channel'],
    newNumberId: string,
    current: { r: CampaignNumber; n?: Row } | null,
    extras: CampaignNumber[],
  ) => {
    try {
      // Drop legacy extras first so the panel collapses to one row per channel.
      for (const e of extras) await remove(e.id);

      if (!newNumberId) {
        if (current) await remove(current.r.id);
        return;
      }
      if (!current) {
        await add(newNumberId, 0);
        return;
      }
      if (current.r.number_id !== newNumberId) {
        await swapNumber(current.r.id, newNumberId);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'save failed');
    }
  };

  return (
    <div className="border border-[#E5E7EB] bg-white rounded-[10px] p-3">
      <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
        Channels for this campaign
      </div>
      <div className="text-[11px] text-[#6B7280] mb-3 leading-snug">
        Pick one number / account per channel. Leave a slot on
        <em> (unassigned)</em> if this campaign shouldn't use that channel.
      </div>
      <div className="space-y-2">
        {SLOTS.map((slot) => {
          const { current, extras, options } = slotState(slot.channel);
          return (
            <div
              key={slot.channel}
              className="flex items-center gap-3 text-[12px]"
            >
              <span
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded font-bold uppercase tracking-wide w-[110px] flex-shrink-0"
                style={{
                  background:
                    slot.channel === 'whatsapp'
                      ? 'rgba(37, 211, 102, 0.12)'
                      : slot.channel === 'email'
                        ? 'rgba(59, 130, 246, 0.12)'
                        : 'rgba(30, 154, 128, 0.12)',
                  color:
                    slot.channel === 'whatsapp'
                      ? '#0E8B3E'
                      : slot.channel === 'email'
                        ? '#1D4ED8'
                        : '#3C5A87',
                }}
              >
                {slot.icon} {slot.label}
              </span>
              <select
                value={current?.r.number_id ?? ''}
                onChange={(e) =>
                  void onSlotChange(slot.channel, e.target.value, current, extras)
                }
                disabled={options.length === 0 && !current}
                data-testid={`campaign-channel-${slot.channel}`}
                className="flex-1 px-2 py-1.5 text-[12px] bg-white border border-[#E5E7EB] rounded-[8px] disabled:opacity-60"
              >
                <option value="">
                  {options.length === 0
                    ? `(no ${channelLabel(slot.channel)} connected)`
                    : '(unassigned)'}
                </option>
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.e164}
                    {opt.channel === 'sms' && !opt.voice_enabled ? ' (no voice)' : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agents — invite + delete + spend ──────────────────────────────
function AgentsTab() {
  // PR 121 (Hugo 2026-04-28): the Agents tab was reading `agents` off
  // the SmsV2Store, but nothing in the codebase ever hydrated that
  // field from the DB — it stayed at []. Result: only agents created
  // in the *current* browser session were visible; Tajul (created in
  // a previous session / by another admin) was completely missing.
  // Switch to useAgentsToday() — same hook every other agent list on
  // the app uses (dashboard, calls, contacts, post-call, pipelines
  // sub-tab) — and call refresh() after invite so the new row shows
  // immediately without waiting for the 30s poll.
  const { agents, refresh: refreshAgents } = useAgentsToday();
  const { pushToast } = useSmsV2();
  const [inviting, setInviting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [invite, setInvite] = useState({
    email: '',
    password: '',
    name: '',
    extension: '',
    role: 'agent' as Agent['role'],
    limit: 10,
  });

  // PR (Hugo 2026-04-28): wired to wk-delete-agent edge fn. Soft-delete:
  // clears workspace_role/extension on profile, hides from leaderboard,
  // re-pools their wk_dialer_queue + lead assignments, removes
  // wk_campaign_agents links, signs out any open sessions, audit-logs.
  // We confirm with window.confirm() — no extra modal needed for the
  // MVP and it keeps the flow honest (admin sees the email being
  // deleted, can cancel).
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pwAgentId, setPwAgentId] = useState<string | null>(null);
  const [logoutAgentId, setLogoutAgentId] = useState<string | null>(null);
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);

  // Admin can set a new password for any agent. Edge function uses the
  // service role to call supabase.auth.admin.updateUserById and is admin-
  // gated server-side via wk_is_admin(), so even if someone bypasses the
  // UI the password won't change unless they're really an admin.
  const setAgentPassword = async (agentId: string, newPassword: string) => {
    const target = agents.find((a) => a.id === agentId);
    setBusyAgentId(agentId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.functions as any).invoke('wk-set-agent-password', {
        body: { agent_id: agentId, new_password: newPassword },
      });
      if (error) { pushToast(`Failed: ${error.message}`, 'error'); return false; }
      if (data?.error) { pushToast(`Failed: ${data.error}`, 'error'); return false; }
      pushToast(`Password reset for ${target?.email ?? 'agent'} — share the new one with them`, 'success');
      setPwAgentId(null);
      return true;
    } catch (e) {
      pushToast(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
      return false;
    } finally {
      setBusyAgentId(null);
    }
  };

  // Sign the agent out of every device by deleting all their refresh tokens.
  // Already-issued access tokens may live for up to an hour (TTL); for an
  // immediate kick, the admin should also reset the password.
  const logoutAgentEverywhere = async (agentId: string) => {
    const target = agents.find((a) => a.id === agentId);
    setBusyAgentId(agentId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.functions as any).invoke('wk-logout-agent-everywhere', {
        body: { agent_id: agentId },
      });
      if (error) { pushToast(`Failed: ${error.message}`, 'error'); return; }
      if (data?.error) { pushToast(`Failed: ${data.error}`, 'error'); return; }
      const n = data?.sessions_revoked ?? 0;
      pushToast(
        `Signed ${target?.email ?? 'agent'} out (${n} session${n === 1 ? '' : 's'} revoked)`,
        'success',
      );
      setLogoutAgentId(null);
    } catch (e) {
      pushToast(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'error');
    } finally {
      setBusyAgentId(null);
    }
  };

  const remove = async (id: string) => {
    const target = agents.find((a) => a.id === id);
    if (!target) return;
    // PR (Hugo 2026-04-28): the client-side admin block is gone.
    // Server (wk-delete-agent) is now authoritative — it allows
    // workspace admins to delete other admins, refuses every other
    // caller from doing the same, and always refuses self-delete. If
    // the server refuses, the toast surfaces its message verbatim.
    const adminWarning =
      target.role === 'admin' || target.isAdmin
        ? `\n\n⚠ ${target.name || target.email} is an ADMIN. Only workspace admins can delete admins from the UI.`
        : '';
    const ok = window.confirm(
      `Remove ${target.name || target.email} from the workspace?\n\n` +
        `Their queue rows go back to the pool, their leaderboard row hides, ` +
        `and they can no longer sign in. Historical calls/SMS stay attached.\n\n` +
        `This is reversible — re-create the agent with the same email to restore.` +
        adminWarning
    );
    if (!ok) return;
    setDeletingId(id);
    try {
      const { data, error } = await (
        supabase.functions as unknown as DeleteAgentInvoke
      ).invoke('wk-delete-agent', { body: { agent_id: id } });
      if (error) {
        pushToast(`Delete failed: ${error.message}`, 'error');
        return;
      }
      if (data?.error) {
        pushToast(`Delete failed: ${data.error}`, 'error');
        return;
      }
      pushToast(`${target.name || target.email} removed from workspace`, 'success');
      void refreshAgents();
    } catch (e) {
      pushToast(
        `Delete failed: ${e instanceof Error ? e.message : 'unknown error'}`,
        'error'
      );
    } finally {
      setDeletingId(null);
    }
  };

  // PR 90 (Hugo 2026-04-27): the limit input was defaultValue-only with
  // no onBlur \u2014 admin could type a new cap, refresh, lose it. Now writes
  // wk_voice_agent_limits.daily_limit_pence on blur (only if changed).
  // PR 121: list comes from useAgentsToday() now — refresh() after the
  // write so the displayed limit reflects the persisted value without
  // a manual reload.
  const updateAgentLimit = async (agentId: string, raw: string) => {
    const pounds = Number(raw);
    if (!Number.isFinite(pounds) || pounds < 0) {
      pushToast('Limit must be a non-negative number', 'error');
      return;
    }
    const target = agents.find((a) => a.id === agentId);
    if (!target) return;
    const newPence = Math.round(pounds * 100);
    if (newPence === target.limitPence) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_voice_agent_limits' as any) as any)
      .upsert(
        { agent_id: agentId, daily_limit_pence: newPence },
        { onConflict: 'agent_id' }
      );
    if (error) {
      pushToast(`Save failed: ${error.message}`, 'error');
    } else {
      pushToast(`Limit updated to \u00a3${pounds}`, 'success');
      void refreshAgents();
    }
  };

  // PR 109 (Hugo 2026-04-28): per-agent leaderboard visibility toggle.
  // PR 121: write-through then refresh() to pick up the new state from
  // the source of truth (useAgentsToday).
  const updateAgentLeaderboard = async (agentId: string, show: boolean) => {
    const target = agents.find((a) => a.id === agentId);
    if (!target) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_voice_agent_limits' as any) as any)
      .upsert(
        { agent_id: agentId, show_on_leaderboard: show },
        { onConflict: 'agent_id' }
      );
    if (error) {
      pushToast(`Save failed: ${error.message}`, 'error');
      return;
    }
    pushToast(
      show ? `${target.name} shown on leaderboard` : `${target.name} hidden from leaderboard`,
      'success'
    );
    void refreshAgents();
  };

  const randomPassword = () => {
    const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    const arr = new Uint32Array(12);
    crypto.getRandomValues(arr);
    for (const n of arr) out += charset[n % charset.length];
    return out;
  };

  const send = async () => {
    setErrorMsg(null);
    if (!invite.email || !invite.name) {
      setErrorMsg('Name and email are required.');
      return;
    }
    if (invite.password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await (
        supabase.functions as unknown as CreateAgentInvoke
      ).invoke('wk-create-agent', {
        body: {
          email: invite.email.trim().toLowerCase(),
          password: invite.password,
          name: invite.name.trim(),
          extension: invite.extension.trim() || null,
          role: invite.role,
          daily_limit_pence: Math.max(0, Math.floor(invite.limit * 100)),
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setSubmitting(false);
        return;
      }
      if (data?.error) {
        setErrorMsg(data.error);
        setSubmitting(false);
        return;
      }
      // PR 121: refresh from the source of truth instead of patching
      // the local store optimistically — the new row appears as soon
      // as the join (profiles + wk_voice_agent_limits) returns it.
      void refreshAgents();
      pushToast(`Agent created — share login with ${invite.email}`, 'success');
      setInvite({ email: '', password: '', name: '', extension: '', role: 'agent', limit: 10 });
      setInviting(false);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card title="Agents & spend limits" hint="Edit limit = instant effect">
        <table className="w-full text-[13px]">
          <thead className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left py-2">Role</th>
              <th className="text-left py-2">Ext.</th>
              <th className="text-right py-2">Spend</th>
              <th className="text-right py-2">Limit (£)</th>
              <th className="text-center py-2">Leaderboard</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {agents.map((a) => (
              <tr key={a.id}>
                <td className="py-2 font-semibold text-[#1A1A1A]">{a.name}</td>
                <td className="py-2 text-[#6B7280] capitalize">{a.role}</td>
                <td className="py-2 text-[#6B7280] tabular-nums">{a.extension}</td>
                <td className="py-2 text-right tabular-nums">{formatPence(a.spendPence)}</td>
                <td className="py-2 text-right">
                  {a.isAdmin ? (
                    <span className="text-[#9CA3AF]">∞</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      defaultValue={(a.limitPence / 100).toFixed(0)}
                      onBlur={(e) => void updateAgentLimit(a.id, e.target.value)}
                      data-testid={`agent-limit-${a.id}`}
                      className="w-16 px-2 py-1 text-right tabular-nums border border-[#E5E7EB] rounded-[8px]"
                    />
                  )}
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    checked={a.showOnLeaderboard !== false}
                    onChange={(e) => void updateAgentLeaderboard(a.id, e.target.checked)}
                    data-testid={`agent-leaderboard-${a.id}`}
                    title="Show this agent on the leaderboard"
                    className="w-4 h-4 accent-[#3C5A87] cursor-pointer"
                  />
                </td>
                <td className="py-2 text-right">
                  <div className="inline-flex items-center gap-0.5">
                    <button
                      onClick={() => setPwAgentId(a.id)}
                      disabled={busyAgentId === a.id || deletingId === a.id}
                      className="text-[#9CA3AF] hover:text-[#2563EB] p-1.5 rounded disabled:opacity-40 disabled:cursor-wait"
                      title="Change password"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setLogoutAgentId(a.id)}
                      disabled={busyAgentId === a.id || deletingId === a.id}
                      className="text-[#9CA3AF] hover:text-[#D97706] p-1.5 rounded disabled:opacity-40 disabled:cursor-wait"
                      title="Sign agent out of every device"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </button>
                    {a.isAdmin ? (
                      <span className="text-[10px] text-[#9CA3AF] ml-2">protected</span>
                    ) : (
                      <button
                        onClick={() => void remove(a.id)}
                        disabled={deletingId === a.id || busyAgentId === a.id}
                        className="text-[#9CA3AF] hover:text-[#EF4444] p-1.5 rounded disabled:opacity-40 disabled:cursor-wait"
                        title="Remove agent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!inviting && (
          <button
            onClick={() => setInviting(true)}
            className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3C5A87] hover:bg-[#EEF2F8] px-3 py-1.5 rounded-[10px]"
          >
            <Plus className="w-3.5 h-3.5" /> Invite agent
          </button>
        )}

        {inviting && (
          <div className="mt-3 border border-[#E5E7EB] rounded-xl p-3 bg-[#F3F3EE]/40 space-y-2">
            <div className="text-[12px] font-semibold text-[#1A1A1A] mb-1 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Create agent — they sign in with this email + password
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Full name"
                value={invite.name}
                onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                className="px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px]"
              />
              <input
                placeholder="you@example.com"
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                className="px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px]"
              />
              <div className="col-span-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Key className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="Password (≥ 8 chars)"
                    value={invite.password}
                    onChange={(e) => setInvite({ ...invite, password: e.target.value })}
                    className="w-full pl-7 pr-8 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A1A1A]"
                    title={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const pw = randomPassword();
                    setInvite((s) => ({ ...s, password: pw }));
                    setShowPw(true);
                  }}
                  className="text-[11px] font-medium text-[#3C5A87] hover:bg-[#EEF2F8] px-2 py-1.5 rounded-[8px] whitespace-nowrap"
                  title="Generate a strong password"
                >
                  Generate
                </button>
              </div>
              <input
                placeholder="Extension (e.g. 106)"
                value={invite.extension}
                onChange={(e) => setInvite({ ...invite, extension: e.target.value })}
                className="px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] tabular-nums"
              />
              <select
                value={invite.role}
                onChange={(e) =>
                  setInvite({ ...invite, role: e.target.value as Agent['role'] })
                }
                className="px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white"
              >
                <option value="agent">Agent</option>
                <option value="admin">Admin (no spend cap)</option>
                <option value="viewer">Viewer (read-only)</option>
              </select>
              <div className="col-span-2 flex items-center gap-2">
                <span className="text-[11px] text-[#6B7280]">Daily spend cap £</span>
                <input
                  type="number"
                  value={invite.limit}
                  onChange={(e) =>
                    setInvite({ ...invite, limit: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-20 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-[8px] tabular-nums"
                />
              </div>
            </div>
            {errorMsg && (
              <div className="text-[11px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded px-2 py-1.5">
                {errorMsg}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-[#E5E7EB]">
              <button
                onClick={() => {
                  setInviting(false);
                  setErrorMsg(null);
                }}
                className="text-[11px] text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => void send()}
                disabled={submitting}
                className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[8px] hover:bg-[#3C5A87]/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? 'Creating…' : 'Create agent'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {pwAgentId && (
        <AgentPasswordModal
          agent={agents.find((a) => a.id === pwAgentId)}
          busy={busyAgentId === pwAgentId}
          onCancel={() => setPwAgentId(null)}
          onConfirm={(pw) => void setAgentPassword(pwAgentId, pw)}
        />
      )}

      {logoutAgentId && (
        <AgentLogoutModal
          agent={agents.find((a) => a.id === logoutAgentId)}
          busy={busyAgentId === logoutAgentId}
          onCancel={() => setLogoutAgentId(null)}
          onConfirm={() => void logoutAgentEverywhere(logoutAgentId)}
        />
      )}
    </>
  );
}

// ─── AgentPasswordModal — admin sets a new password for an agent ────
function AgentPasswordModal({
  agent, busy, onCancel, onConfirm,
}: {
  agent: { id: string; name?: string; email?: string } | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (newPassword: string) => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== confirm) { setErr("Passwords don't match."); return; }
    onConfirm(pw);
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-[12px] shadow-2xl w-full max-w-md p-5">
        <h3 className="text-[14px] font-bold text-[#1A1A1A]">Change password for {agent?.name || agent?.email || 'agent'}</h3>
        <p className="text-[11px] text-[#6B7280] mt-1">The new password takes effect immediately. Share it with the agent.</p>

        <label className="block mt-3 text-[11px] font-semibold text-[#525252]">New password
          <div className="relative mt-1">
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              disabled={busy}
              className="w-full px-3 py-1.5 pr-12 border border-[#E5E5E5] rounded-[8px] font-mono text-[12px]"
            />
            <button type="button" onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#6B7280] hover:text-[#1A1A1A]">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label className="block mt-2 text-[11px] font-semibold text-[#525252]">Confirm
          <input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
            className="mt-1 w-full px-3 py-1.5 border border-[#E5E5E5] rounded-[8px] font-mono text-[12px]"
          />
        </label>

        {err && (
          <div className="mt-2 text-[11px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded px-2 py-1.5">{err}</div>
        )}

        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#E5E7EB]">
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-[11px] text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="bg-[#2563EB] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[8px] hover:bg-[#1D4ED8] disabled:opacity-60">
            {busy ? 'Setting…' : 'Set new password'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── AgentLogoutModal — admin signs an agent out of every device ────
function AgentLogoutModal({
  agent, busy, onCancel, onConfirm,
}: {
  agent: { id: string; name?: string; email?: string } | undefined;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[12px] shadow-2xl w-full max-w-md p-5">
        <h3 className="text-[14px] font-bold text-[#1A1A1A]">Sign {agent?.name || agent?.email || 'agent'} out everywhere?</h3>
        <p className="text-[11px] text-[#6B7280] mt-2 leading-relaxed">
          Their refresh tokens are revoked immediately. Already-issued access tokens may keep working up to one hour (their natural TTL).
          For an immediate kick, also change their password.
        </p>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#E5E7EB]">
          <button onClick={onCancel} disabled={busy}
            className="text-[11px] text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="bg-[#D97706] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[8px] hover:bg-[#B45309] disabled:opacity-60">
            {busy ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Numbers — Twilio connection + per-number toggles ─────────────
function NumbersTab() {
  const { state, loading, busy, error, connect, disconnect, sync, toggleNumber } =
    useTwilioAccount();
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onConnect = async () => {
    setLocalError(null);
    if (!sid.trim().startsWith('AC')) {
      setLocalError('Account SID must start with "AC".');
      return;
    }
    if (token.trim().length < 16) {
      setLocalError('Auth token looks too short.');
      return;
    }
    const ok = await connect(sid.trim(), token.trim());
    if (ok) {
      setSid('');
      setToken('');
    }
  };

  const onDisconnect = async () => {
    if (!confirm('Disconnect Twilio? Numbers stay in the workspace but calls will fail.'))
      return;
    await disconnect();
  };

  if (loading) {
    return (
      <Card title="Twilio account">
        <div className="text-[12px] text-[#6B7280] py-4">Loading…</div>
      </Card>
    );
  }

  // ---------- Disconnected state ---------------------------------------
  if (!state.connected) {
    return (
      <Card
        title="Twilio account"
        hint="Paste your Account SID and Auth Token to connect"
      >
        <div className="space-y-3 max-w-[560px]">
          <div>
            <div className="text-[12px] font-medium text-[#1A1A1A] mb-1">Account SID</div>
            <input
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 text-[13px] font-mono border border-[#E5E7EB] rounded-[10px] bg-white"
            />
          </div>
          <div>
            <div className="text-[12px] font-medium text-[#1A1A1A] mb-1">Auth Token</div>
            <div className="relative">
              <Key className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Auth token from Twilio console"
                className="w-full pl-9 pr-9 py-2 text-[13px] font-mono border border-[#E5E7EB] rounded-[10px] bg-white"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A1A1A]"
                title={showToken ? 'Hide' : 'Show'}
              >
                {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          {(localError || error) && (
            <div className="text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2">
              {localError ?? error}
            </div>
          )}
          <button
            onClick={() => void onConnect()}
            disabled={busy === 'connect'}
            className="bg-[#3C5A87] text-white text-[13px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy === 'connect' ? 'Connecting…' : 'Connect Twilio account'}
          </button>
        </div>
      </Card>
    );
  }

  // ---------- Connected state ------------------------------------------
  const sidMasked = state.account_sid
    ? `${state.account_sid.slice(0, 6)}…${state.account_sid.slice(-6)}`
    : '';

  return (
    <>
      <Card title="Twilio account" hint="Connected">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#3C5A87]" />
              <span className="text-[13px] font-semibold text-[#1A1A1A]">Twilio connected</span>
            </div>
            {state.friendly_name && (
              <div className="text-[12px] text-[#6B7280]">{state.friendly_name}</div>
            )}
            <div className="text-[11px] text-[#6B7280] font-mono">SID {sidMasked}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void sync()}
              disabled={busy === 'sync'}
              className="text-[12px] font-medium border border-[#E5E7EB] text-[#1A1A1A] hover:bg-[#F3F3EE] px-3 py-1.5 rounded-[10px] disabled:opacity-60"
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync numbers'}
            </button>
            <button
              onClick={() => void onDisconnect()}
              disabled={busy === 'disconnect'}
              className="text-[12px] font-medium border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2] px-3 py-1.5 rounded-[10px] disabled:opacity-60"
            >
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Twilio account'}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </Card>

      {/* PR 39 (Hugo 2026-04-27): inbound SMS wasn't being received.
          Most common cause: Twilio's per-number 'A message comes in'
          webhook URL isn't set / points elsewhere. Surface the URL
          here so admins can copy it directly into the Twilio Console. */}
      <Card
        title="Webhook URLs (Twilio Console)"
        hint="Set these on every active number's 'A message comes in' / 'A call comes in' fields"
      >
        <WebhookUrlRow
          label="Inbound SMS"
          path="/functions/v1/sms-webhook-incoming"
        />
        <WebhookUrlRow
          label="Inbound WhatsApp"
          path="/functions/v1/wa-webhook-incoming"
        />
        <WebhookUrlRow
          label="Inbound voice"
          path="/functions/v1/wk-voice-twiml-incoming"
        />
      </Card>

      <Card
        title="Enable your numbers below"
        hint="Toggle voice on/off — only enabled numbers can make outbound calls"
      >
        {state.numbers.length === 0 ? (
          <div className="text-[12px] text-[#6B7280] py-4">
            No numbers found. Buy a number in the Twilio console then click Sync.
          </div>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {state.numbers.map((n) => (
              <div key={n.id} className="flex items-center justify-between py-3">
                <div className="space-y-0.5">
                  <div className="font-mono text-[14px] tabular-nums text-[#1A1A1A]">
                    {n.e164}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                    {[n.sms_enabled ? 'SMS' : null, n.recording_enabled ? 'recording' : null]
                      .filter(Boolean)
                      .join(' · ') || 'voice only'}
                    {' · '}max {n.max_calls_per_minute}/min
                  </div>
                </div>
                {/* PR 40: knob centred via top-1/2 + translate so it
                    never clips. min-w on the label so the
                    Enabled/Disabled text doesn't get squeezed under
                    the knob on narrow screens. */}
                <button
                  onClick={() => void toggleNumber(n.e164, !n.voice_enabled)}
                  className="flex items-center gap-2 group flex-shrink-0"
                  title={n.voice_enabled ? 'Click to disable voice' : 'Click to enable voice'}
                  aria-pressed={n.voice_enabled}
                >
                  <span
                    className={cn(
                      'relative w-10 h-6 rounded-full transition-colors flex-shrink-0',
                      n.voice_enabled ? 'bg-[#3C5A87]' : 'bg-[#E5E7EB]'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-sm transition-transform',
                        n.voice_enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      'text-[12px] font-medium min-w-[60px] text-left',
                      n.voice_enabled ? 'text-[#3C5A87]' : 'text-[#9CA3AF]'
                    )}
                  >
                    {n.voice_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Unified Coach Tab — profiles + facts + glossary on one page ───
interface CoachProfile {
  id: string;
  name: string;
  call_script_id: string | null;
  coach_style_prompt: string | null;
  coach_script_prompt: string | null;
  is_default: boolean;
}

function UnifiedCoachTab({ campaignId = null }: { campaignId?: string | null } = {}) {
  const [profiles, setProfiles] = useState<CoachProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [scripts, setScripts] = useState<{ id: string; name: string; body_md: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [profRes, scriptRes] = await Promise.all([
          (supabase.from('wk_coach_profiles' as any) as any)
            .select('id, name, call_script_id, coach_style_prompt, coach_script_prompt, is_default')
            .order('is_default', { ascending: false }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase.from('wk_call_scripts' as any) as any)
            .select('id, name, body_md')
            .order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        if (profRes.data) {
          const rows = profRes.data as CoachProfile[];
          setProfiles(rows);
          setSelectedId((prev) => prev ?? (rows[0]?.id ?? null));
        }
        if (scriptRes.data) {
          setScripts(scriptRes.data as { id: string; name: string; body_md: string }[]);
        }
      } catch (e) {
        console.warn('[UnifiedCoachTab] load failed', e);
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const reloadScripts = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_call_scripts' as any) as any)
      .select('id, name, body_md')
      .order('name', { ascending: true });
    if (data) setScripts(data as { id: string; name: string; body_md: string }[]);
  };

  const saveProfile = async (id: string, patch: Partial<CoachProfile>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_coach_profiles' as any) as any)
      .update(patch)
      .eq('id', id);
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addProfile = async () => {
    const name = prompt('Profile name (e.g. "Follow-up", "Warm lead")');
    if (!name?.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_coach_profiles' as any) as any)
      .insert({ name: name.trim(), is_default: false })
      .select('id, name, call_script_id, coach_style_prompt, coach_script_prompt, is_default')
      .single();
    if (data) {
      const row = data as CoachProfile;
      setProfiles((prev) => [...prev, row]);
      setSelectedId(row.id);
    }
  };

  const deleteProfile = async (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p || p.is_default) return;
    if (!confirm(`Delete profile "${p.name}"? Pipeline columns using it will fall back to the default.`)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_coach_profiles' as any) as any).delete().eq('id', id);
    setProfiles((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  return (
    <>
      {/* Profile selector pills */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={cn(
              'px-3 py-1.5 rounded-[10px] text-[12px] font-medium transition-colors',
              selectedId === p.id
                ? 'bg-[#3C5A87] text-white shadow-sm'
                : 'bg-[#F3F3EE] text-[#6B7280] hover:bg-[#E5E7EB]'
            )}
          >
            {p.name}
            {p.is_default && <span className="ml-1 text-[10px] opacity-70">(default)</span>}
          </button>
        ))}
        <button
          onClick={() => void addProfile()}
          className="px-3 py-1.5 rounded-[10px] text-[12px] font-medium text-[#3C5A87] border border-dashed border-[#3C5A87] hover:bg-[#EEF2F8]"
        >
          + New profile
        </button>
      </div>

      {/* Selected profile editor */}
      {selected && (
        <ProfileEditor
          key={selected.id}
          profile={selected}
          scripts={scripts}
          onSave={(patch) => void saveProfile(selected.id, patch)}
          onDelete={selected.is_default ? undefined : () => void deleteProfile(selected.id)}
          onScriptsChanged={reloadScripts}
        />
      )}

      {loadingProfiles && (
        <div className="text-[12px] text-[#9CA3AF] py-4 text-center">Loading profiles…</div>
      )}

      {/* Shared sections: AI settings + facts + glossary */}
      <div className="mt-6 border-t border-[#E5E7EB] pt-4">
        <div className="text-[13px] font-semibold text-[#1A1A1A] mb-3">
          Shared settings (all profiles)
        </div>
        <AITab campaignId={campaignId} />
      </div>

      <div className="mt-6 border-t border-[#E5E7EB] pt-4">
        <div className="text-[13px] font-semibold text-[#1A1A1A] mb-3">
          Knowledge base (shared across all profiles)
        </div>
        <KnowledgeBaseTab campaignId={campaignId} />
      </div>

      <div className="mt-6 border-t border-[#E5E7EB] pt-4">
        <div className="text-[13px] font-semibold text-[#1A1A1A] mb-3">
          Glossary (shared across all profiles)
        </div>
        <GlossaryTab campaignId={campaignId} />
      </div>
    </>
  );
}

function ProfileEditor({
  profile,
  scripts,
  onSave,
  onDelete,
  onScriptsChanged,
}: {
  profile: CoachProfile;
  scripts: { id: string; name: string; body_md: string }[];
  onSave: (patch: Partial<CoachProfile>) => void;
  onDelete?: () => void;
  onScriptsChanged: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [stylePrompt, setStylePrompt] = useState(profile.coach_style_prompt ?? '');
  const [scriptPrompt, setScriptPrompt] = useState(profile.coach_script_prompt ?? '');
  const [scriptId, setScriptId] = useState(profile.call_script_id ?? '');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingScript, setEditingScript] = useState(false);
  const [scriptBody, setScriptBody] = useState('');
  const [scriptName, setScriptName] = useState('');

  const selectedScript = scripts.find((s) => s.id === scriptId);

  useEffect(() => {
    if (selectedScript) {
      setScriptBody(selectedScript.body_md);
      setScriptName(selectedScript.name);
    }
  }, [selectedScript]);

  const save = () => {
    onSave({
      name,
      coach_style_prompt: stylePrompt || null,
      coach_script_prompt: scriptPrompt || null,
      call_script_id: scriptId || null,
    });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const saveScript = async () => {
    if (!scriptId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('wk_call_scripts' as any) as any)
      .update({ name: scriptName, body_md: scriptBody })
      .eq('id', scriptId);
    setEditingScript(false);
    onScriptsChanged();
  };

  const createScript = async () => {
    const n = prompt('Script name', `${profile.name} script`);
    if (!n?.trim()) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_call_scripts' as any) as any)
      .insert({ name: n.trim(), body_md: '', is_default: false })
      .select('id')
      .single();
    if (data) {
      const newId = (data as { id: string }).id;
      setScriptId(newId);
      onSave({ call_script_id: newId });
      onScriptsChanged();
    }
  };

  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setDirty(true); }}
            className="text-[14px] font-semibold bg-transparent border-b border-dashed border-[#E5E7EB] focus:border-[#3C5A87] outline-none px-0 py-0.5 w-48"
          />
          {profile.is_default && (
            <span className="text-[10px] text-[#3C5A87] bg-[#EEF2F8] px-2 py-0.5 rounded-full">
              Default
            </span>
          )}
        </div>
      }
      hint="Bundled script + coach prompts. Assign this profile to pipeline columns."
    >
      <div className="space-y-4">
        {/* Agent script selector */}
        <div>
          <Label>Agent call script</Label>
          <div className="flex gap-2 items-center">
            <select
              value={scriptId}
              onChange={(e) => { setScriptId(e.target.value); setDirty(true); }}
              className="flex-1 px-2 py-1.5 text-[12px] border border-[#E5E7EB] rounded-[8px] bg-white"
            >
              <option value="">No script</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={() => void createScript()}
              className="text-[11px] text-[#3C5A87] hover:underline whitespace-nowrap"
            >
              + New script
            </button>
          </div>
          {selectedScript && !editingScript && (
            <div className="mt-2 border border-[#E5E7EB] rounded-lg p-2 bg-[#F9FAFB]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium text-[#1A1A1A]">{selectedScript.name}</span>
                <button
                  onClick={() => setEditingScript(true)}
                  className="text-[10px] text-[#3C5A87] hover:underline"
                >
                  Edit script
                </button>
              </div>
              <pre className="text-[10px] text-[#6B7280] whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                {selectedScript.body_md || '(empty)'}
              </pre>
            </div>
          )}
          {editingScript && (
            <div className="mt-2 border border-[#3C5A87] rounded-lg p-2 bg-white">
              <input
                value={scriptName}
                onChange={(e) => setScriptName(e.target.value)}
                className="w-full text-[12px] font-semibold border-b border-[#E5E7EB] mb-2 pb-1 outline-none"
              />
              <textarea
                value={scriptBody}
                onChange={(e) => setScriptBody(e.target.value)}
                rows={10}
                className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => void saveScript()}
                  className="bg-[#3C5A87] text-white text-[11px] font-semibold px-3 py-1.5 rounded-[8px]"
                >
                  Save script
                </button>
                <button
                  onClick={() => setEditingScript(false)}
                  className="text-[11px] text-[#6B7280] hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Style prompt */}
        <div>
          <Label>Style / voice prompt</Label>
          <div className="text-[10px] text-[#9CA3AF] mb-1">
            How the AI coach sounds during calls using this profile.
          </div>
          <textarea
            value={stylePrompt}
            onChange={(e) => { setStylePrompt(e.target.value); setDirty(true); }}
            rows={6}
            placeholder="Leave empty to inherit the workspace default."
            className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
          />
        </div>

        {/* Script prompt */}
        <div>
          <Label>Call logic / script prompt</Label>
          <div className="text-[10px] text-[#9CA3AF] mb-1">
            Call stages, objection handling, closing gates for this profile.
          </div>
          <textarea
            value={scriptPrompt}
            onChange={(e) => { setScriptPrompt(e.target.value); setDirty(true); }}
            rows={8}
            placeholder="Leave empty to inherit the workspace default."
            className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
          />
        </div>

        {/* Save / delete */}
        <div className="flex items-center gap-3 pt-2 border-t border-[#E5E7EB]">
          <button
            onClick={save}
            disabled={!dirty}
            className={cn(
              'text-[12px] font-semibold px-4 py-2 rounded-[10px] transition-colors',
              dirty
                ? 'bg-[#3C5A87] text-white hover:bg-[#3C5A87]/90'
                : 'bg-[#F3F3EE] text-[#9CA3AF] cursor-not-allowed'
            )}
          >
            {saved ? 'Saved ✓' : 'Save profile'}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="text-[11px] text-[#EF4444] hover:underline"
            >
              Delete profile
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── AI — API key + model dropdown ─────────────────────────────────
function AITab({ campaignId = null }: { campaignId?: string | null } = {}) {
  const ks = useKillSwitch();
  const { settings, loading, saving, error, saved, fieldSource, setField, save, resetField } =
    useAiSettings({ campaignId });
  const [showKey, setShowKey] = useState(false);

  return (
    <>
      <Card title="OpenAI API key & model">
        <div className="space-y-3">
          <div>
            <Label>
              <span className="inline-flex items-center gap-1">
                <Key className="w-3 h-3" /> OpenAI API key (server-side only)
              </span>
            </Label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.openai_api_key}
                  onChange={(e) => setField('openai_api_key', e.target.value)}
                  placeholder={loading ? 'Loading…' : 'sk-proj-…'}
                  disabled={loading}
                  className="w-full px-3 py-2 pr-9 text-[13px] font-mono border border-[#E5E7EB] rounded-[10px] disabled:bg-[#F9FAFB]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#1A1A1A]"
                >
                  {showKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <button
                onClick={() => void save()}
                disabled={saving || loading}
                className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
              </button>
            </div>
            <div className="text-[10px] text-[#9CA3AF] mt-1">
              Stored in <code className="bg-[#F3F3EE] px-1 rounded">wk_ai_settings</code> (admin-RLS).
              Read server-side only by edge functions; never sent to the browser bundle.
            </div>
            {error && (
              <div className="text-[10px] text-[#EF4444] mt-1">⚠ {error}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Model — post-call analysis (Whisper + summary)</Label>
              <select
                value={settings.postcall_model}
                onChange={(e) => setField('postcall_model', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
              >
                <optgroup label="GPT-5 family (newest)">
                  <option value="gpt-5.4">gpt-5.4 (most accurate)</option>
                  <option value="gpt-5.4-mini">gpt-5.4-mini (recommended · smart + fast)</option>
                  <option value="gpt-5.4-nano">gpt-5.4-nano (fastest)</option>
                </optgroup>
                <optgroup label="GPT-4.1 family">
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  <option value="gpt-4.1-nano">gpt-4.1-nano</option>
                </optgroup>
                <optgroup label="GPT-4o family (legacy)">
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                </optgroup>
                <optgroup label="Reasoning">
                  <option value="o1-mini">o1-mini</option>
                </optgroup>
              </select>
            </div>
            <div>
              <Label>Model — live coach (chat completions, per-utterance)</Label>
              <select
                value={settings.live_coach_model}
                onChange={(e) => setField('live_coach_model', e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
              >
                <optgroup label="GPT-5 family (newest)">
                  <option value="gpt-5.4">gpt-5.4 (most accurate · slower)</option>
                  <option value="gpt-5.4-mini">gpt-5.4-mini (recommended · smart + fast)</option>
                  <option value="gpt-5.4-nano">gpt-5.4-nano (fastest · less smart)</option>
                </optgroup>
                <optgroup label="GPT-4.1 family">
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  <option value="gpt-4.1-nano">gpt-4.1-nano</option>
                </optgroup>
                <optgroup label="GPT-4o family (legacy)">
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                </optgroup>
              </select>
              <div className="text-[10px] text-[#9CA3AF] mt-1">
                Used by <code className="bg-[#F3F3EE] px-1 rounded">wk-voice-transcription</code> per caller utterance. Hot-swap takes effect on the next coach card (no redeploy).
              </div>
            </div>
          </div>

          <div>
            <Label>Whisper model (post-call transcription)</Label>
            <select
              value={settings.whisper_model}
              onChange={(e) => setField('whisper_model', e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
            >
              <option value="whisper-1">whisper-1 (default)</option>
            </select>
          </div>

          {/* PR 90 (Hugo 2026-04-27): the three model selectors above only
              called setField locally \u2014 changes were lost on refresh.
              Dedicated Save button persists wk_ai_settings via the same
              save() the API key uses. */}
          <div className="flex items-center gap-2 pt-2 border-t border-[#E5E7EB]">
            <button
              onClick={() => void save()}
              disabled={saving || loading}
              className="bg-[#3C5A87] text-white text-[12px] font-semibold px-4 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
            >
              {saving ? 'Saving\u2026' : saved ? 'Saved \u2713' : 'Save AI model settings'}
            </button>
            <span className="text-[10px] text-[#9CA3AF]">
              Hot-swap \u2014 takes effect on the next call.
            </span>
          </div>
        </div>
      </Card>

      <Card title="AI coach master switch">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => ks.toggle('aiCoach')}
              className={cn(
                'px-4 py-2 rounded-[10px] text-[13px] font-semibold transition-colors',
                !ks.aiCoach
                  ? 'bg-[#3C5A87] text-white'
                  : 'bg-[#F3F3EE] text-[#6B7280]'
              )}
            >
              {!ks.aiCoach ? 'AI Coach: ON' : 'AI Coach: OFF (kill switch active)'}
            </button>
            <span className="text-[11px] text-[#6B7280]">
              Master switch — disables coach across all campaigns immediately
            </span>
          </div>
          <div className="flex items-center gap-4 pt-2 border-t border-[#E5E7EB]">
            <label className="flex items-center gap-2 text-[12px] text-[#1A1A1A]">
              <input
                type="checkbox"
                checked={settings.ai_enabled}
                onChange={(e) => setField('ai_enabled', e.target.checked)}
              />
              ai_enabled (post-call summaries on/off)
            </label>
            <label className="flex items-center gap-2 text-[12px] text-[#1A1A1A]">
              <input
                type="checkbox"
                checked={settings.live_coach_enabled}
                onChange={(e) => setField('live_coach_enabled', e.target.checked)}
              />
              live_coach_enabled (real-time WebSocket on/off)
            </label>
          </div>
        </div>
      </Card>

      <Card
        title="Live coach — three-layer prompt"
        hint="Style + Script + Knowledge Base (Hugo 2026-04-29). See docs/runbooks/COACH_PROMPT_LAYERS.md."
      >
        <div className="space-y-3">
          <div>
            <Label>
              Layer 1 — Style / voice
              <ScopeBadge
                source={fieldSource.coach_style_prompt}
                campaignId={campaignId}
                onReset={() => void resetField('coach_style_prompt')}
              />
            </Label>
            <div className="text-[10px] text-[#9CA3AF] mb-1">
              How the rep sounds. UK English, plain, commercial. Bans on
              acting notes, multiple variants, American slop.
              {campaignId
                ? ' Per-campaign override stored in wk_campaign_ai_settings.'
                : ' Persisted to wk_ai_settings.coach_style_prompt (workspace default).'}
            </div>
            <textarea
              value={settings.coach_style_prompt}
              onChange={(e) => setField('coach_style_prompt', e.target.value)}
              rows={8}
              placeholder={
                campaignId
                  ? 'Leave empty to inherit the workspace default.'
                  : 'Leave empty to use the canonical default from the edge function.'
              }
              className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
            />
          </div>
          <div>
            <Label>
              Layer 2 — Script / call logic
              <ScopeBadge
                source={fieldSource.coach_script_prompt}
                campaignId={campaignId}
                onReset={() => void resetField('coach_script_prompt')}
              />
            </Label>
            <div className="text-[10px] text-[#9CA3AF] mb-1">
              Call stages, open-ended default, earned-close gate,
              retrieval instruction (point the model at the KB for
              factual questions).
              {campaignId
                ? ' Per-campaign override stored in wk_campaign_ai_settings.'
                : ' Persisted to wk_ai_settings.coach_script_prompt (workspace default).'}
            </div>
            <textarea
              value={settings.coach_script_prompt}
              onChange={(e) => setField('coach_script_prompt', e.target.value)}
              rows={12}
              placeholder={
                campaignId
                  ? 'Leave empty to inherit the workspace default.'
                  : 'Leave empty to use the canonical default from the edge function.'
              }
              className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
            />
          </div>
          <div className="text-[11px] text-[#6B7280] border border-dashed border-[#E5E7EB] rounded-lg p-2 bg-[#F9FAFB]">
            <span className="font-semibold text-[#1A1A1A]">Layer 3 — Coach facts</span> lives in <code className="bg-[#F3F3EE] px-1 rounded">wk_coach_facts</code> and is edited in the <span className="font-semibold">Coach facts</span> tab on the left. The agent-facing <span className="font-semibold">Glossary</span> + <span className="font-semibold">Objections</span> tabs (col 4 of the live-call screen) live in <code className="bg-[#F3F3EE] px-1 rounded">wk_terminologies</code> — separate surface, separate Settings tab.
          </div>
          <details className="border border-[#E5E7EB] rounded-xl p-3">
            <summary className="text-[12px] font-semibold text-[#6B7280] cursor-pointer">
              Legacy single-prompt (deprecated) — used only as fallback if both new layers are empty
            </summary>
            <div className="mt-2">
              <textarea
                value={settings.live_coach_system_prompt}
                onChange={(e) => setField('live_coach_system_prompt', e.target.value)}
                rows={6}
                className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2 opacity-70"
              />
            </div>
          </details>
          <div>
            <Label>Post-call analysis prompt</Label>
            <textarea
              value={settings.postcall_system_prompt}
              onChange={(e) => setField('postcall_system_prompt', e.target.value)}
              rows={6}
              className="w-full text-[11px] font-mono border border-[#E5E7EB] rounded-[8px] p-2"
            />
          </div>
          <details className="border border-[#E5E7EB] rounded-xl p-3">
            <summary className="text-[12px] font-semibold text-[#6B7280] cursor-pointer">
              Reference prompts (read-only — copy into the editors above)
            </summary>
            <div className="mt-2 space-y-2">
              {COACH_PROMPTS.map((p) => (
                <div key={p.id} className="border border-[#E5E7EB] rounded-lg p-2">
                  <div className="text-[12px] font-semibold mb-1">{p.name}</div>
                  <pre className="text-[10px] text-[#6B7280] whitespace-pre-wrap font-mono">{p.body}</pre>
                </div>
              ))}
            </div>
          </details>
        </div>
      </Card>

      <AgentScriptCard />
      <CallScriptCard />
    </>
  );
}

// ─── My script (agent's own — overrides the default) ──────────────
// Hugo 2026-04-30: each agent edits their own script. The live-call
// pane resolves: own > default > hardcoded fallback.
function AgentScriptCard() {
  const { script, loading, saving, saved, error, setField, save, resetToDefault } =
    useAgentScript();
  return (
    <Card
      title="My script"
      hint={
        script.source === 'own'
          ? 'Your personal script (overrides the default). Markdown.'
          : script.source === 'default'
            ? 'Currently showing the default. Edit + save to create your own copy.'
            : 'No script yet. Edit + save to create one.'
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={cn(
              'px-2 py-0.5 rounded-full font-semibold',
              script.source === 'own'
                ? 'bg-[#3C5A87]/10 text-[#3C5A87]'
                : 'bg-[#F3F3EE] text-[#6B7280]'
            )}
          >
            {script.source === 'own'
              ? '● Your version'
              : script.source === 'default'
                ? '○ Default (read-only preview)'
                : '○ Empty'}
          </span>
          {script.source === 'own' && (
            <button
              onClick={() => void resetToDefault()}
              disabled={saving}
              className="text-[10px] text-[#6B7280] underline hover:text-[#EF4444] disabled:opacity-50"
            >
              Reset to default
            </button>
          )}
        </div>
        <div>
          <Label>
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" /> Script name
            </span>
          </Label>
          <input
            type="text"
            value={script.name}
            onChange={(e) => setField('name', e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] disabled:bg-[#F9FAFB]"
          />
        </div>
        <div>
          <Label>Body (Markdown)</Label>
          <textarea
            value={script.body_md}
            onChange={(e) => setField('body_md', e.target.value)}
            disabled={loading}
            rows={18}
            placeholder={loading ? 'Loading…' : '# Open\n- "Hi {{first_name}}, this is {{agent_first_name}}…"'}
            className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E7EB] rounded-[10px] disabled:bg-[#F9FAFB]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || loading}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save my script'}
          </button>
          <span className="text-[10px] text-[#9CA3AF]">
            Stored in <code className="bg-[#F3F3EE] px-1 rounded">wk_call_scripts</code> with{' '}
            <code className="bg-[#F3F3EE] px-1 rounded">owner_agent_id = your user id</code>.
            Live-call screen reads your own script first, falls back to default.
          </span>
        </div>
        {error && <div className="text-[10px] text-[#EF4444]">⚠ {error}</div>}
      </div>
    </Card>
  );
}

// ─── Default call script (admin) — fallback for everyone ──────────
function CallScriptCard() {
  const { script, loading, saving, saved, error, setField, save } = useDefaultCallScript();
  return (
    <Card
      title="Default call script (admin)"
      hint="Fallback for any agent who hasn't saved their own. Markdown."
    >
      <div className="space-y-3">
        <div>
          <Label>
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" /> Script name
            </span>
          </Label>
          <input
            type="text"
            value={script.name}
            onChange={(e) => setField('name', e.target.value)}
            disabled={loading}
            className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] disabled:bg-[#F9FAFB]"
          />
        </div>
        <div>
          <Label>Body (Markdown)</Label>
          <textarea
            value={script.body_md}
            onChange={(e) => setField('body_md', e.target.value)}
            disabled={loading}
            rows={18}
            placeholder={loading ? 'Loading…' : '# Open\n- "Hi {{first_name}}, this is {{agent_first_name}}…"'}
            className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E7EB] rounded-[10px] disabled:bg-[#F9FAFB]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || loading}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-2 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save script'}
          </button>
          <span className="text-[10px] text-[#9CA3AF]">
            Stored in <code className="bg-[#F3F3EE] px-1 rounded">wk_call_scripts</code> (is_default = true).
            Live-call CallScriptPane reads this row.
          </span>
        </div>
        {error && <div className="text-[10px] text-[#EF4444]">⚠ {error}</div>}
      </div>
    </Card>
  );
}

// ─── Glossary tab — wk_terminologies CRUD (admin) ─────────────────
function GlossaryTab({
  campaignId = null,
}: { campaignId?: string | null } = {}) {
  // PR 56: campaign-aware. workspace rows show as inherited; new
  // entries go into wk_campaign_terminologies when scoped to a campaign.
  const { items, loading, error, add, patch, remove } = useTerminologies({ campaignId });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    term: string;
    short_gist: string;
    definition_md: string;
  }>({ term: '', short_gist: '', definition_md: '' });
  const [actionError, setActionError] = useState<string | null>(null);

  const startEdit = (t: Terminology) => {
    setEditingId(t.id);
    setDraft({
      term: t.term,
      short_gist: t.short_gist ?? '',
      definition_md: t.definition_md,
    });
  };

  const startNew = () => {
    setEditingId('new');
    setDraft({ term: '', short_gist: '', definition_md: '' });
  };

  const cancel = () => {
    setEditingId(null);
    setDraft({ term: '', short_gist: '', definition_md: '' });
    setActionError(null);
  };

  const save = async () => {
    setActionError(null);
    // PR 90 (Hugo 2026-04-27): empty term/definition rendered blank rows
    // in the live-call glossary panel. Validate at the boundary.
    if (!draft.term.trim()) {
      setActionError('Term is required.');
      return;
    }
    if (!draft.definition_md.trim()) {
      setActionError('Definition is required.');
      return;
    }
    try {
      if (editingId === 'new') {
        const nextOrder = (items[items.length - 1]?.sort_order ?? 0) + 10;
        await add({
          term: draft.term.trim(),
          short_gist: draft.short_gist.trim() || null,
          definition_md: draft.definition_md.trim(),
          // wk_terminologies.category is NOT NULL DEFAULT 'glossary';
          // this tab only creates glossary entries, so pass it explicitly
          // to satisfy TermInsert (matches the DB default — no behaviour change).
          category: 'glossary',
          sort_order: nextOrder,
          is_active: true,
        });
      } else if (editingId) {
        await patch(editingId, {
          term: draft.term.trim(),
          short_gist: draft.short_gist.trim() || null,
          definition_md: draft.definition_md.trim(),
        });
      }
      cancel();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'save failed');
    }
  };

  const toggleActive = async (t: Terminology) => {
    setActionError(null);
    try {
      await patch(t.id, { is_active: !t.is_active });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'update failed');
    }
  };

  const move = async (t: Terminology, dir: -1 | 1) => {
    const idx = items.findIndex((x) => x.id === t.id);
    const swapWith = items[idx + dir];
    if (!swapWith) return;
    setActionError(null);
    try {
      await Promise.all([
        patch(t.id, { sort_order: swapWith.sort_order }),
        patch(swapWith.id, { sort_order: t.sort_order }),
      ]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'reorder failed');
    }
  };

  const del = async (t: Terminology) => {
    if (!confirm(`Delete "${t.term}"? This is permanent.`)) return;
    setActionError(null);
    try {
      await remove(t.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  return (
    <>
      <Card
        title="Glossary"
        hint="Terms shown on the live-call screen (col 4). Realtime — agents see edits live."
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] text-[#6B7280]">
            {loading ? 'Loading…' : `${items.length} terms`}
          </div>
          <button
            onClick={startNew}
            disabled={editingId !== null}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" /> Add term
          </button>
        </div>

        {(error || actionError) && (
          <div className="text-[11px] text-[#EF4444] mb-2">
            ⚠ {actionError ?? error}
          </div>
        )}

        {editingId === 'new' && (
          <GlossaryEditor
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={cancel}
          />
        )}

        <div className="space-y-2">
          {items.map((t, i) => (
            <div
              key={t.id}
              className={cn(
                'border rounded-xl p-3 transition-colors',
                t.is_active
                  ? 'border-[#E5E7EB] bg-white'
                  : 'border-[#E5E7EB] bg-[#F9FAFB] opacity-70'
              )}
            >
              {editingId === t.id ? (
                <GlossaryEditor
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                />
              ) : (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center gap-0.5 pt-0.5">
                    <button
                      onClick={() => void move(t, -1)}
                      disabled={i === 0}
                      className="text-[#9CA3AF] hover:text-[#1A1A1A] disabled:opacity-30 text-[10px]"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => void move(t, 1)}
                      disabled={i === items.length - 1}
                      className="text-[#9CA3AF] hover:text-[#1A1A1A] disabled:opacity-30 text-[10px]"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[14px] font-semibold text-[#1A1A1A]">
                        {t.term}
                      </div>
                      {!t.is_active && (
                        <span className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">
                          inactive
                        </span>
                      )}
                    </div>
                    {t.short_gist && (
                      <div className="text-[12px] text-[#6B7280] mt-0.5">
                        {t.short_gist}
                      </div>
                    )}
                    <details className="mt-1.5">
                      <summary className="text-[11px] text-[#3C5A87] cursor-pointer hover:underline">
                        Show definition
                      </summary>
                      <pre className="mt-2 text-[11px] text-[#1A1A1A] whitespace-pre-wrap font-mono bg-[#F3F3EE] rounded p-2 leading-relaxed">
                        {t.definition_md}
                      </pre>
                    </details>
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] hover:bg-[#F3F3EE] text-[#1A1A1A]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void toggleActive(t)}
                      className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] hover:bg-[#F3F3EE] text-[#6B7280]"
                    >
                      {t.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => void del(t)}
                      className="text-[11px] px-2 py-1 rounded-md text-[#EF4444] hover:bg-[#FEF2F2]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!loading && items.length === 0 && editingId !== 'new' && (
            <div className="text-[12px] text-[#9CA3AF] text-center py-6">
              No glossary terms yet. Click "Add term" to create the first one.
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function GlossaryEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: { term: string; short_gist: string; definition_md: string };
  setDraft: (d: { term: string; short_gist: string; definition_md: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (k: keyof typeof draft, v: string) => setDraft({ ...draft, [k]: v });
  const canSave = draft.term.trim().length > 0 && draft.definition_md.trim().length > 0;
  return (
    <div className="border border-[#3C5A87]/40 bg-[#EEF2F8] rounded-xl p-3 mb-3 space-y-2">
      <div>
        <Label>Term</Label>
        <input
          type="text"
          value={draft.term}
          onChange={(e) => set('term', e.target.value)}
          placeholder="e.g. Gross yield"
          className="w-full px-3 py-2 text-[13px] border border-[#E5E7EB] rounded-[10px] bg-white"
        />
      </div>
      <div>
        <Label>Short gist (one line, shown collapsed)</Label>
        <input
          type="text"
          value={draft.short_gist}
          onChange={(e) => set('short_gist', e.target.value)}
          placeholder="e.g. Annual rental income / property value, before costs."
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
        />
      </div>
      <div>
        <Label>Definition (Markdown)</Label>
        <textarea
          value={draft.definition_md}
          onChange={(e) => set('definition_md', e.target.value)}
          rows={5}
          placeholder="**Term** — full definition. Use **bold** + bullets if needed."
          className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E7EB] rounded-[10px] bg-white"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Knowledge base — wk_coach_facts CRUD (Hugo 2026-04-29) ──────
//
// Three-layer prompt system:
//   - Layer 1 (Style):   wk_ai_settings.coach_style_prompt    (AI tab)
//   - Layer 2 (Script):  wk_ai_settings.coach_script_prompt   (AI tab)
//   - Layer 3 (Facts):   wk_coach_facts                       (this tab)
//
// Facts the model may quote when the caller asks a direct factual
// question. The edge fn matches keywords against the caller's last
// utterance and passes the matches as a "POSSIBLY RELEVANT FACTS" hint.
// See docs/runbooks/COACH_PROMPT_LAYERS.md.
function KnowledgeBaseTab({
  campaignId = null,
}: { campaignId?: string | null } = {}) {
  // PR 56: when campaignId is set, edits go to wk_campaign_facts
  // and the list shows merged workspace + campaign facts. The hook
  // already handles that — we just thread the prop through.
  const { items, loading, error, add, patch, remove } = useCoachFacts({ campaignId });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    key: string;
    label: string;
    value: string;
    keywordsRaw: string;
  }>({ key: '', label: '', value: '', keywordsRaw: '' });
  const [actionError, setActionError] = useState<string | null>(null);

  const startEdit = (f: CoachFact) => {
    setEditingId(f.id);
    setDraft({
      key: f.key,
      label: f.label,
      value: f.value,
      keywordsRaw: f.keywords.join(', '),
    });
  };

  const startNew = () => {
    setEditingId('new');
    setDraft({ key: '', label: '', value: '', keywordsRaw: '' });
  };

  const cancel = () => {
    setEditingId(null);
    setDraft({ key: '', label: '', value: '', keywordsRaw: '' });
    setActionError(null);
  };

  const parseKeywords = (raw: string) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const save = async () => {
    setActionError(null);
    // PR 90 (Hugo 2026-04-27): KB key/value empty save was silently
    // accepted, breaking coach matching. Hard-fail at the boundary.
    if (!draft.key.trim()) {
      setActionError('Key is required (used by coach to match keywords).');
      return;
    }
    if (!draft.value.trim()) {
      setActionError('Value is required (the answer the coach speaks).');
      return;
    }
    try {
      const keywords = parseKeywords(draft.keywordsRaw);
      if (editingId === 'new') {
        const nextOrder = (items[items.length - 1]?.sort_order ?? 0) + 10;
        await add({
          key: draft.key.trim(),
          label: draft.label.trim(),
          value: draft.value.trim(),
          keywords,
          // wk_coach_facts.category is NOT NULL DEFAULT 'deal'; this tab
          // creates general facts, so pass it explicitly to satisfy
          // FactInsert (matches the DB default — no behaviour change).
          category: 'deal',
          sort_order: nextOrder,
          is_active: true,
        });
      } else if (editingId) {
        await patch(editingId, {
          key: draft.key.trim(),
          label: draft.label.trim(),
          value: draft.value.trim(),
          keywords,
        });
      }
      cancel();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'save failed');
    }
  };

  const toggleActive = async (f: CoachFact) => {
    setActionError(null);
    try {
      await patch(f.id, { is_active: !f.is_active });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'update failed');
    }
  };

  const move = async (f: CoachFact, dir: -1 | 1) => {
    const idx = items.findIndex((x) => x.id === f.id);
    const swapWith = items[idx + dir];
    if (!swapWith) return;
    setActionError(null);
    try {
      await Promise.all([
        patch(f.id, { sort_order: swapWith.sort_order }),
        patch(swapWith.id, { sort_order: f.sort_order }),
      ]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'reorder failed');
    }
  };

  const del = async (f: CoachFact) => {
    if (!confirm(`Delete fact "${f.key}"? This is permanent.`)) return;
    setActionError(null);
    try {
      await remove(f.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'delete failed');
    }
  };

  return (
    <>
      <Card
        title="Coach facts"
        hint="Facts the AI may quote during a call. Edits propagate live."
      >
        <div className="text-[12px] text-[#6B7280] leading-snug mb-3">
          The coach matches each fact's <code className="bg-[#F3F3EE] px-1 rounded">keywords</code> against the caller's last utterance. Matches get highlighted to the model as <span className="font-semibold">POSSIBLY RELEVANT FACTS</span>. The full table is also passed in every call as the system-message KB. The model must answer factual questions ONLY from this table — it's instructed not to guess.
        </div>

        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] text-[#6B7280]">
            {loading ? 'Loading…' : `${items.length} facts`}
          </div>
          <button
            onClick={startNew}
            disabled={editingId !== null}
            className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] inline-flex items-center gap-1 hover:bg-[#3C5A87]/90 disabled:opacity-60"
          >
            <Plus className="w-3.5 h-3.5" /> Add fact
          </button>
        </div>

        {(error || actionError) && (
          <div className="text-[11px] text-[#EF4444] mb-2">
            ⚠ {actionError ?? error}
          </div>
        )}

        {editingId === 'new' && (
          <KnowledgeBaseEditor
            draft={draft}
            setDraft={setDraft}
            onSave={save}
            onCancel={cancel}
          />
        )}

        <div className="space-y-2">
          {items.map((f, i) => (
            <div
              key={f.id}
              className={cn(
                'border rounded-xl p-3 transition-colors',
                f.is_active
                  ? 'border-[#E5E7EB] bg-white'
                  : 'border-[#E5E7EB] bg-[#F9FAFB] opacity-70'
              )}
            >
              {editingId === f.id ? (
                <KnowledgeBaseEditor
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                />
              ) : (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center gap-0.5 pt-0.5">
                    <button
                      onClick={() => void move(f, -1)}
                      disabled={i === 0}
                      className="text-[#9CA3AF] hover:text-[#1A1A1A] disabled:opacity-30 text-[10px]"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => void move(f, 1)}
                      disabled={i === items.length - 1}
                      className="text-[#9CA3AF] hover:text-[#1A1A1A] disabled:opacity-30 text-[10px]"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] bg-[#F3F3EE] text-[#525252] px-1.5 py-0.5 rounded font-mono">
                        {f.key}
                      </code>
                      <div className="text-[13px] font-semibold text-[#1A1A1A]">
                        {f.label}
                      </div>
                      {!f.is_active && (
                        <span className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-[#1A1A1A] mt-1 leading-snug">
                      {f.value}
                    </div>
                    {f.keywords.length > 0 && (
                      <div className="text-[10px] text-[#6B7280] mt-1.5">
                        <span className="uppercase tracking-wide font-semibold mr-1">
                          keywords:
                        </span>
                        {f.keywords.join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => startEdit(f)}
                      className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] hover:bg-[#F3F3EE] text-[#1A1A1A]"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void toggleActive(f)}
                      className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] hover:bg-[#F3F3EE] text-[#6B7280]"
                    >
                      {f.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => void del(f)}
                      className="text-[11px] px-2 py-1 rounded-md text-[#EF4444] hover:bg-[#FEF2F2]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!loading && items.length === 0 && editingId !== 'new' && (
            <div className="text-[12px] text-[#9CA3AF] text-center py-6">
              No facts yet. Click "Add fact" to seed the coach facts.
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function KnowledgeBaseEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  draft: { key: string; label: string; value: string; keywordsRaw: string };
  setDraft: (d: { key: string; label: string; value: string; keywordsRaw: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (k: keyof typeof draft, v: string) => setDraft({ ...draft, [k]: v });
  const canSave =
    draft.key.trim().length > 0 &&
    draft.label.trim().length > 0 &&
    draft.value.trim().length > 0;
  return (
    <div className="border border-[#3C5A87]/40 bg-[#EEF2F8] rounded-xl p-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Key (snake_case identifier)</Label>
          <input
            type="text"
            value={draft.key}
            onChange={(e) => set('key', e.target.value)}
            placeholder="e.g. partner_count"
            className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
        <div>
          <Label>Label (human-readable)</Label>
          <input
            type="text"
            value={draft.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="e.g. Partners on the deal"
            className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
          />
        </div>
      </div>
      <div>
        <Label>Value (the answer the AI should quote)</Label>
        <textarea
          value={draft.value}
          onChange={(e) => set('value', e.target.value)}
          rows={3}
          placeholder="e.g. About 14 partners already on this deal."
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
        />
      </div>
      <div>
        <Label>Keywords (comma-separated trigger phrases)</Label>
        <input
          type="text"
          value={draft.keywordsRaw}
          onChange={(e) => set('keywordsRaw', e.target.value)}
          placeholder="how many people, how many partners, partner count"
          className="w-full px-3 py-2 text-[12px] border border-[#E5E7EB] rounded-[10px] bg-white"
        />
        <div className="text-[10px] text-[#9CA3AF] mt-1">
          Substring match against the caller's last utterance (case-insensitive). Each phrase comma-separated.
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={!canSave}
          className="bg-[#3C5A87] text-white text-[12px] font-semibold px-3 py-1.5 rounded-[10px] hover:bg-[#3C5A87]/90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="text-[12px] text-[#6B7280] px-3 py-1.5 rounded-[10px] hover:bg-[#F3F3EE]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Pacing ────────────────────────────────────────────────────────
function PacingTab() {
  return (
    <>
      {/* PR 27 honesty banner: every input here is uncontrolled with
          static defaultValues — nothing saves anywhere. Real pacing
          + block-list lands in a follow-up. Existing per-agent spend
          limits + the global kill switch ARE wired (see Agents +
          Kill-switches tabs); this tab is the future home for CSV
          block-list + global concurrency caps. */}
      <Card title="Pacing & safety">
        <div className="px-3 py-2 bg-[#FFFBEB] border border-[#F59E0B]/40 rounded-[10px] text-[11px] text-[#92400E]">
          ⚠ Coming soon — none of the inputs below persist yet. Per-agent
          spend caps (real, persisted) live in the <strong>Agents & spend</strong>
          tab. Global kill switches are in the <strong>Kill switches & audit</strong>
          tab. The block list + global parallel-line cap shown here is a
          mockup; if you need to block a number today, do it in the
          Twilio console or via SQL on <code className="bg-white/60 px-1 rounded">sms_opt_outs</code>.
        </div>
      </Card>
      <Card title="Global limits (mockup)">
        <div className="grid grid-cols-2 gap-3 opacity-60">
          <Field label="Max parallel lines per agent">
            <input
              defaultValue={3}
              disabled
              className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[10px] tabular-nums bg-[#F3F3EE] cursor-not-allowed"
            />
          </Field>
          <Field label="Retry attempts cap per lead">
            <input
              defaultValue={3}
              disabled
              className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-[10px] tabular-nums bg-[#F3F3EE] cursor-not-allowed"
            />
          </Field>
        </div>
      </Card>
      <Card title="Block list (mockup)" hint="Numbers we never dial">
        <textarea
          rows={4}
          disabled
          defaultValue={'+44 7000 000000\n+44 7000 000001'}
          className="w-full px-3 py-2 text-[12px] font-mono border border-[#E5E7EB] rounded-[10px] bg-[#F3F3EE] cursor-not-allowed opacity-60"
        />
      </Card>
    </>
  );
}

// ─── Kill switches ─────────────────────────────────────────────────
function KillTab() {
  const ks = useKillSwitch();
  return (
    <>
      <Card title="Active kill switches">
        <div className="space-y-2">
          {(['allDialers', 'aiCoach', 'outbound'] as const).map((k) => (
            <button
              key={k}
              onClick={() => ks.toggle(k)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2',
                ks[k]
                  ? 'border-[#EF4444] bg-[#FEF2F2] text-[#B91C1C]'
                  : 'border-[#E5E7EB] bg-white text-[#1A1A1A] hover:border-[#EF4444]/40'
              )}
            >
              <span className="text-[13px] font-semibold capitalize">
                {k.replace(/([A-Z])/g, ' $1').trim()}
              </span>
              <span className="text-[11px]">{ks[k] ? 'ACTIVE' : 'inactive'}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Audit log" hint="Last 5 events">
        <div className="space-y-1.5 text-[12px]">
          {[
            { who: 'Hugo', what: 'Set Tom limit £10 → £25', when: '2m ago' },
            { who: 'Hugo', what: 'Pause All Dialers → ON', when: '8m ago' },
            { who: 'Tom', what: 'Updated SMS template "Thanks"', when: '14m ago' },
            { who: 'Hugo', what: 'Disabled AI coach (Re-engage)', when: '38m ago' },
            { who: 'System', what: 'Daily spend reset', when: '7h ago' },
          ].map((e, i) => (
            <div
              key={i}
              className="flex items-center gap-2 py-1.5 border-b border-[#E5E7EB] last:border-0"
            >
              <span className="text-[#1A1A1A] font-semibold w-12">{e.who}</span>
              <span className="text-[#6B7280] flex-1">{e.what}</span>
              <span className="text-[10px] text-[#9CA3AF] tabular-nums">{e.when}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-1">
      {children}
    </div>
  );
}
