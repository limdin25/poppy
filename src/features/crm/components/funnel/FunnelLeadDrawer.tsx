// FunnelLeadDrawer — open a lead from the video funnel board at ANY stage.
//
// Hugo 2026-07-27: "I and the team need to be able to open the lead during any
// stage on /admin/crm/video-funnel and edit name, email, text, anything."
// Before this the card's only affordances were a link out to the contact page
// and a read-only activity list, so acting on a lead meant leaving the board.
//
// This IS the old ActivityDrawer, moved here and grown up: the journey and the
// raw wk_vsl_events list are unchanged, with editing, texting, stage changes and
// the render timeline added around them.
//
// Deliberately embeds EditContactModal / ContactSmsModal rather than
// re-implementing a form. z-indexes already layer: drawer 50 < edit 150 < sms
// 300.
//
// sendVideo / nudge are passed in from the board and NEVER reimplemented here —
// a second copy would carry its own "already texted" guard and the lead would
// get the video twice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Pencil, Send, Copy, Check, ExternalLink, Bell, Play, ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { useContactPersistence } from '../../hooks/useContactPersistence';
import { rowToContact, CONTACT_COLUMNS } from '../../hooks/useHydrateContacts';
import { formatDateTime } from '../../data/helpers';
import ContactIdentity from '../shared/ContactIdentity';
import AgentChip from '../shared/AgentChip';
import StageSelector from '../shared/StageSelector';
import EditContactModal from '../contacts/EditContactModal';
import ContactSmsModal from '../contacts/ContactSmsModal';
import {
  EVENT_LABELS, FULL_TIMELINE, boardKey, columnEnteredAt, stateMeta,
  type VslPage,
} from '../../lib/funnelStages';
import {
  buildSentLog, countdownLabel, insideQuietHoursLondon, londonStamp,
} from '../../lib/followUpTimeline';
// The ONE copy of the follow-up schedule. The five-minute cron calls this same
// function with the same page row, so what this drawer promises is exactly what
// the lead gets. A second table of delays in the UI would drift the day either
// side is edited, and the board would be quietly lying.
import { nextSequenceStep, type SequenceVerdict } from '../../../../../api/lib/vsl-sequence';
import type { VslSettings } from '../../../../../api/lib/vsl-settings';
import type { Contact } from '../../types';

interface EventRow {
  id: string;
  type: string;
  meta: {
    pct?: number; bot?: boolean; from?: string; internal?: boolean;
    /** auto_sms rows only: which rule fired, and which message of that rule. */
    rule?: string; nudge?: number;
  } | null;
  created_at: string;
}

export interface FunnelLeadDrawerProps {
  page: VslPage;
  /** Built by the board so the ?p=1 staff-preview marker lives in one place. */
  previewUrl: string;
  onClose: () => void;
  onNudge: (p: VslPage) => void | Promise<void>;
  nudged: boolean;
  /** Open straight into the send composer (the card's green button). */
  startInCompose?: boolean;
  /** Told when a send succeeded, so the board can mark the card. */
  onSent?: (pageId: string) => void;
}

type Channel = 'sms' | 'whatsapp' | 'email';

