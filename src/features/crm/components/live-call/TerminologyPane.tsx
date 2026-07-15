// TerminologyPane — col 4 of the LiveCallScreen.
//
// PR 11 (Hugo 2026-04-26): originally Glossary + Objections tabs.
// Hugo 2026-05-15: Objections tab replaced with Messages tab showing
// the contact's SMS / WhatsApp / email history. Agents wanted to see
// what was already said before they pick up — pre-written objection
// scripts weren't being used in practice and the timeline is more
// useful context for the actual conversation.
//
// Data:
//   • Glossary: wk_terminologies (category='glossary'), realtime
//   • Messages: wk_sms_messages for the active contact, realtime

import { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, ChevronDown, MessageSquare, Plus, X } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import {
  useTerminologies,
  type Terminology,
} from '../../hooks/useTerminologies';
import { useContactMessages, type CrmMessage } from '../../hooks/useContactMessages';
import { useSmsV2 } from '../../store/SmsV2Store';

type PaneTab = 'glossary' | 'messages';

export default function TerminologyPane({ contactId }: { contactId?: string }) {
  const { items, loading, error, add } = useTerminologies({ activeOnly: true });
  const { pushToast } = useSmsV2();
  const [tab, setTab] = useState<PaneTab>('messages');
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);

  // Glossary filtering (only used when tab='glossary')
  const filtered = useMemo(() => {
    const inTab = items.filter((t) => t.category === 'glossary');
    const q = filter.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter(
      (t) =>
        t.term.toLowerCase().includes(q) ||
        (t.short_gist ?? '').toLowerCase().includes(q) ||
        t.definition_md.toLowerCase().includes(q)
    );
  }, [items, filter]);

  const glossaryCount = useMemo(
    () => items.filter((t) => t.category === 'glossary').length,
    [items]
  );

  // Contact message history (only used when tab='messages')
  const { messages: contactMessages } = useContactMessages(contactId ?? '');
  const filteredMessages = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return contactMessages;
    return contactMessages.filter((m) => m.body.toLowerCase().includes(q));
  }, [contactMessages, filter]);

  const handleAdd = async (form: { term: string; short_gist: string; definition_md: string }) => {
    try {
      const maxSort = items
        .filter((t) => t.category === 'glossary')
        .reduce((max, t) => Math.max(max, t.sort_order), 0);
      await add({
        term: form.term,
        short_gist: form.short_gist || null,
        definition_md: form.definition_md,
        sort_order: maxSort + 10,
        is_active: true,
        category: 'glossary',
      });
      pushToast('Added to Glossary', 'success');
      setAdding(false);
    } catch (e) {
      pushToast(`Add failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex border-b border-[#E5E7EB]">
        <TabButton
          active={tab === 'messages'}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          label="Messages"
          count={contactMessages.length}
          onClick={() => setTab('messages')}
        />
        <TabButton
          active={tab === 'glossary'}
          icon={<BookOpen className="w-3.5 h-3.5" />}
          label="Glossary"
          count={glossaryCount}
          onClick={() => setTab('glossary')}
        />
      </div>

      <div className="px-3 py-2 border-b border-[#E5E7EB] flex items-center gap-1.5">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={tab === 'messages' ? 'Search messages…' : 'Filter…'}
          className="flex-1 px-2.5 py-1.5 text-[12px] border border-[#E5E5E5] rounded-[10px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
        />
        {tab === 'glossary' && (
          <button
            onClick={() => setAdding(true)}
            title="Add a term"
            className="p-1.5 rounded-[10px] bg-[#3C5A87]/10 text-[#3C5A87] hover:bg-[#3C5A87]/20"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {tab === 'glossary' ? (
          <>
            {error && (
              <div className="text-[11px] text-[#EF4444] px-1">⚠ {error}</div>
            )}
            {!loading && filtered.length === 0 && !adding && (
              <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
                {glossaryCount === 0
                  ? 'No glossary terms yet. Click + to add one, or manage them in Settings → Glossary.'
                  : `No matches for "${filter}".`}
              </div>
            )}
            {filtered.map((t) => (
              <TermCard key={t.id} term={t} />
            ))}
          </>
        ) : (
          <MessagesTimeline contactId={contactId} messages={filteredMessages} />
        )}
      </div>

      {adding && tab === 'glossary' && (
        <AddCardForm
          onCancel={() => setAdding(false)}
          onSave={(form) => void handleAdd(form)}
        />
      )}
    </div>
  );
}

function MessagesTimeline({ contactId, messages }: { contactId?: string; messages: CrmMessage[] }) {
  if (!contactId) {
    return (
      <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
        Queue empty. Add leads to see message history before dialing.
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <div className="text-[12px] text-[#9CA3AF] text-center px-4 py-6 leading-snug">
        No messages exchanged with this contact yet.
      </div>
    );
  }
  return (
    <>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </>
  );
}

function MessageBubble({ message }: { message: CrmMessage }) {
  const isInbound = message.direction === 'inbound';
  const time = new Date(message.createdAt);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { day: '2-digit', month: 'short' });
  return (
    <div
      className={cn(
        'rounded-lg border p-2 text-[12px] leading-snug',
        isInbound
          ? 'border-[#3C5A87]/30 bg-[#EEF2F8] text-[#1A1A1A]'
          : 'border-[#E5E7EB] bg-white text-[#374151]'
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wide',
            isInbound ? 'text-[#3C5A87]' : 'text-[#6B7280]'
          )}
        >
          {isInbound ? '↓ From contact' : '↑ Sent'}
          {message.channel !== 'sms' && ` · ${message.channel}`}
        </span>
        <span className="text-[10px] text-[#9CA3AF] tabular-nums">
          {dateStr} {timeStr}
        </span>
      </div>
      <div className="whitespace-pre-wrap break-words">{message.body}</div>
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold transition-colors border-b-2',
        active
          ? 'text-[#3C5A87] border-[#3C5A87]'
          : 'text-[#6B7280] border-transparent hover:text-[#1A1A1A] hover:bg-[#F3F3EE]/50'
      )}
    >
      <span className={active ? 'text-[#3C5A87]' : 'text-[#9CA3AF]'}>{icon}</span>
      <span>{label}</span>
      <span className="text-[10px] text-[#9CA3AF] font-normal">{count}</span>
    </button>
  );
}

function AddCardForm({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (form: { term: string; short_gist: string; definition_md: string }) => void;
}) {
  const [term, setTerm] = useState('');
  const [gist, setGist] = useState('');
  const [definition, setDefinition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = () => {
    const t = term.trim();
    const d = definition.trim();
    if (!t || !d || submitting) return;
    setSubmitting(true);
    onSave({ term: t, short_gist: gist.trim(), definition_md: d });
  };

  return (
    <div className="border-t-2 border-[#3C5A87] bg-[#EEF2F8]/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">
          New term
        </span>
        <button
          onClick={onCancel}
          className="p-1 rounded hover:bg-white/60 text-[#6B7280]"
          title="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <input
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder='Term (e.g. "Voting")'
        autoFocus
        className="w-full px-2 py-1.5 text-[12px] bg-white border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
      />
      <input
        type="text"
        value={gist}
        onChange={(e) => setGist(e.target.value)}
        placeholder="One-line gist (optional)"
        className="w-full px-2 py-1.5 text-[11px] bg-white border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
      />
      <textarea
        value={definition}
        onChange={(e) => setDefinition(e.target.value)}
        placeholder="Full definition (Markdown supported)"
        rows={3}
        className="w-full px-2 py-1.5 text-[12px] bg-white border border-[#E5E5E5] rounded-[8px] focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87] resize-none"
      />
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-2.5 py-1 text-[11px] font-medium border border-[#E5E7EB] rounded-[8px] hover:bg-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !term.trim() || !definition.trim()}
          className="px-2.5 py-1 text-[11px] font-semibold bg-[#3C5A87] text-white rounded-[8px] hover:bg-[#3C5A87]/90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function TermCard({ term }: { term: Terminology }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        'border rounded-lg transition-colors',
        open ? 'border-[#3C5A87]/40 bg-[#EEF2F8]/30' : 'border-[#E5E7EB] hover:border-[#3C5A87]/30'
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-start gap-2"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-[#3C5A87] flex-shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-[#1A1A1A]">
            {term.term}
          </div>
          {term.short_gist && (
            <div className="text-[11px] text-[#6B7280] mt-0.5 leading-snug">
              {term.short_gist}
            </div>
          )}
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0.5 border-t border-[#E5E7EB] mt-1">
          <DefinitionMarkdown body={term.definition_md} />
        </div>
      )}
    </div>
  );
}

// Minimal Markdown renderer, same subset as CallScriptPane (bold, italic,
// inline code, paragraphs, lists). Glossary content is admin-controlled.
function DefinitionMarkdown({ body }: { body: string }) {
  const lines = body.split(/\r?\n/);
  const blocks: { kind: 'p' | 'li'; text: string }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      flush();
      blocks.push({ kind: 'li', text: li[1] });
    } else {
      para.push(line);
    }
  }
  flush();

  return (
    <div className="text-[13px] text-[#1A1A1A] leading-relaxed space-y-1.5 mt-2">
      {blocks.map((b, i) =>
        b.kind === 'li' ? (
          <li key={i} className="ml-4 list-disc text-[12px]">
            {renderInline(b.text)}
          </li>
        ) : (
          <p key={i} className="text-[12px] leading-relaxed">
            {renderInline(b.text)}
          </p>
        )
      )}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="bg-[#F3F3EE] text-[11px] px-1 rounded font-mono"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
