import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MicOff,
  PhoneOff,
  Minimize2,
  Flame,
  Pencil,
  X,
  Hash,
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
import PropertyCallRoom from './PropertyCallRoom';
import BranchSearchPanel from './BranchSearchPanel';
import DtmfKeypad from '../../dialer-pro/controls/DtmfKeypad';
import EditContactModal from '../contacts/EditContactModal';
import type { Contact } from '../../types';
import { supabase } from '@/integrations/supabase/browser';
import { findByPhone, samePhone } from '../../../../../api/lib/phone-match';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useCurrentAgent } from '../../hooks/useCurrentAgent';
import { useDialerCampaigns } from '../../hooks/useDialerCampaigns';
import { usePropertyListings } from '../../hooks/usePropertyListings';
import { useAgentDefaultScript } from '../../hooks/useAgentDefaultScript';
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
    sendDigit,
    previewContactId,
    closeCallRoom,
    startCall,
  } = useActiveCallCtx();
  // IVR keypad, shut until the agent needs it. Closes itself when the call
  // ends so it is never left hanging over the wrap-up screen.
  const [keypadOpen, setKeypadOpen] = useState(false);
  useEffect(() => {
    if (phase !== 'in_call') setKeypadOpen(false);
  }, [phase]);
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
  // active call's contact.
  const isPreview = phase === 'idle' && previewContactId !== null;

  // The branch Pedro picked out of the search, when the caller's number
  // matched nothing. It outranks everything: he has just told us who this is.
  const [pickedContact, setPickedContact] = useState<Contact | null>(null);
  useEffect(() => { setPickedContact(null); }, [call?.startedAt]);

  // WHO IS ON THE PHONE.
  //
  // The `?? store.contacts[0]` that used to close this expression is gone
  // (2026-08-18). On an inbound call from an unmatched number the id is a
  // synthetic 'inbound-<sid>', so the find missed and the room showed the FIRST
  // LEAD IN THE STORE: an unrelated person's name, stage, tags and SMS box,
  // while somebody else was talking. It survives only for the legacy
  // no-call-no-preview case it was written for.
  //
  // The phone match is by last 9 digits (api/lib/phone-match.ts), the same rule
  // the property RPCs use. Exact string equality is why a branch we rang that
  // morning came back as an unknown caller: Twilio says '+447380308316' and the
  // lead is filed as '07380308316'.
  const matchedContact = useMemo(() => {
    if (isPreview) return store.contacts.find((c) => c.id === previewContactId) ?? null;
    if (call?.contactId) {
      const byId = store.contacts.find((c) => c.id === call.contactId);
      if (byId) return byId;
    }
    if (call?.phone) {
      return findByPhone(store.contacts, call.phone, (c) => c.phone) ?? null;
    }
    return null;
  }, [isPreview, previewContactId, call?.contactId, call?.phone, store.contacts]);

  const contact = pickedContact
    ?? matchedContact
    ?? (phase === 'idle' && !isPreview ? store.contacts[0] ?? null : null);

  const contactFirstName = contact?.name?.trim().split(/\s+/)[0] ?? '';

  // Is this a property call? Three ways in, because each one alone has a hole:
  // houses on file for the caller's number (the normal case), the lead flagged
  // as an estate agent (a branch whose houses were all sold or withdrawn), or
  // an unidentified caller on the line of an agent whose whole job is houses.
  // That last clause is Hugo's instruction of 2026-08-18: the right script in
  // front of Pedro even when he has to search for the branch.
  const { listings } = usePropertyListings(contact?.phone ?? call?.phone);
  const agentDefaultScript = useAgentDefaultScript();
  const isPropertyCall =
    listings.length > 0
    || contact?.customFields?.lead_type === 'estate_agent'
    || (agentDefaultScript === 'property_call' && !contact);

  // File the call against the branch he picked, so the outcome he presses
  // afterwards lands on the deal instead of nowhere.
  //
  // script_key travels with it when the branch really is a property one. The
  // coach rebuilds its context from the database on every utterance and reads
  // that column to decide whether it is listening to a property call: without
  // it a searched branch would be coached as though it were a plumber lead.
  const pickBranch = useCallback((picked: Contact, hasHouses: boolean) => {
    setPickedContact(picked);
    const callId = call?.callId;
    if (!callId) return;
    const isProperty = hasHouses || picked.customFields?.lead_type === 'estate_agent';
    void supabase
      .from('wk_calls')
      .update(isProperty
        ? { contact_id: picked.id, script_key: 'property_call' }
        : { contact_id: picked.id })
      .eq('id', callId);
  }, [call?.callId]);

  // COL 1's top card. One definition, used by the four-column layout below and
  // handed to the property room as its header, so the two cannot drift.
  const rangFromAnotherLine =
    !!contact && !!call?.phone && !samePhone(contact.phone, call.phone);
  const contactCard = contact ? (
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
      <div className="text-[12px] text-[#6B7280] tabular-nums mt-0.5">{contact.phone}</div>
      {/* They rang from a different line to the one we hold, which is normal
          for a branch: the switchboard is what the scraper found, the
          negotiator has a direct line. Worth saying, because the number on the
          card is not the number on the phone. */}
      {rangFromAnotherLine && (
        <div className="text-[11px] text-[#8a6d1a] tabular-nums mt-0.5">
          Rang from {call?.phone}
        </div>
      )}
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
  ) : null;

  if (!fullScreen) return null;

  if (!contact && !isPropertyCall) {
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
            {/* Keypad. Hugo 2026-08-25: a switchboard asking him to press a
                number to go forward had nowhere to press it, on either the
                softphone or in here. Sends real DTMF on the live leg. */}
            <TopBtn
              icon={<Hash className="w-4 h-4" />}
              label="Keypad"
              onClick={() => setKeypadOpen((v) => !v)}
              active={keypadOpen}
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
          {isPreview && contact && (
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

      {/* The keypad itself, hanging under the top bar. The room is fixed, so
          this positions against it and floats over the columns rather than
          pushing them down mid-call. */}
      {phase === 'in_call' && keypadOpen && (
        <div
          className="absolute top-14 left-5 z-[210] w-[210px] bg-white border border-[#E5E7EB] rounded-xl shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-3"
          data-testid="livecall-dtmf-keypad"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
              Keypad
            </span>
            <button
              onClick={() => setKeypadOpen(false)}
              className="ml-auto p-0.5 text-[#9CA3AF] hover:text-[#1A1A1A] rounded"
              title="Close keypad"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <DtmfKeypad
            enabled
            onDigit={sendDigit}
            callId={call?.callId ?? null}
            size="compact"
          />
        </div>
      )}

      {/* A property call gets the SAME room the dialer opens (2026-08-18):
          offer band pinned above the property script, the Houses panel, the
          coach. Pedro: "the transition of hey elsie from dialer to when I
          answer an incoming call is very different and its difficult to find
          information." Everything else keeps the four columns below. */}
      {isPropertyCall ? (
        <div
          className="flex-1 overflow-hidden"
          style={{ paddingTop: 'var(--followup-banner-h, 0px)' }}
          data-testid="inbound-property-room"
        >
          <PropertyCallRoom
            contact={contact}
            contactHeader={contactCard}
            emptyState={
              <BranchSearchPanel callerPhone={call?.phone ?? ''} onPick={pickBranch} />
            }
            currentCallId={call?.callId ?? null}
            callConnected={phase === 'in_call'}
            liveDurationSec={durationSec}
            agentFirstName={myFirstName ?? ''}
            campaignId={call?.campaignId ?? null}
            pipelineId={callPipelineId}
            direction="inbound"
            autoSaveId="livecall-houses-layout-v1"
          />
        </div>
      ) : contact ? (
      /* Resizable 4-column body (Hugo 2026-04-26):
            COL 1 — contact context (name, stage, KV, sticky notes)
            COL 2 — live transcript + AI coach (vertical resize inside)
            COL 3 — call script (admin-edited via /smsv2/settings)
            COL 4 — glossary (click-to-expand, admin-edited via Settings)
          autoSaveId bumped to v2 so old 3-col widths don't bleed in. */
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="smsv2-live-call-layout-v2"
        className="flex-1 overflow-hidden"
        style={{ paddingTop: 'var(--followup-banner-h, 0px)' }}
      >
        {/* COL 1 — lead context */}
        <ResizablePanel defaultSize={20} minSize={14} className="bg-white border-r border-[#E5E7EB] flex flex-col overflow-hidden">
          {contactCard}

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
      ) : null}

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