const CHANNEL_LABEL: Record<Channel, string> = {
  sms: 'Text',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

interface PageInfo {
  sms_body: string;
  url: string;
  enabled: boolean;
  can_send: boolean;
}

/** Module scope, keyed by contact — the drawer can be reopened, and a per-mount
 *  ref would forget that the message already went out and re-send it. Same
 *  reason VideoLinkButton's guard lives at module scope. */
const sentByContact = new Set<string>();
const sendInFlight = new Set<string>();

type ContactState = 'loading' | 'ready' | 'denied';

/**
 * The board's rows come from wk_vsl_pages, whose RLS is narrower than
 * wk_contacts' — and useHydrateContacts filters by owner when impersonating —
 * so a store miss here is legitimate, not a bug. Fall back to a by-id fetch,
 * then to an honest "no access" rather than an empty form that swallows edits.
 */
function useContactForPage(contactId: string): { contact: Contact | null; state: ContactState } {
  const { getContact, upsertContact } = useSmsV2();
  const fromStore = getContact(contactId);
  const [fetched, setFetched] = useState<Contact | null>(null);
  const [state, setState] = useState<ContactState>(fromStore ? 'ready' : 'loading');

  useEffect(() => {
    if (fromStore) { setState('ready'); return; }
    let dead = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_contacts' as any) as any)
        .select(CONTACT_COLUMNS)
        .eq('id', contactId)
        .maybeSingle();
      if (dead) return;
      if (error) console.warn('[funnel-drawer] contact fetch failed:', error.message);
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = rowToContact(data as any, []);
        setFetched(c);
        upsertContact(c);
        setState('ready');
      } else {
        setState('denied');
      }
    })();
    return () => { dead = true; };
    // upsertContact is recreated on every store dispatch — depending on it
    // would re-run this fetch forever (the 2026-07-22 hydration loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, !!fromStore]);

  return { contact: fromStore ?? fetched, state };
}

