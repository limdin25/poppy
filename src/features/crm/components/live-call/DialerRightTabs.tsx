// DialerRightTabs — col 3 of the dialer. Three tabs the agent flips between on
// a live sales call: Calculator (default), Objections, and Messages. The
// Messages tab is the SMS/WhatsApp/Email send box on top with the contact's
// message history below it. Built for the dialer specifically; the legacy
// LiveCallScreen still uses TerminologyPane.

import { useState } from 'react';
import { Calculator, MessageSquare, ShieldAlert } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import SalesCalculatorPane from './SalesCalculatorPane';
import ObjectionsPane from './ObjectionsPane';
import MidCallSmsSender from './MidCallSmsSender';
import { useContactMessages, type CrmMessage } from '../../hooks/useContactMessages';

type Tab = 'calculator' | 'objections' | 'messages';

interface Props {
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  agentFirstName: string;
  campaignId?: string | null;
  pipelineId?: string | null;
}

export default function DialerRightTabs({
  contactId,
  contactName,
  contactPhone,
  contactEmail,
  agentFirstName,
  campaignId,
  pipelineId,
}: Props) {
  const [tab, setTab] = useState<Tab>('calculator');
  const { messages } = useContactMessages(contactId ?? '');

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex border-b border-[#E5E7EB]">
        <TabButton active={tab === 'calculator'} icon={<Calculator className="w-3.5 h-3.5" />} label="Calculator" onClick={() => setTab('calculator')} />
        <TabButton active={tab === 'objections'} icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Objections" onClick={() => setTab('objections')} />
        <TabButton active={tab === 'messages'} icon={<MessageSquare className="w-3.5 h-3.5" />} label="Messages" count={messages.length} onClick={() => setTab('messages')} />
      </div>

      <div className="flex-1 overflow-hidden">
        {tab === 'calculator' && <SalesCalculatorPane />}
        {tab === 'objections' && <ObjectionsPane />}
        {tab === 'messages' && (
          <MessagesTab
            contactId={contactId}
            contactName={contactName}
            contactPhone={contactPhone}
            contactEmail={contactEmail}
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
  contactId, contactName, contactPhone, contactEmail, agentFirstName, campaignId, pipelineId, messages,
}: Props & { messages: CrmMessage[] }) {
  if (!contactId || !contactName || !contactPhone) {
    return (
      <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
        Queue empty. Add leads to send messages and see history.
      </div>
    );
  }
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Send box on top */}
      <div className="px-3 py-3 border-b border-[#E5E7EB]">
        <MidCallSmsSender
          contactId={contactId}
          contactName={contactName}
          contactPhone={contactPhone}
          contactEmail={contactEmail}
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
