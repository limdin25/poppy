// CallbackBanner. The top stripe that says who has come back to us.
//
// Hugo, 2026-08-26: "if someone calls us back, it should show on the top, the
// top stripe that we have on the app... whoever's called us, so he can click
// and go to the inbox. Or if they have emailed us or SMS us. Only the people
// that we have contacted before, no marketing emails." And then: "make visible
// always."
//
// ALWAYS VISIBLE, INCLUDING WHEN IT IS EMPTY. That is the whole ask and it is
// not decoration. A strip that only appears when there is something wrong is a
// strip nobody looks at, because its absence and its failure look identical.
// Sitting there saying "nobody is waiting on us" is what makes it trustworthy
// the day it says the opposite.
//
// A MISSED CALL SORTS ABOVE EVERYTHING, however old. Measured the day this
// shipped: in the previous 24 hours four builders rang us back, every one of
// them went unanswered, and the app showed nothing. A text can be read later.
// A missed call is gone.
//
// The "we contacted them first" rule is enforced in wk_callbacks_open, not
// here. Ordering and wording are in ../lib/callbackList.ts so they can be
// tested without a browser.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PhoneMissed,
  PhoneIncoming,
  MessageSquare,
  Mail,
  Check,
  Inbox,
  Phone,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/core/lib/cn';
import { useCallbacks } from '../../hooks/useCallbacks';
import { useDialerProModal } from '../../layout/DialerProModalContext';
import {
  orderCallbacks,
  actionLabel,
  whoLabel,
  displayName,
  agoLabel,
  headline,
  tone,
  type Callback,
} from '../../lib/callbackList';

const COLLAPSED_H = 34;
const EXPANDED_H = 34;

function KindIcon({ c, className }: { c: Callback; className?: string }) {
  if (c.kind === 'call') {
    return c.missed
      ? <PhoneMissed className={className} strokeWidth={2.4} />
      : <PhoneIncoming className={className} strokeWidth={2.4} />;
  }
  if (c.kind === 'email') return <Mail className={className} strokeWidth={2.2} />;
  return <MessageSquare className={className} strokeWidth={2.2} />;
}

