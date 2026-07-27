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

import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Contact } from '../../types';

interface EventRow {
  id: string;
  type: string;
  meta: { pct?: number; bot?: boolean; from?: string; internal?: boolean } | null;
  created_at: string;
}

export interface FunnelLeadDrawerProps {
  page: VslPage;
  /** Built by the board so the ?p=1 staff-preview marker lives in one place. */
  previewUrl: string;
  onClose: () => void;
  onSendVideo: (p: VslPage) => void | Promise<void>;
  onNudge: (p: VslPage) => void | Promise<void>;
  sending: boolean;
  sent: boolean;
  nudged: boolean;
}

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
  page, previewUrl, onClose, onSendVideo, onNudge, sending, sent, nudged,
}: FunnelLeadDrawerProps) {
  const { contact, state } = useContactForPage(page.contact_id);
  const { upsertContact, patchContact, pushToast } = useSmsV2();
  const persist = useContactPersistence();
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [smsTo, setSmsTo] = useState<Contact | null>(null);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
            <span>watched {page.watched_pct}%</span>
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
              {key === 'render_ready' && (
                <button
                  onClick={() => void onSendVideo(page)}
                  disabled={sending || sent}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-[#16A34A] hover:bg-[#15803d] disabled:opacity-60 rounded-[8px] py-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  {sending ? 'Sending…' : sent ? 'Sent' : 'Looks good — text it'}
                </button>
              )}
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
