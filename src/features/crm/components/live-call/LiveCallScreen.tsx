import { useState } from 'react';
import {
  MicOff,
  PhoneOff,
  Minimize2,
  Flame,
  Pencil,
  X,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/features/crm/ui/resizable';
import { useActiveCallCtx } from './ActiveCallContext';
import LiveTranscriptPane from './LiveTranscriptPane';
import CallScriptPane from './CallScriptPane';
import TerminologyPane from './TerminologyPane';
import MidCallSmsSender from './MidCallSmsSender';
import ContactMetaCompact from './ContactMetaCompact';
import CallTimeline from './CallTimeline';
import PostCallPanel from './PostCallPanel';
import EditContactModal from '../contacts/EditContactModal';
import type { Contact } from '../../types';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useCurrentAgent } from '../../hooks/useCurrentAgent';
import { useDialerCampaigns } from '../../hooks/useDialerCampaigns';
import {
  formatDuration,
  formatPence,
  formatRelativeTime,
} from '../../data/helpers';

export default function LiveCallScreen() {
  const {
    phase,
    call,
    durationSec,
    endCall,
    fullScreen,
    setFullScreen,
    muted,
    toggleMute,
    previewContactId,
    closeCallRoom,
    startCall,
  } = useActiveCallCtx();
  const store = useSmsV2();
  const { agent: me, firstName: myFirstName, talkRatioPercent } = useCurrentAgent();
  // Resolve the active call's pipeline_id so MidCallSmsSender's stage
  // picker scopes to the right pipeline. Without this the dropdown
  // lists every pipeline's columns flattened.
  const { campaigns } = useDialerCampaigns({ includeInactive: true });
  const callPipelineId = call?.campaignId
    ? campaigns.find((c) => c.id === call.campaignId)?.pipelineId ?? null
    : null;
  const [editing, setEditing] = useState<Contact | null>(null);

  // Preview mode (PR 10): no active call, but agent opened the room for
  // a specific contact from the inbox. Use that contact instead of the
  // active call's contact. When neither is set, fall back to first
  // contact (legacy direct-dial case).
  const isPreview = phase === 'idle' && previewContactId !== null;
  const contact =
    store.contacts.find((c) =>
      isPreview ? c.id === previewContactId : c.id === call?.contactId
    ) ?? store.contacts[0] ?? null;

  const contactFirstName = contact?.name?.trim().split(/\s+/)[0] ?? '';

  if (!fullScreen) return null;

  if (!contact) {
    return (
      <div className="fixed inset-0 z-[200] bg-[#F3F3EE] flex flex-col">
        <header className="h-14 flex items-center px-5 gap-3 flex-shrink-0 bg-white border-b border-[#E5E7EB]">
          <span className="text-[14px] font-semibold text-[#1A1A1A]">Call room</span>
          <div className="ml-auto">
            <button onClick={closeCallRoom} className="p-2 rounded-lg hover:bg-black/[0.04]">
              <Minimize2 className="w-4 h-4 text-[#6B7280]" />
            </button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[14px] text-[#9CA3AF]">Select a contact or start a campaign to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] bg-[#F3F3EE] flex flex-col">
      {/* Top bar — three visual states:
            placing  → black bar with ringing dots (Hugo: no orange/red here)
            in_call  → green bar with pulsing dot + duration
            post_call → white bar, muted */}
      <header
        className={cn(
          'h-14 flex items-center px-5 gap-3 flex-shrink-0 transition-colors',
          phase === 'in_call' && 'bg-[#3C5A87] text-white',
          phase === 'placing' && 'bg-[#1A1A1A] text-white',
          phase === 'post_call' && 'bg-white border-b border-[#E5E7EB] text-[#1A1A1A]',
          phase === 'idle' && 'bg-white border-b border-[#E5E7EB] text-[#1A1A1A]'
        )}
      >
        {phase === 'placing' ? (
          <span className="relative w-2.5 h-2.5 inline-flex">
            <span className="absolute inset-0 rounded-full bg-white animate-ping" />
            <span className="relative w-2.5 h-2.5 rounded-full bg-white" />
          </span>
        ) : (
          <span
            className={cn(
              'w-2.5 h-2.5 rounded-full',
              phase === 'in_call' && 'bg-white animate-pulse',
              (phase === 'post_call' || phase === 'idle') && 'bg-[#3C5A87]'
            )}
          />
        )}
        <span className="text-[14px] font-semibold flex items-center gap-2">
          {phase === 'placing' && (
            <>
              <span>Calling {call?.contactName}</span>
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </>
          )}
          {phase === 'in_call' && (
            <>
              <span>In call · {call?.contactName}</span>
              <span className="ml-2 tabular-nums opacity-90">{formatDuration(durationSec)}</span>
            </>
          )}
          {phase === 'post_call' && <span>Call ended · {call?.contactName}</span>}
          {phase === 'idle' && !isPreview && <span>Idle</span>}
          {isPreview && (
            <>
              <span>Call room · {contact?.name}</span>
              <span className="ml-1 text-[10px] uppercase tracking-wide font-semibold bg-[#3C5A87]/10 text-[#3C5A87] px-1.5 py-0.5 rounded">
                Preview
              </span>
            </>
          )}
        </span>

        {phase === 'in_call' && (
          <div className="ml-6 flex items-center gap-1">
            <TopBtn
              icon={<MicOff className="w-4 h-4" />}
              label={muted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
              active={muted}
            />
            {/* PR 89 (Hugo 2026-04-27): Hold / Transfer / Note buttons
                were rendered with no onClick \u2014 pure dead UI. Hold +
                Transfer require Twilio routing changes (out of scope
                for the inbox audit). Note duplicates the sticky-note
                textarea in the transcript pane, so we drop it here. */}
            {muted && (
              // Self-test hint: when Hugo calls his own phone in the same
              // room and mutes the browser, his phone's OWN microphone keeps
              // picking up ambient sound and sending it back. Mute can only
              // silence the browser side. Headphones eliminate the loop.
              <span className="ml-2 text-[11px] text-white/80">
                Mic off · your phone's mic may still hear the room
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Agent today stats */}
          <div
            className={cn(
              'hidden md:flex items-center gap-3 text-[11px] px-3 py-1 rounded-full',
              phase === 'in_call'
                ? 'bg-white/15 text-white'
                : 'bg-[#F3F3EE] border border-[#E5E7EB] text-[#6B7280]'
            )}
          >
            <span>
              Talk{' '}
              <span className="font-semibold tabular-nums">{talkRatioPercent}%</span>
            </span>
            <span className="opacity-50">·</span>
            <span>
              Calls{' '}
              <span className="font-semibold tabular-nums">{me?.callsToday ?? 0}</span>
            </span>
            {/* PR 109 (Hugo 2026-04-28): spend is admin-only across the CRM. */}
            {me?.isAdmin && (
              <>
                <span className="opacity-50">·</span>
                <span>
                  Spend{' '}
                  <span className="font-semibold tabular-nums">
                    {formatPence(me?.spendPence ?? 0)}
                  </span>
                </span>
              </>
            )}
          </div>

          {phase === 'in_call' && (
            <button
              onClick={endCall}
              className="flex items-center gap-1.5 bg-[#EF4444] hover:bg-[#DC2626] text-white px-3 py-1.5 rounded-[10px] text-[12px] font-semibold"
            >
              <PhoneOff className="w-3.5 h-3.5" /> End call
            </button>
          )}

          {/* PR 107 (Hugo 2026-04-28): cancel a call mid-ring. Without
              this the only way out of the placing phase was waiting for
              Twilio to time out. Same endCall handler as in_call. */}
          {phase === 'placing' && (
            <button
              onClick={endCall}
              className="flex items-center gap-1.5 bg-[#EF4444] hover:bg-[#DC2626] text-white px-3 py-1.5 rounded-[10px] text-[12px] font-semibold"
              data-testid="livecall-cancel-placing"
            >
              <PhoneOff className="w-3.5 h-3.5" /> Cancel
            </button>
          )}

          {/* Preview mode: agent can dial the lead from inside the call
              room without bouncing back to the inbox. Closing the room
              uses closeCallRoom() instead of fullScreen toggle. */}
          {isPreview && (
            <button
              onClick={() => void startCall(contact.id)}
              className="flex items-center gap-1.5 bg-[#3C5A87] hover:bg-[#3C5A87]/90 text-white px-3 py-1.5 rounded-[10px] text-[12px] font-semibold shadow-[0_4px_12px_rgba(30,154,128,0.35)]"
            >
              <PhoneOff className="w-3.5 h-3.5 rotate-[135deg]" /> Call now
            </button>
          )}

          <button
            onClick={() => (isPreview ? closeCallRoom() : setFullScreen(false))}
            className={cn(
              'p-1.5 rounded-lg',
              phase === 'in_call' ? 'hover:bg-white/15' : 'hover:bg-black/[0.04]'
            )}
            title={isPreview ? 'Close call room' : 'Minimise (call continues)'}
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          {/* PR 114 (Hugo 2026-04-28): explicit Close button. Hugo:
              "I should be able to close the call room altogether — I
              can minimize but I want a way to fully close." Behaviour:
                preview → closeCallRoom (exit preview)
                in_call / post_call → setFullScreen(false) AND
                  closeCallRoom (collapses to softphone bar; active
                  call NOT ended — the End button is for that)
              X icon makes the close intent visually obvious vs the
              minimize icon next to it. */}
          <button
            onClick={() => {
              if (isPreview) closeCallRoom();
              else {
                setFullScreen(false);
                closeCallRoom();
              }
            }}
            className={cn(
              'p-1.5 rounded-lg',
              phase === 'in_call' ? 'hover:bg-white/15' : 'hover:bg-black/[0.04]'
            )}
            title={
              phase === 'in_call'
                ? 'Close (call continues in background — use End to hang up)'
                : 'Close call room'
            }
            data-testid="livecall-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Resizable 4-column body (Hugo 2026-04-26):
            COL 1 — contact context (name, stage, KV, sticky notes)
            COL 2 — live transcript + AI coach (vertical resize inside)
            COL 3 — call script (admin-edited via /smsv2/settings)
            COL 4 — glossary (click-to-expand, admin-edited via Settings)
          autoSaveId bumped to v2 so old 3-col widths don't bleed in. */}
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="smsv2-live-call-layout-v2"
        className="flex-1 overflow-hidden"
        style={{ paddingTop: 'var(--followup-banner-h, 0px)' }}
      >
        {/* COL 1 — lead context */}
        <ResizablePanel defaultSize={20} minSize={14} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-2">
              <div className="text-[16px] font-bold text-[#1A1A1A]">{contact.name}</div>
              {contact.isHot && (
                <span
                  className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#FEF2F2', color: '#EF4444' }}
                >
                  <Flame className="w-3 h-3" /> HOT
                </span>
              )}
              <button
                onClick={() => setEditing(contact)}
                className="ml-auto p-1 rounded hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A]"
                title="Edit lead"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Owner name + website beside the company name (Hugo 2026-07-26). */}
            {(() => {
              const owner = (contact.customFields?.owner_name || '').trim();
              const site = (contact.customFields?.website || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
              return (
                <div className="mt-0.5 space-y-0.5">
                  <div className={owner ? 'text-[12px] text-[#374151]' : 'text-[12px] text-[#C4302B] italic'}>{owner || 'Name not available'}</div>
                  <div className={site ? 'text-[11px] text-[#3C5A87] truncate' : 'text-[11px] text-[#C4302B] italic'}>{site || 'Website not available'}</div>
                </div>
              );
            })()}
            <div className="text-[12px] text-[#6B7280] tabular-nums mt-0.5">{contact.phone}</div>
            <div className="text-[11px] text-[#9CA3AF] mt-0.5">
              Added {formatRelativeTime(contact.createdAt)}
            </div>
            {/* Phase 6 (Hugo 2026-04-30): compact meta — pipeline + tags
                + last-contact side-by-side, frees vertical space for the
                timeline below SMS. */}
            <div className="mt-2">
              <ContactMetaCompact contact={contact} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-[12px]">
            {/* Mid-call SMS sender (Hugo 2026-04-26): templated send without
                leaving the call screen. Reuses sms-send edge fn. */}
            <MidCallSmsSender
              contactId={contact.id}
              contactName={contact.name}
              contactPhone={contact.phone}
              contactEmail={contact.email}
              agentFirstName={myFirstName ?? ''}
              campaignId={call?.campaignId ?? null}
              pipelineId={callPipelineId}
            />
            {/* Phase 6 (Hugo 2026-04-30): timeline below SMS — sends,
                coach lines, stage moves, notes. Reads wk_call_timeline. */}
            <CallTimeline callId={call?.callId ?? null} />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* COL 2 — transcript + coach during dial/in-call, post-call panel
            after hangup. We mount LiveTranscriptPane the moment callId is
            known (during 'placing'), not just on 'in_call', so we don't miss
            the first transcript chunks Twilio fires before bridge-accept. */}
        <ResizablePanel defaultSize={38} minSize={26} className="bg-white border-r border-[#E5E7EB] overflow-hidden">
          {phase === 'placing' || phase === 'in_call' ? (
            <LiveTranscriptPane
              durationSec={durationSec}
              contactId={contact.id}
              callId={call?.callId ?? null}
              agentFirstName={myFirstName ?? ''}
            />
          ) : isPreview ? (
            // PR 10: preview mode — no active call, show the empty
            // transcript / coach layout so the agent sees the FULL call-
            // room view for the lead, ready to dial.
            <LiveTranscriptPane
              durationSec={0}
              contactId={contact.id}
              callId={null}
              agentFirstName={myFirstName ?? ''}
            />
          ) : (
            <PostCallPanel />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* COL 3 — call script with click-to-mark-as-read tracking. */}
        <ResizablePanel defaultSize={22} minSize={14} className="border-r border-[#E5E7EB] overflow-hidden">
          <CallScriptPane
            callId={call?.callId ?? null}
            contactFirstName={contactFirstName}
            agentFirstName={myFirstName ?? ''}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* COL 4 — message history + glossary (PR Hugo 2026-05-15: replaced
            Objections tab with the contact's SMS/WhatsApp timeline) */}
        <ResizablePanel defaultSize={20} minSize={14} className="overflow-hidden">
          <TerminologyPane contactId={contact?.id} />
        </ResizablePanel>
      </ResizablePanelGroup>

      <EditContactModal
        contact={editing}
        onClose={() => setEditing(null)}
        onSave={async (updated) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('wk_contacts' as any) as any)
            .update({
              name: updated.name || null,
              phone: updated.phone,
              email: updated.email || null,
              pipeline_column_id: updated.pipelineColumnId || null,
              owner_agent_id: updated.ownerAgentId || null,
              is_hot: updated.isHot,
              deal_value_pence: updated.dealValuePence ?? null,
              custom_fields: updated.customFields,
            })
            .eq('id', updated.id);
          // Tags live in wk_contact_tags, not wk_contacts.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase.from('wk_contact_tags' as any) as any)
            .delete()
            .eq('contact_id', updated.id);
          if (updated.tags.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase.from('wk_contact_tags' as any) as any)
              .insert(updated.tags.map((t) => ({ contact_id: updated.id, tag: t })));
          }
          store.upsertContact(updated);
        }}
      />
    </div>
  );
}

function TopBtn({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors',
        active ? 'bg-white text-[#3C5A87]' : 'hover:bg-white/15'
      )}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

// KV helper removed in Phase 6 — meta moved into ContactMetaCompact.
