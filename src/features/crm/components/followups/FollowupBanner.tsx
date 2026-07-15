// FollowupBanner — persistent top-of-screen banner showing pending /
// snoozed follow-ups whose due_at has arrived (or soon will). Tickles
// the agent so they don't lose track of nurturing leads.
//
// Hugo 2026-04-26: "the notification should be a notification, maybe a
// banner whenever is the follow-up time, and there comes a banner. It
// stays consistently on the top, very small, expandable so they can
// see, and they have the option to call or SMS on this banner."
//
// Collapsed: pill with count + next due-name.
// Expanded: list with per-row Call / SMS / Mark done / Snooze 1h.
//
// Mounts inside Smsv2Layout once, polls a 30s tick to refresh "is this
// due yet?" state. The hook drives the data + realtime channel.

import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronUp,
  Phone,
  MessageSquare,
  Mail,
  Check,
  Clock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/core/lib/cn';
import { useFollowups } from '../../hooks/useFollowups';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useDialerProModal } from '../../layout/DialerProModalContext';
import ContactSmsModal from '../contacts/ContactSmsModal';
import type { Contact } from '../../types';

export default function FollowupBanner() {
  const { items, setStatus, snooze } = useFollowups();
  const { contacts, columns } = useSmsV2();
  const { openDialerPro } = useDialerProModal();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(Date.now());
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  const [smsChannel, setSmsChannel] = useState<'sms' | 'whatsapp' | 'email' | null>(null);

  // Tick every 30s so "is this due yet?" stays current without a
  // realtime event. Banner re-renders cheaply — no DB hit.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // PR 107 (Hugo 2026-04-28): 1h lookahead so the agent sees follow-ups
  // BEFORE they're overdue. Anything due ≤ now + 60min surfaces here;
  // anything later stays in the pipeline countdown only.
  const due = useMemo(() => {
    const now = Date.now();
    const cutoff = now + 60 * 60 * 1000;
    return items
      .filter((i) => new Date(i.due_at).getTime() <= cutoff)
      .sort((a, b) => +new Date(a.due_at) - +new Date(b.due_at));
  }, [items]);

  useEffect(() => {
    document.body.style.setProperty('--followup-banner-h', due.length > 0 ? '40px' : '0px');
    return () => { document.body.style.setProperty('--followup-banner-h', '0px'); };
  }, [due.length]);

  if (due.length === 0) return null;

  const next = due[0];
  const nextContact = contacts.find((c) => c.id === next.contact_id);
  const nextDisplayName = nextContact?.name || next.contact_name || next.contact_phone || 'Unknown contact';
  const nextStage = next.column_id
    ? columns.find((c) => c.id === next.column_id)
    : undefined;

  return (
    <div className="bg-[#FFFBEB] border-b border-[#F59E0B]/40 px-4 py-1.5 flex-shrink-0 relative z-10">
      <div className="flex items-center gap-2 max-w-[1280px] mx-auto">
        <Bell className="w-3.5 h-3.5 text-[#B45309] flex-shrink-0" strokeWidth={2.4} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#B45309]">
          {due.length} follow-up{due.length > 1 ? 's' : ''} due
        </span>
        {!open && (
          <span className="text-[12px] text-[#1A1A1A] truncate">
            <span className="font-semibold">{nextDisplayName}</span>
            {nextStage ? (
              <>
                {' '}
                ·{' '}
                <span style={{ color: nextStage.colour }} className="font-medium">
                  {nextStage.name}
                </span>
              </>
            ) : null}
            {next.note ? <> · {next.note}</> : null}
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[#B45309] hover:text-[#92400E]"
        >
          {open ? (
            <>
              Collapse <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Expand <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {open && (
        <div className="max-w-[1280px] mx-auto mt-2 space-y-1 max-h-[260px] overflow-y-auto pr-1">
          {due.map((f) => {
            const contact = contacts.find((c) => c.id === f.contact_id);
            const displayName = contact?.name || f.contact_name || f.contact_phone || 'Unknown contact';
            const stage = f.column_id
              ? columns.find((c) => c.id === f.column_id)
              : undefined;
            const { label: dueLabel, tone: dueTone } = countdownLabel(f.due_at);
            return (
              <div
                key={f.id}
                className="flex items-center gap-2 bg-white border border-[#F59E0B]/40 rounded-md px-2 py-1.5"
              >
                <button
                  onClick={() => {
                    if (f.contact_id) navigate(`/admin/crm/contacts/${f.contact_id}`);
                  }}
                  className="text-[12px] font-semibold text-[#1A1A1A] hover:underline truncate flex-1 text-left"
                  title={f.note ?? ''}
                >
                  {displayName}
                </button>
                {stage && (
                  <span
                    className="text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded"
                    style={{ background: `${stage.colour}1A`, color: stage.colour }}
                  >
                    {stage.name}
                  </span>
                )}
                <span
                  className={cn(
                    'text-[10px] font-semibold tabular-nums whitespace-nowrap px-1.5 py-0.5 rounded',
                    dueTone === 'overdue' && 'bg-[#FEF2F2] text-[#DC2626]',
                    dueTone === 'now' && 'bg-[#FFF7ED] text-[#C2410C] animate-pulse',
                    dueTone === 'soon' && 'bg-[#FFF7ED] text-[#C2410C]'
                  )}
                >
                  {dueLabel}
                </span>
                {f.note && (
                  <span className="text-[11px] text-[#6B7280] truncate flex-1">
                    {f.note}
                  </span>
                )}
                <button
                  onClick={() => contact && openDialerPro(contact.id)}
                  disabled={!contact}
                  title="Call now"
                  className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87] disabled:opacity-50"
                >
                  <Phone className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (!contact) return;
                    const c = contacts.find((x) => x.id === contact.id);
                    if (c) { setSmsChannel('sms'); setSmsTo(c); }
                  }}
                  disabled={!contact}
                  title="SMS"
                  className="p-1 rounded hover:bg-[#EEF2F8] text-[#3C5A87] disabled:opacity-50"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (!contact) return;
                    const c = contacts.find((x) => x.id === contact.id);
                    if (c) { setSmsChannel('whatsapp'); setSmsTo(c); }
                  }}
                  disabled={!contact}
                  title="WhatsApp"
                  className="p-1 rounded hover:bg-[#EEF2F8] text-[#25D366] disabled:opacity-50"
                >
                  <MessageSquare className="w-3.5 h-3.5" strokeWidth={2.4} />
                </button>
                <button
                  onClick={() => {
                    if (!contact) return;
                    const c = contacts.find((x) => x.id === contact.id);
                    if (c) { setSmsChannel('email'); setSmsTo(c); }
                  }}
                  disabled={!contact}
                  title="Email"
                  className="p-1 rounded hover:bg-[#DBEAFE] text-[#3B82F6] disabled:opacity-50"
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => void snooze(f.id, 1)}
                  title="Snooze 1h"
                  className="p-1 rounded hover:bg-[#F3F3EE] text-[#6B7280]"
                >
                  <Clock className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => void setStatus(f.id, 'done')}
                  title="Mark done"
                  className="p-1 rounded hover:bg-[#3C5A87]/10 text-[#3C5A87]"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {smsTo && (
        <ContactSmsModal
          contact={smsTo}
          onClose={() => { setSmsTo(null); setSmsChannel(null); }}
          defaultChannel={smsChannel}
        />
      )}
    </div>
  );
}

// PR 107: countdown label scoped to the 1h-lookahead range.
//   past due → "OVERDUE — was Xm ago" (red)
//   ≤15m out → "Due now" (orange pulse)
//   16–60m  → "Due in Xm" (orange)
function countdownLabel(iso: string): {
  label: string;
  tone: 'overdue' | 'now' | 'soon';
} {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) {
    const ago = humanizeAgo(-ms);
    return { label: `OVERDUE — was ${ago}`, tone: 'overdue' };
  }
  const mins = Math.round(ms / 60_000);
  if (mins <= 15) {
    return { label: 'Due now', tone: 'now' };
  }
  return { label: `Due in ${mins}m`, tone: 'soon' };
}

function humanizeAgo(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
