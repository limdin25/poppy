import { useState } from 'react';
import { useContactMessages } from '../../hooks/useContactMessages';

/** Shares the inbox's real message rows and live subscription. Never sends. */
export default function HostunicoCallMessages({ contactId, refreshVersion = 0 }: { contactId: string; refreshVersion?: number }) {
  const { messages, loading, error } = useContactMessages(contactId, refreshVersion);
  const [expanded, setExpanded] = useState(false);
  const relevant = messages.filter((message) => message.channel !== 'whatsapp');
  const visible = expanded ? relevant : relevant.slice(-3);
  return <section className="mt-3 border-t pt-3" aria-label="Inbox for this contact">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Inbox</h3><span className="text-[11px] text-slate-500">This contact only</span></div>
    {loading && <p className="mt-2 text-xs text-slate-500">Loading messages...</p>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-800">{error}</p>}
    {!loading && !error && !relevant.length && <p className="mt-2 text-xs text-slate-500">No messages yet. Your sent report and their reply appear here.</p>}
    <ol className="mt-2 max-h-80 space-y-2 overflow-y-auto">{visible.map((message) => <li key={message.id} className={`rounded-lg p-2 text-xs ${message.direction === 'inbound' ? 'border border-blue-200 bg-blue-50' : 'bg-slate-100'}`}>
      <div className="flex flex-wrap justify-between gap-1 text-[10px] text-slate-500"><b>{message.direction === 'inbound' ? 'Their reply' : 'Our message'} / {message.channel.toUpperCase()}</b><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.subject && <p className="mt-1 font-semibold">{message.subject}</p>}
      <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{message.body || (message.mediaUrls.length ? 'Media received. Open the full inbox to view it.' : 'Empty message')}</p>
      <p className="mt-1 text-[10px] text-slate-500">{message.status.replaceAll('_', ' ')}</p>
    </li>)}</ol>
    {relevant.length > 3 && <button onClick={() => setExpanded(!expanded)} className="mt-2 text-xs font-medium text-blue-700">{expanded ? 'Show recent messages' : `Show all ${relevant.length} messages`}</button>}
  </section>;
}
