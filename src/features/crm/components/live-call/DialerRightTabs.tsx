// DialerRightTabs — col 3 of the dialer. The tabs the agent flips between on
// a live sales call: Coach (the LIVE transcript + AI coach), Calculator,
// Objections, and Messages. The Messages tab is the SMS/WhatsApp/Email send
// box on top with the contact's message history below it.
//
// Hugo 2026-07-22 — ONE ROOM: the real live AI coach (the "Live transcript +
// AI coach" pane, bound to the active call's wk_calls.id) now lives HERE, in
// the single dialer room, instead of a separate LiveCallScreen. It auto-opens
// the moment a call connects so the agent's eye lands on the read-aloud line.
//
// Hugo 2026-08-12: the Houses tab LEFT this column. The house panel now sits
// in the left column under the SMS history, so on a property call this column
// opens on the Coach and stays there: "in that way he can have the coach
// always open as well." Messages is still one click away.

import { useEffect, useRef, useState } from 'react';
import { Calculator, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import SalesCalculatorPane from './SalesCalculatorPane';
import ObjectionsPane from './ObjectionsPane';
import MidCallSmsSender from './MidCallSmsSender';
import LiveTranscriptPane from './LiveTranscriptPane';
import { useContactMessages, type CrmMessage } from '../../hooks/useContactMessages';
import { useSmsV2 } from '../../store/SmsV2Store';
import SendSiteButton from './SendSiteButton';
import VideoLinkButton from './VideoLinkButton';

type Tab = 'coach' | 'calculator' | 'objections' | 'messages';

interface Props {
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  /** Lead's owner (person) name — for plumber leads contactName is the
   *  business, so {first_name} greetings must use this instead. */
  ownerName?: string | null;
  agentFirstName: string;
  campaignId?: string | null;
  pipelineId?: string | null;
  /** Live call binding (Hugo 2026-07-22). currentCallId is the active
   *  wk_calls.id — the Coach pane subscribes to its transcript + coach
   *  events. callConnected auto-opens the Coach tab on pickup. */
  currentCallId?: string | null;
  callConnected?: boolean;
  liveDurationSec?: number;
  /** Houses mode: the lead is an estate agency, not a plumber.
   *
   *  Swaps the tab set rather than adding to it. Calculator sells websites and
   *  Objections answers plumber objections, so both are worse than useless on a
   *  property call. Absent (every existing caller) leaves the four original
   *  tabs and the Calculator default exactly as they were. */
  showHouses?: boolean;
}

export default function DialerRightTabs({
  contactId,
  contactName,
  contactPhone,
  contactEmail,
  ownerName,
  agentFirstName,
  campaignId,
  pipelineId,
  currentCallId,
  callConnected,
  liveDurationSec,
  showHouses,
}: Props) {
  // A property call opens on the Coach and stays there, because the houses
  // panel it used to open on now lives in the left column and is always on
  // screen beside it. A plumber call is untouched: Calculator, as ever.
  const [tab, setTab] = useState<Tab>(showHouses ? 'coach' : 'calculator');
  const { messages } = useContactMessages(contactId ?? '');

  // Auto-open the Coach tab the instant the call connects, so the read-aloud
  // line is in front of the agent without a click. Only fires on the
  // idle→connected transition; the agent can freely switch tabs after.
  const prevConnected = useRef(false);
  useEffect(() => {
    if (callConnected && !prevConnected.current) setTab('coach');
    prevConnected.current = !!callConnected;
  }, [callConnected]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex border-b border-[#E5E7EB]">
        <TabButton active={tab === 'coach'} icon={<Sparkles className="w-3.5 h-3.5" />} label="Coach" onClick={() => setTab('coach')} />
        {!showHouses && (
          <>
            <TabButton active={tab === 'calculator'} icon={<Calculator className="w-3.5 h-3.5" />} label="Calculator" onClick={() => setTab('calculator')} />
            <TabButton active={tab === 'objections'} icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Objections" onClick={() => setTab('objections')} />
          </>
        )}
        <TabButton active={tab === 'messages'} icon={<MessageSquare className="w-3.5 h-3.5" />} label="Messages" count={messages.length} onClick={() => setTab('messages')} />
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'coach' && (
          <LiveTranscriptPane
            durationSec={liveDurationSec ?? 0}
            contactId={contactId ?? ''}
            callId={currentCallId ?? null}
            agentFirstName={agentFirstName}
            // showHouses IS "this is a property call": it is the same flag that
            // cuts these tabs down to Coach and Messages. Threaded through so
            // the coach can answer a money moment locally, without waiting for
            // the model. Never true on a plumber call.
            isPropertyCall={showHouses === true}
          />
        )}
        {tab === 'calculator' && <SalesCalculatorPane />}
        {tab === 'objections' && <ObjectionsPane />}
        {tab === 'messages' && (
          <MessagesTab
            contactId={contactId}
            contactName={contactName}
            contactPhone={contactPhone}
            contactEmail={contactEmail}
            ownerName={ownerName}
            agentFirstName={agentFirstName}
            campaignId={campaignId}
            pipelineId={pipelineId}
            messages={messages}
          />
        )}
      </div>
    </div>
  );
}

function MessagesTab({
  contactId, contactName, contactPhone, contactEmail, ownerName, agentFirstName, campaignId, pipelineId, messages,
}: Props & { messages: CrmMessage[] }) {
  // Hugo 2026-07-27: "under message put option to send video there as well."
  // Same component as the contact pane — its send guards are module-scoped, so
  // two mounts can't text the lead twice.
  const { getContact } = useSmsV2();
  const contact = contactId ? getContact(contactId) : undefined;

  if (!contactId || !contactName || !contactPhone) {
    return (
      <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
        Queue empty. Add leads to send messages and see history.
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Send box on top, with the video as its own one-tap option above it. */}
      <div className="px-3 py-3 border-b border-[#E5E7EB] space-y-2">
        {contact && <VideoLinkButton contact={contact} compact />}
              {contact && <SendSiteButton contact={contact} compact />}
        <MidCallSmsSender
          contactId={contactId}
          contactName={contactName}
          contactPhone={contactPhone}
          contactEmail={contactEmail}
          ownerName={ownerName}
          agentFirstName={agentFirstName}
          campaignId={campaignId ?? null}
          pipelineId={pipelineId ?? null}
        />
      </div>
      {/* History below */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1 px-0.5">History</div>
        {messages.length === 0 ? (
          <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-4 leading-snug">
            No messages exchanged with this contact yet.
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: CrmMessage }) {
  const isInbound = message.direction === 'inbound';
  const time = new Date(message.createdAt);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { day: '2-digit', month: 'short' });
  return (
    <div className={cn(
      'rounded-lg border p-2 text-[12px] leading-snug',
      isInbound ? 'border-[#3C5A87]/30 bg-[#EEF2F8] text-[#1A1A1A]' : 'border-[#E5E7EB] bg-white text-[#374151]',
    )}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className={cn('text-[10px] font-semibold uppercase tracking-wide', isInbound ? 'text-[#3C5A87]' : 'text-[#6B7280]')}>
          {isInbound ? '↓ From contact' : '↑ Sent'}
          {message.channel !== 'sms' && ` · ${message.channel}`}
        </span>
        <span className="text-[10px] text-[#9CA3AF] tabular-nums">{dateStr} {timeStr}</span>
      </div>
      <div className="whitespace-pre-wrap break-words">{message.body}</div>
    </div>
  );
}

function TabButton({ active, icon, label, count, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[12px] font-semibold transition-colors border-b-2',
        active ? 'text-[#3C5A87] border-[#3C5A87]' : 'text-[#6B7280] border-transparent hover:text-[#1A1A1A] hover:bg-[#F3F3EE]/50',
      )}
    >
      <span className={active ? 'text-[#3C5A87]' : 'text-[#9CA3AF]'}>{icon}</span>
      <span>{label}</span>
      {count !== undefined && <span className="text-[10px] text-[#9CA3AF] font-normal">{count}</span>}
    </button>
  );
}