export default function CallbackBanner({ compact = false }: { compact?: boolean }) {
  const { items, ready, dismiss } = useCallbacks();
  const { openDialerPro } = useDialerProModal();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  // Keeps "12m ago" honest between polls. A counter rather than a clock: the
  // times are read at render, so this only has to force one.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const ordered = useMemo(() => orderCallbacks(items), [items]);
  const t = tone(items);
  const missedCount = items.filter((i) => i.kind === 'call' && i.missed).length;

  // The live-call room is a full-screen overlay and has to be pushed down by
  // however much banner is above it.
  useEffect(() => {
    document.body.style.setProperty(
      '--callback-banner-h',
      compact ? '0px' : `${open ? EXPANDED_H : COLLAPSED_H}px`,
    );
    return () => { document.body.style.setProperty('--callback-banner-h', '0px'); };
  }, [open, compact]);
  useEffect(() => {
    if (!compact || !open) return;
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [compact, open]);

  const skin = t === 'missed'
    ? { bar: 'bg-[#FEF2F2] border-[#DC2626]/40', ink: 'text-[#B91C1C]' }
    : t === 'waiting'
      ? { bar: 'bg-[#EFF6FF] border-[#3B82F6]/40', ink: 'text-[#1D4ED8]' }
      : { bar: 'bg-[#F3F3EE] border-[#E5E7EB]', ink: 'text-[#6B7280]' };

  return (
    <div
      ref={root}
      data-testid="callback-banner"
      className={cn(compact ? 'relative min-w-0 flex-1 rounded-lg border' : 'px-4 py-1.5 flex-shrink-0 relative z-10 border-b', skin.bar)}
    >
      {compact ? <button type="button" onClick={() => setOpen((v) => !v)} disabled={!items.length} aria-expanded={open} data-testid="callback-banner-toggle" title={items.length ? headline(items) : 'No replies waiting'} className={cn('flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-xs', skin.ink)}>
        <Inbox className="h-3.5 w-3.5 shrink-0" /><span role="status" className="shrink-0 font-semibold">{ready ? `Replies ${items.length}` : 'Checking'}</span>
        {ordered[0] && <span className="truncate font-medium">{displayName(ordered[0])} · {actionLabel(ordered[0])}</span>}
        {!!items.length && <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0" />}
      </button> : <div className="flex items-center gap-2 max-w-[1280px] mx-auto">
        {t === 'missed'
          ? <PhoneMissed className={cn('w-3.5 h-3.5 flex-shrink-0', skin.ink)} strokeWidth={2.4} />
          : <Inbox className={cn('w-3.5 h-3.5 flex-shrink-0', skin.ink)} strokeWidth={2.2} />}

        <span className={cn('text-[11px] font-bold uppercase tracking-wide whitespace-nowrap', skin.ink)}>
          {t === 'clear'
            ? (ready ? 'Nothing to call back' : 'Checking')
            : missedCount > 0
              ? `${missedCount} missed call${missedCount > 1 ? 's' : ''}`
              : `${items.length} came back to us`}
        </span>

        {!open && (
          <span className="text-[12px] text-[#1A1A1A] truncate">
            {items.length === 0
              ? (ready
                ? 'Anyone we have texted, emailed or rung will appear here the moment they come back.'
                : 'Looking for anyone who has come back to us.')
              : headline(items)}
          </span>
        )}

        {items.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            data-testid="callback-banner-toggle"
            className={cn('ml-auto inline-flex items-center gap-1 text-[11px] font-medium hover:opacity-70', skin.ink)}
          >
            {open ? <>Collapse <ChevronUp className="w-3.5 h-3.5" /></> : <>Expand <ChevronDown className="w-3.5 h-3.5" /></>}
          </button>
        )}
      </div>}

      {open && (
        <div className={compact ? 'absolute right-0 top-full z-[180] mt-2 max-h-[60vh] w-[min(680px,90vw)] space-y-1 overflow-y-auto rounded-xl border bg-white p-2 shadow-xl' : 'max-w-[1280px] mx-auto mt-2 space-y-1 max-h-[280px] overflow-y-auto pr-1'}>
          {ordered.map((c) => {
            const isMissed = c.kind === 'call' && c.missed;
            const who = whoLabel(c);
            return (
              <div
                key={`${c.contactId}-${c.cameBackAt}`}
                data-testid="callback-row"
                className={cn(
                  'flex items-center gap-2 bg-white rounded-md px-2 py-1.5 border',
                  isMissed ? 'border-[#DC2626]/40' : 'border-[#E5E7EB]',
                )}
              >
                <KindIcon
                  c={c}
                  className={cn('w-3.5 h-3.5 flex-shrink-0', isMissed ? 'text-[#B91C1C]' : 'text-[#3C5A87]')}
                />
                <button
                  onClick={() => navigate(`/admin/crm/inbox?contact=${c.contactId}`)}
                  className="text-[12px] font-semibold text-[#1A1A1A] hover:underline truncate text-left"
                    title={c.reason ? `${c.reason} (${Math.round((c.confidence || 0) * 100)}% confidence)` : c.preview}
                >
                  {displayName(c)}
                </button>
                {who && (
                  <span className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded bg-[#F3F3EE] text-[#6B7280]">
                    {who}
                  </span>
                )}
                <span
                  className={cn(
                    'text-[10px] font-semibold whitespace-nowrap px-1.5 py-0.5 rounded',
                    isMissed ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EFF6FF] text-[#1D4ED8]',
                  )}
                >
                  {actionLabel(c)} · {agoLabel(c.cameBackAt)}
                </span>
                {c.preview && (
                  <span className="text-[11px] text-[#6B7280] truncate flex-1">
                    {c.preview}
                  </span>
                )}
                {c.intent && <span title={c.reason} className="text-[10px] text-slate-500">{Math.round((c.confidence || 0) * 100)}%</span>}
                <div className="ml-auto flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openDialerPro(c.contactId)}
                    title="Call them back"
                    className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => navigate(`/admin/crm/inbox?contact=${c.contactId}`)}
                    title="Open the conversation"
                    className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]"
                  >
                    <Inbox className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void dismiss(c.contactId)}
                    title="Answered, take it off"
                    className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
