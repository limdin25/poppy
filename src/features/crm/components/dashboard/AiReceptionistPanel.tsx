import { Link } from 'react-router-dom';
import { Bot, Phone, MessageSquare, Settings2, Inbox } from 'lucide-react';
import { useAiReceptionist } from '../../hooks/useAiReceptionist';
import { formatRelativeTime } from '../../data/helpers';

const TEXT_STATUS_BADGE: Record<string, string> = {
  draft: 'bg-[#FEF3C7] text-[#92400E]',
  sent: 'bg-[#DCFCE7] text-[#166534]',
  queued: 'bg-[#EEF2F8] text-[#3C5A87]',
  sending: 'bg-[#EEF2F8] text-[#3C5A87]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
};

export default function AiReceptionistPanel() {
  const ai = useAiReceptionist();

  const textsChip = ai.loading
    ? { label: 'Texts …', cls: 'bg-[#F3F4F6] text-[#9CA3AF]' }
    : !ai.enabled
      ? { label: 'Texts OFF', cls: 'bg-[#F3F4F6] text-[#6B7280]' }
      : ai.mode === 'auto'
        ? { label: 'Texts · Auto-send', cls: 'bg-[#DCFCE7] text-[#166534]' }
        : { label: 'Texts · Draft mode', cls: 'bg-[#FEF3C7] text-[#92400E]' };

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-xl bg-[#EEF2F8] flex items-center justify-center">
            <Bot className="w-4 h-4 text-[#3C5A87]" strokeWidth={1.8} />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-[#1A1A1A]">AI receptionist — Maya</h3>
            <p className="text-[11px] text-[#6B7280]">Answers +1 (833) 370-6994 · warm-up texts on lead replies</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-[#DCFCE7] text-[#166534]">Voice ON</span>
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-md ${textsChip.cls}`}>{textsChip.label}</span>
          <Link
            to="/admin/crm/ai-warmup"
            className="flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#3C5A87] px-2 py-1 rounded hover:bg-[#EEF2F8]"
          >
            <Settings2 className="w-3.5 h-3.5" /> Settings
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-[#E5E7EB] border-b border-[#E5E7EB]">
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">Calls answered today</div>
          <div className="text-[22px] font-bold text-[#1A1A1A] tabular-nums mt-0.5">{ai.loading ? '—' : ai.callsToday}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">AI texts today</div>
          <div className="text-[22px] font-bold text-[#1A1A1A] tabular-nums mt-0.5">{ai.loading ? '—' : ai.textsToday}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-[#9CA3AF] font-semibold">Drafts waiting</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[22px] font-bold text-[#1A1A1A] tabular-nums">{ai.loading ? '—' : ai.draftsWaiting}</span>
            {ai.draftsWaiting > 0 && (
              <Link
                to="/admin/crm/inbox"
                className="flex items-center gap-1 text-[11px] font-medium text-[#3C5A87] hover:underline"
              >
                <Inbox className="w-3.5 h-3.5" /> review
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="divide-y divide-[#E5E7EB]">
        {ai.recent.map((item) => (
          <div key={`${item.kind}-${item.id}`} className="px-4 py-2.5 flex items-center gap-3 text-[13px] hover:bg-[#F3F3EE]/50">
            {item.kind === 'call'
              ? <Phone className="w-3.5 h-3.5 text-[#3C5A87] flex-shrink-0" />
              : <MessageSquare className="w-3.5 h-3.5 text-[#3C5A87] flex-shrink-0" />}
            {item.contactId ? (
              <Link
                to={`/admin/crm/contacts/${item.contactId}`}
                className="font-semibold text-[#1A1A1A] w-28 truncate flex-shrink-0 hover:text-[#3C5A87]"
              >
                {item.contactName}
              </Link>
            ) : (
              <span className="font-semibold text-[#1A1A1A] w-28 truncate flex-shrink-0">{item.contactName}</span>
            )}
            <span className="text-[#6B7280] truncate flex-1">{item.detail}</span>
            {item.kind === 'text' && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${TEXT_STATUS_BADGE[item.status] || 'bg-[#F3F4F6] text-[#6B7280]'}`}>
                {item.status}
              </span>
            )}
            <span className="text-[11px] text-[#9CA3AF] tabular-nums flex-shrink-0">{formatRelativeTime(item.at)}</span>
          </div>
        ))}
        {!ai.loading && ai.recent.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] text-[#9CA3AF] italic">
            No AI activity yet — Maya's answered calls and warm-up texts will appear here.
          </div>
        )}
        {ai.loading && (
          <div className="px-4 py-6 text-center text-[12px] text-[#9CA3AF]">Loading…</div>
        )}
      </div>
    </div>
  );
}