export default function FunnelLeadDrawer({
  page, previewUrl, onClose, onNudge, nudged, startInCompose = false, onSent,
}: FunnelLeadDrawerProps) {
  const { contact, state } = useContactForPage(page.contact_id);
  const { upsertContact, patchContact, pushToast } = useSmsV2();
  const persist = useContactPersistence();
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── the send composer ─────────────────────────────────────────────────────
  // Hugo 2026-07-27: "it says looks good text it but is not showing the text."
  // The old button fired a send with a message nobody had seen. Now the message
  // is fetched, shown, editable, and the channel is a choice.
  const [composing, setComposing] = useState(startInCompose);
  const [channel, setChannel] = useState<Channel>('sms');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [info, setInfo] = useState<PageInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(sentByContact.has(page.contact_id));

  useEffect(() => {
    let dead = false;
    void (async () => {
      const { data, error } = await (supabase.from('wk_vsl_events' as never) as never as {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: EventRow[] | null; error: unknown }>;
            };
          };
        };
      })
        .select('id, type, meta, created_at')
        .eq('page_id', page.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) console.warn('[video-funnel] events failed:', error);
      if (!dead) setRows(data || []);
    })();
    return () => { dead = true; };
  }, [page.id]);

  // ESC closes the drawer — but only when no child modal is open, or one
  // keypress would close both layers at once. Neither child has its own
  // handler, so this is the whole story.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing && !smsTo) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, smsTo, onClose]);

  useEffect(() => { panelRef.current?.focus(); }, []);

  /** Load the message the server would send, so the agent sees it before it goes. */
  const loadMessage = useCallback(async () => {
    setNote('');
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) { setNote('Session expired — sign in again.'); return; }
    const res = await fetch('/api/crm/vsl-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contact_id: page.contact_id }),
    });
    const data = (await res.json().catch(() => null)) as PageInfo | null;
    if (!res.ok || !data) { setNote('Could not load the message — try again.'); return; }
    setInfo(data);
    setBody((b) => (b.trim() ? b : data.sms_body));  // never clobber an edit
    setSubject((s) => s || `A quick 2-minute video for ${page.business_name}`);
  }, [page.contact_id, page.business_name]);

  useEffect(() => {
    if (composing && !info) void loadMessage();
  }, [composing, info, loadMessage]);

  async function send() {
    const id = page.contact_id;
    if (sendInFlight.has(id)) return;
    if (!body.trim()) { setNote('The message is empty.'); return; }
    if (channel === 'email' && !contact?.email) { setNote('This lead has no email address.'); return; }
    if (channel !== 'email' && !contact?.phone) { setNote('This lead has no mobile number.'); return; }

    sendInFlight.add(id);
    setBusy(true);
    setNote('');
    try {
      // Re-check right before sending: the funnel may have been switched off, or
      // the render may not actually be ready, since the panel was opened.
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { setNote('Session expired — sign in again.'); return; }
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const fresh = await fetch('/api/crm/vsl-page', {
        method: 'POST', headers, body: JSON.stringify({ contact_id: id }),
      });
      const freshInfo = (await fresh.json().catch(() => null)) as PageInfo | null;
      if (!fresh.ok || !freshInfo) { setNote('Could not reach the server — try again.'); return; }
      if (freshInfo.enabled === false) {
        setNote('The video funnel is switched off in Settings — turn it on to send.');
        return;
      }
      if (!freshInfo.can_send) { setNote('The video isn’t ready yet.'); return; }

      // Send once. If a previous attempt already delivered and only the mark
      // failed, retry re-marks WITHOUT re-sending.
      if (!sentByContact.has(id)) {
        const fn = supabase.functions;
        const payload = { contact_id: id, body: body.trim() };
        const resp =
          channel === 'sms' ? await fn.invoke('wk-sms-send', { body: payload })
          : channel === 'whatsapp' ? await fn.invoke('unipile-send', { body: payload })
          : await fn.invoke('wk-email-send', { body: { ...payload, subject: subject.trim() } });
        const err = resp.error || (resp.data as { error?: string } | null)?.error;
        if (err) {
          setNote(`${CHANNEL_LABEL[channel]} failed: ${typeof err === 'string' ? err : err.message}`);
          return;
        }
        sentByContact.add(id);
      }

      const marked = await fetch('/api/crm/vsl-page', {
        method: 'POST', headers, body: JSON.stringify({ contact_id: id, mark_sent: true }),
      });
      if (!marked.ok) {
        setNote('Sent, but tracking didn’t arm — tap again (it won’t re-send).');
        return;
      }
      sentByContact.delete(id);
      setSent(true);
      setComposing(false);
      onSent?.(page.id);
      pushToast(`${CHANNEL_LABEL[channel]} sent`, 'success');
    } finally {
      sendInFlight.delete(id);
      setBusy(false);
    }
  }

  // Optimistic, with a real revert. The field list is deliberately WIDE:
  // ContactDetailPage's version persists only name/email/stage, so copying it
  // verbatim would silently discard phone, owner and — the whole point of this
  // drawer — custom_fields.owner_name.
  const save = useCallback((updated: Contact) => {
    const prev = contact;
    upsertContact(updated);
    void persist
      .patchContact(updated.id, {
        name: updated.name,
        phone: updated.phone,
        email: updated.email ?? null,
        owner_agent_id: updated.ownerAgentId ?? null,
        pipeline_column_id: updated.pipelineColumnId ?? null,
        deal_value_pence: updated.dealValuePence ?? null,
        is_hot: updated.isHot,
        custom_fields: updated.customFields,
      })
      .then((res) => {
        if (res === true) pushToast('Saved ✓', 'success');
        else {
          if (prev) upsertContact(prev);
          pushToast(res ?? 'Save failed — reverted', 'error');
        }
      });
    // Tags live in wk_contact_tags — patchContact cannot write them.
    void persist.replaceTags(updated.id, updated.tags);
  }, [contact, upsertContact, persist, pushToast]);

  const setStage = useCallback((columnId: string) => {
    if (!contact) return;
    patchContact(contact.id, { pipelineColumnId: columnId });
    void persist.moveToColumn(contact.id, columnId).then((ok) => {
      if (!ok) pushToast('Could not move the stage', 'error');
    });
  }, [contact, patchContact, persist, pushToast]);

  const entered = columnEnteredAt(page);
  const key = boardKey(page);
  const meta = stateMeta(key);
  const canAct = state === 'ready' && !!contact;

  const btn =
    'flex items-center justify-center gap-1.5 text-[11.5px] font-semibold rounded-[8px] px-2.5 py-1.5 transition-colors disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={page.business_name}
        className="w-full max-w-[520px] h-full bg-white overflow-y-auto p-5 outline-none"
        onClick={(e) => e.stopPropagation()}
        data-testid="funnel-lead-drawer"
      >
        {/* Kept so anything that looked for the old drawer still finds it. */}
        <div data-testid="funnel-activity-drawer" className="contents">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h2 className="text-[16px] font-black truncate">{page.business_name}</h2>
              <ContactIdentity
                owner={contact?.customFields?.owner_name ?? page.wk_contacts?.owner_name ?? page.owner_first}
                website={contact?.customFields?.website ?? page.wk_contacts?.website}
                layout="stack"
                size="sm"
                className="mt-0.5"
              />
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-[#F3F3EE] flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11px] text-[#6B7280] mb-3">
            <span
              className="px-1.5 py-0.5 rounded-full font-bold text-[10px]"
              style={{ background: `${meta.color}22`, color: meta.color }}
            >
              {meta.label}
            </span>
            <AgentChip agentId={page.agent_id} label="Made by" size="xs" />
            <span>·</span>
            <span>heyelsie.com/{page.slug}</span>
            <span>·</span>
            {/* "% of video", never "watched N%" — beside the stage pill above
                it, the old wording read as a second, contradicting stage. */}
            <span title="How far into the video they actually got. The lead only reaches the Watched stage once this passes the threshold in settings.">
              {page.watched_pct}% of video
            </span>
            <span>·</span>
            <span>{page.open_count} open{page.open_count === 1 ? '' : 's'}</span>
          </div>

          {state === 'denied' && (
            <p className="text-[11.5px] text-[#B45309] bg-[#FFFBEB] border border-[#FDE68A] rounded-[8px] px-2.5 py-2 mb-3 leading-snug">
              This lead's record isn't visible under your access, so it can't be edited or
              texted here. Everything below still works.
            </p>
          )}

          {/* ── actions ── */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button
              onClick={() => contact && setEditing(contact)}
              disabled={!canAct}
              data-testid="funnel-drawer-edit"
              className={`${btn} text-white bg-[#3C5A87] hover:bg-[#33507a]`}
            >
              <Pencil className="w-3.5 h-3.5" /> Edit lead
            </button>
            <button
              onClick={() => contact && setSmsTo(contact)}
              disabled={!canAct}
              data-testid="funnel-drawer-text"
              className={`${btn} text-[#3C5A87] border border-[#E5E7EB] bg-white hover:bg-[#eaf1f8]`}
            >
              <Send className="w-3.5 h-3.5" /> Text
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`https://heyelsie.com/${page.slug}`);
                setCopied(true);
              }}
              className={`${btn} text-[#3C5A87] border border-[#E5E7EB] bg-white hover:bg-[#eaf1f8]`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className={`${btn} text-[#3C5A87] border border-[#E5E7EB] bg-white hover:bg-[#eaf1f8]`}
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open page
            </a>
            <button
              onClick={() => void onNudge(page)}
              disabled={nudged}
              className={`${btn} text-[#3C5A87] border border-[#E5E7EB] bg-white hover:bg-[#eaf1f8]`}
            >
              <Bell className="w-3.5 h-3.5" /> {nudged ? 'Nudged' : 'Nudge'}
            </button>
          </div>

          {/* ── stage ── */}
          <div className="flex items-center gap-2 flex-wrap mb-4 pb-4 border-b border-[#E5E7EB]">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-[#9CA3AF]">
              Stage
            </span>
            {canAct ? (
              <StageSelector value={contact?.pipelineColumnId} onChange={setStage} size="sm" />
            ) : (
              <span className="text-[11px] text-[#9CA3AF] italic">not editable</span>
            )}
            <span className="text-[11px] text-[#6B7280]" title={formatDateTime(entered.at)}>
              In {entered.label} since {formatDateTime(entered.at)}
            </span>
          </div>

          {/* ── the video ── */}
          {page.video_url && (
            <div className="mb-4">
              <video
                src={page.video_url}
                poster={page.poster_url ?? undefined}
                controls
                preload="none"
                className="w-full rounded-[10px] border border-[#E5E7EB] bg-black"
              />
              {key === 'render_ready' && !composing && (
                <button
                  onClick={() => setComposing(true)}
                  disabled={sent}
                  data-testid="funnel-drawer-review-send"
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#16A34A] hover:bg-[#15803d] disabled:opacity-60 rounded-[8px] py-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  {sent ? 'Sent' : 'Looks good — write the message'}
                </button>
              )}
            </div>
          )}

          {/* ── the composer: see the message, pick the channel, edit it ──
              Hugo 2026-07-27: the old button sent a message nobody had read. */}
          {composing && (
            <div
              className="mb-5 rounded-[10px] border border-[#c9d6e8] bg-[#f2f6fb] p-3 space-y-2"
              data-testid="funnel-send-composer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#3C5A87]">
                  Send the video
                </span>
                <button
                  onClick={() => setComposing(false)}
                  className="p-0.5 rounded hover:bg-black/[0.06] text-[#6B7280]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Text is the default and always first. WhatsApp and Email are
                  offered only when the lead actually has the address for them —
                  a disabled tab explains itself rather than failing on send. */}
              <div className="flex items-center gap-1 bg-white border border-[#d5e0ee] rounded-full p-0.5 w-fit">
                {(['sms', 'whatsapp', 'email'] as Channel[]).map((c) => {
                  const usable = c === 'email' ? !!contact?.email : !!contact?.phone;
                  return (
                    <button
                      key={c}
                      onClick={() => usable && setChannel(c)}
                      disabled={!usable}
                      data-testid={`funnel-channel-${c}`}
                      title={usable ? undefined : c === 'email' ? 'No email address on this lead' : 'No mobile number on this lead'}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors ${
                        channel === c ? 'bg-[#3C5A87] text-white'
                        : usable ? 'text-[#6B7280] hover:bg-[#eaf1f8]'
                        : 'text-[#D1D5DB] cursor-not-allowed'
                      }`}
                    >
                      {CHANNEL_LABEL[c]}
                    </button>
                  );
                })}
              </div>

              {channel === 'email' && (
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  data-testid="funnel-send-subject"
                  className="w-full px-2 py-1.5 text-[12px] border border-[#d5e0ee] rounded-[8px] bg-white"
                />
              )}

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder={info ? '' : 'Loading the message…'}
                data-testid="funnel-send-body"
                className="w-full px-2 py-1.5 text-[12px] leading-snug border border-[#d5e0ee] rounded-[8px] bg-white resize-y"
              />

              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-[#6B7280] tabular-nums">
                  {body.length}
                  {channel === 'sms' && `/160${body.length > 160 ? ` · ${Math.ceil(body.length / 160)} texts` : ''}`}
                </span>
                <button
                  onClick={() => { setBody(info?.sms_body ?? ''); }}
                  disabled={!info}
                  className="text-[10.5px] text-[#3C5A87] hover:underline disabled:text-[#D1D5DB]"
                >
                  Reset to template
                </button>
                <button
                  onClick={() => void send()}
                  disabled={busy || !body.trim() || !info}
                  data-testid="funnel-send-confirm"
                  className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#16A34A] hover:bg-[#15803d] disabled:opacity-60 rounded-[8px] px-3 py-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  {busy ? 'Sending…' : `Send ${CHANNEL_LABEL[channel]}`}
                </button>
              </div>

              {note && <div className="text-[10.5px] text-[#b45309] leading-snug">{note}</div>}
            </div>
          )}

          {/* ── the whole life of this page ── */}
          <div className="mb-5">
            <p className="text-[12px] font-black mb-2">Journey</p>
            <div className="space-y-1">
              {FULL_TIMELINE.map((s) => {
                const ts = page[s.key] as string | null;
                return (
                  <div
                    key={String(s.key)}
                    className="flex items-baseline justify-between gap-3 text-[12px]"
                  >
                    <span className={ts ? 'text-[#1A1A1A] font-medium' : 'text-[#D1D5DB]'}>
                      {s.label}
                    </span>
                    <span className="text-[11px] text-[#6B7280] tabular-nums whitespace-nowrap">
                      {ts ? formatDateTime(ts) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <FollowUps page={page} events={rows} />

          <p className="text-[12px] font-black mb-2">Every event</p>
          {rows === null ? (
            <p className="text-[12px] text-[#9CA3AF] italic">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-[#9CA3AF] italic">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-[#E5E7EB]">
              {rows.map((e) => (
                <li
                  key={e.id}
                  className="py-1.5 flex items-baseline justify-between gap-3 text-[12px]"
                >
                  <span className={e.meta?.bot || e.meta?.internal ? 'text-[#9CA3AF]' : 'text-[#1A1A1A]'}>
                    {e.meta?.internal
                      ? 'Viewed by us'
                      : e.type === 'progress' && typeof e.meta?.pct === 'number'
                        ? `Watched ${e.meta.pct}%`
                        : EVENT_LABELS[e.type] || e.type}
                    {/* Staff and preview fetchers are kept and labelled rather
                        than hidden — the board must never count them as the
                        lead, but "did anyone look at this?" stays answerable. */}
                    {e.meta?.internal && <span className="ml-1 text-[10px]">(staff preview, not counted)</span>}
                    {e.meta?.bot && <span className="ml-1 text-[10px]">(link preview, not counted)</span>}
                    {e.meta?.from === 'stripe' && <span className="ml-1 text-[10px]">(back from checkout)</span>}
                  </span>
                  <span className="text-[11px] text-[#6B7280] tabular-nums whitespace-nowrap">
                    {formatDateTime(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            to={`/admin/crm/contacts/${page.contact_id}`}
            className="mt-5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3C5A87] hover:underline"
          >
            Open full lead record <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {editing && (
        <EditContactModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={(updated) => { save(updated); setEditing(null); }}
        />
      )}
      {smsTo && <ContactSmsModal contact={smsTo} onClose={() => setSmsTo(null)} />}
    </div>
  );
}

/**
 * Follow-ups. Hugo 2026-07-27: "add log with timeline of what happened and
 * what is next with time counting."
 *
 * Three things, in the order an agent asks for them: what has already gone out,
 * what goes next and how long until it does, and when nothing is next, the
 * honest reason.
 *
 * The schedule is not decided here. nextSequenceStep() owns every delay, the
 * one-text-per-24h cap and the deepest-first ordering, and the five-minute cron
 * calls that same function, so this panel cannot promise a text the cron will
 * not send.
 */
function FollowUps({ page, events }: { page: VslPage; events: EventRow[] | null }) {
  const [settings, setSettings] = useState<VslSettings | null>(null);
  const [settingsNote, setSettingsNote] = useState('');
  const [repliedAt, setRepliedAt] = useState<string | null>(null);

  // ONE interval for the whole panel, cleared on unmount. The board is never
  // refetched to make the countdown move: the labels are minute-granular, so
  // re-reading the clock is the entire job.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // The delays are configurable per workspace, so the countdown has to read the
  // live config rather than assume the defaults. Admin-gated endpoint: an agent
  // who cannot see it still gets the sent log, with the gap explained.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/crm/vsl-settings', {
        headers: { Authorization: `Bearer ${sess.session?.access_token}` },
      }).catch(() => null);
      if (dead) return;
      if (!res || !res.ok) {
        setSettingsNote(
          res?.status === 403
            ? 'The follow-up schedule is only visible to admins.'
            : 'Could not load the follow-up schedule.',
        );
        return;
      }
      const d = (await res.json().catch(() => null)) as { settings?: VslSettings } | null;
      if (!dead && d?.settings) setSettings(d.settings);
      else if (!dead) setSettingsNote('Could not load the follow-up schedule.');
    })();
    return () => { dead = true; };
  }, []);

  // A reply stops the sequence for good. nextSequenceStep is pure and cannot
  // read wk_sms_messages, so the last inbound is looked up here and handed to it
  // as context, exactly as the cron does. Whether it counts (only inbound after
  // the video went out does) stays the sequence's call, not this panel's.
  useEffect(() => {
    let dead = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
        .select('created_at')
        .eq('contact_id', page.contact_id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) console.warn('[funnel-drawer] reply check failed:', error.message);
      if (!dead) setRepliedAt((data?.[0]?.created_at as string | undefined) ?? null);
    })();
    return () => { dead = true; };
  }, [page.contact_id]);

  const log = useMemo(() => buildSentLog(page.automation, events), [page.automation, events]);

  // The page row IS the sequence's input (SequencePage is structurally the
  // stamps this row already carries), so nothing is copied or reshaped on the
  // way in. Everything the schedule cannot see for itself is context: the reply,
  // the master switch, the agent opt-out and the quiet-hours window.
  const verdict = useMemo<SequenceVerdict | null>(() => {
    if (!settings) return null;
    return nextSequenceStep(page, {
      rules: settings.rules,
      now: new Date(now),
      lastInboundAt: repliedAt,
      enabled: settings.enabled,
      agentDisabled: settings.agent_disabled.includes(page.agent_id),
      insideQuietHours: insideQuietHoursLondon(settings.quiet_hours, now),
    });
  }, [page, settings, repliedAt, now]);

  // What is coming, whether it goes out on this run or a later one.
  const step = verdict?.due ?? verdict?.next ?? null;
  // The reason sentence is worth printing whenever it says something the
  // countdown does not: held by the 24h cap, quiet hours, replied, paid, capped.
  const detail =
    verdict && verdict.reason !== 'due' && verdict.reason !== 'waiting' ? verdict.detail : '';

  return (
    <div className="mb-5" data-testid="funnel-followups">
      <p className="text-[12px] font-black mb-2">Follow-ups</p>

      {log.length === 0 ? (
        <p className="text-[12px] text-[#9CA3AF] italic" data-testid="funnel-followup-log">
          No automatic messages have gone out yet.
        </p>
      ) : (
        <ol className="space-y-1" data-testid="funnel-followup-log">
          {log.map((s, i) => (
            <li
              key={`${s.key}-${s.at}-${i}`}
              className="flex items-baseline justify-between gap-3 text-[12px]"
            >
              <span className="text-[#1A1A1A]">
                {s.label}
                {s.nudge > 1 && <span className="text-[#6B7280]"> (message {s.nudge})</span>}
                {/* Reconstructed from the page counters, which remember only the
                    last send per rule. Labelled rather than passed off as exact. */}
                {!s.exact && (
                  <span className="ml-1 text-[10px] text-[#9CA3AF]">(latest of this rule)</span>
                )}
              </span>
              <span
                className="text-[11px] text-[#6B7280] tabular-nums whitespace-nowrap"
                title={londonStamp(s.at)}
              >
                {formatDateTime(s.at)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div
        className="mt-2 rounded-[8px] border border-[#E5E7EB] bg-[#FAFAF7] px-2.5 py-2"
        data-testid="funnel-followup-next"
      >
        {!settings ? (
          <p className="text-[12px] text-[#9CA3AF] italic">
            {settingsNote || 'Checking the schedule.'}
          </p>
        ) : (
          <>
            {step && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-[#1A1A1A]">
                  <span className="font-semibold">Next:</span> {step.label}
                </span>
                <span
                  className="text-[11px] font-semibold text-[#3C5A87] tabular-nums whitespace-nowrap"
                  title={londonStamp(step.at)}
                  data-testid="funnel-followup-countdown"
                >
                  {verdict?.due ? 'any minute now' : countdownLabel(step.at, now)}
                </span>
              </div>
            )}
            {step && !verdict?.due && (
              <p
                className="mt-0.5 text-[10.5px] text-[#9CA3AF] tabular-nums"
                title={londonStamp(step.at)}
              >
                {formatDateTime(step.at)}
              </p>
            )}
            {(detail || !step) && (
              <p
                className={`text-[12px] text-[#6B7280] leading-snug${step ? ' mt-1' : ''}`}
                data-testid="funnel-followup-reason"
              >
                {detail || 'Nothing is due.'}
                {/* The module says they replied; the drawer knows when, because
                    it is the side that can read the inbox. */}
                {verdict?.reason === 'replied' && repliedAt && (
                  <span title={londonStamp(repliedAt)}> They replied on {formatDateTime(repliedAt)}.</span>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
