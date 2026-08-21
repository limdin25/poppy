// The approval desk for builder WhatsApp invites, on the cockpit deal card.
//
// The cron scrapes and drafts; NOTHING sends without the press here (Hugo,
// 2026-08-19: approve first). A blocked draft shows its reason verbatim
// (no_viewing_time until Pedro books the time on the call, template_pending
// until Meta approves the invite template). "Builder confirmed" is the one
// road that moves the branch card into Viewing booked, and it is a human
// press on purpose, never AI-detected.

import { useCallback, useEffect, useState } from 'react';
import { HardHat, Loader2, Send, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { cn } from '@/core/lib/cn';

interface OutreachRow {
  id: string;
  status: string;
  blocked_reason: string | null;
  body: string;
  sent_at: string | null;
  replied_at: string | null;
  confirmed_at: string | null;
  error: string | null;
  brrr_builders: { name: string; phone: string | null } | null;
  brrr_properties: {
    address: string | null; wk_contact_id: string | null; viewing_at?: string | null;
  } | null;
}

/** "Fri 21 Aug 2:00pm", UK wall time, empty when there is no slot on file. */
function viewingLabel(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London',
  }).format(d).replace(/\s/g, '').toLowerCase();
  return `${date} at ${time}`;
}

const BLOCKED_WORDS: Record<string, string> = {
  no_viewing_time: 'Waiting for the viewing time (book it on the call)',
  template_pending: 'Waiting for Meta to approve the template',
  // Not a wait, a refusal: the vendor has already turned down more than our
  // ceiling, so a builder would be pricing a house we cannot buy. It clears by
  // correcting the rejected offer on the Houses tab, or by Hugo writing a
  // bigger maximum in the pinned note.
  floor_above_ceiling: 'They have already turned down more than our ceiling',
  // The other refusal, added 2026-08-20 after Wootton Street, Bedworth: a
  // twenty minute call, the branch agreeing to arrange a builder, and a house
  // 5.3 percent under its own road. Every gate here was about the vendor, the
  // time and the template; none asked whether it was still a deal.
  below_discount_rule: 'Not a deal: under the discount floor for what the road sells for',
  no_offer_on_file: 'No priced offer yet (usually the floor area is missing)',
};

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber-50 text-amber-700 border-amber-200',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  replied: 'bg-violet-50 text-violet-700 border-violet-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  skipped: 'bg-gray-50 text-gray-500 border-gray-200',
};

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/** Which house and slot a builder's thread belongs to, for the surfaces that
 *  need the FACTS rather than a chip: the inbox fills an approved template's
 *  blanks from this when the 24h window is shut. Null on any non-builder
 *  thread, and null rather than a guess when nothing is on file. */
export function useBuilderDeal(contactId: string | null): {
  address: string; viewingLabel: string; branchContactId: string | null;
} | null {
  const [deal, setDeal] = useState<
    { address: string; viewingLabel: string; branchContactId: string | null } | null
  >(null);

  useEffect(() => {
    if (!contactId) { setDeal(null); return; }
    let alive = true;
    void (async () => {
      try {
        const { rows } = await adminFetch<{ rows: OutreachRow[] }>(
          `/api/admin/builder-outreach?contact_id=${encodeURIComponent(contactId)}`,
        );
        if (!alive) return;
        const row = rows.find((r) => r.status === 'confirmed')
          ?? rows.find((r) => r.status === 'sent' || r.status === 'replied')
          ?? rows[0] ?? null;
        const address = row?.brrr_properties?.address ?? '';
        setDeal(address
          ? {
            address,
            viewingLabel: viewingLabel(row?.brrr_properties?.viewing_at ?? undefined),
            branchContactId: row?.brrr_properties?.wk_contact_id ?? null,
          }
          : null);
      } catch {
        if (alive) setDeal(null);
      }
    })();
    return () => { alive = false; };
  }, [contactId]);

  return deal;
}

/** The other half of "they stick together": on the BUILDER's thread, a line
 *  saying which deal they belong to, clicking through to the branch thread.
 *  The branch card carries the matching BuilderChip, so the pair point at
 *  each other. Renders nothing before an invite exists. */
export function BuilderThreadBanner({ contactId, onOpenContact }: {
  contactId: string;
  onOpenContact?: (branchContactId: string) => void;
}) {
  const [row, setRow] = useState<OutreachRow | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { rows } = await adminFetch<{ rows: OutreachRow[] }>(
          `/api/admin/builder-outreach?contact_id=${encodeURIComponent(contactId)}`,
        );
        if (!alive) return;
        setRow(
          rows.find((r) => r.status === 'confirmed')
          ?? rows.find((r) => r.status === 'sent' || r.status === 'replied')
          ?? null,
        );
      } catch {
        if (alive) setRow(null);
      }
    })();
    return () => { alive = false; };
  }, [contactId]);

  if (!row?.brrr_properties?.address) return null;
  const branchId = row.brrr_properties.wk_contact_id;
  const confirmed = row.status === 'confirmed';

  return (
    <button
      type="button"
      data-testid="builder-thread-banner"
      disabled={!branchId || !onOpenContact}
      onClick={() => { if (branchId && onOpenContact) onOpenContact(branchId); }}
      title={branchId ? 'Open the deal this builder belongs to' : undefined}
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-default"
    >
      <HardHat className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">
        {confirmed ? 'Confirmed for the viewing at ' : 'Invited to the viewing at '}
        {row.brrr_properties.address}
      </span>
    </button>
  );
}

/** The inbox's one-press confirm, shown on a builder's thread. Confirming
 *  from the chat is the natural moment: the builder just said yes. */
export function BuilderConfirmInboxButton({ contactId }: { contactId: string }) {
  const [row, setRow] = useState<OutreachRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { rows } = await adminFetch<{ rows: OutreachRow[] }>(
          `/api/admin/builder-outreach?contact_id=${encodeURIComponent(contactId)}`,
        );
        if (!alive) return;
        setRow(rows.find((r) => r.status === 'sent' || r.status === 'replied') ?? null);
        setNote(null);
      } catch {
        if (alive) setRow(null);
      }
    })();
    return () => { alive = false; };
  }, [contactId]);

  if (!row) return note ? <span className="text-[11px] text-amber-700">{note}</span> : null;

  return (
    <button
      type="button"
      disabled={busy}
      data-testid="inbox-builder-confirm"
      onClick={() => {
        setBusy(true);
        void (async () => {
          try {
            const out = await adminFetch<{ ok: boolean; warning?: string | null }>(
              '/api/admin/builder-outreach',
              { method: 'POST', body: JSON.stringify({ id: row.id, action: 'confirm' }) },
            );
            setRow(null);
            setNote(out.warning ?? 'Builder confirmed');
          } catch (e) {
            setNote(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        })();
      }}
      className="flex items-center gap-1.5 rounded-[10px] bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      Builder confirmed
    </button>
  );
}

interface RosterBuilder { id: string; name: string; phone: string | null; coverage: string[] }

export default function BuilderOutreachPanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<OutreachRow[]>([]);
  const [roster, setRoster] = useState<RosterBuilder[]>([]);
  const [assignedId, setAssignedId] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await adminFetch<{
        rows: OutreachRow[]; roster: RosterBuilder[]; assignedBuilderId: string | null;
      }>(`/api/admin/builder-outreach?property_id=${encodeURIComponent(propertyId)}`);
      setRows(got.rows);
      setRoster(got.roster ?? []);
      setAssignedId(got.assignedBuilderId ?? '');
    } catch {
      // Non-admins (agents) get a 403; the panel simply stays empty for them.
      setRows([]);
      setRoster([]);
    }
  }, [propertyId]);

  useEffect(() => { void load(); }, [load]);

  const press = async (id: string, action: 'send' | 'skip' | 'confirm') => {
    setBusy(id + action);
    setNote(null);
    try {
      const out = await adminFetch<{ ok: boolean; warning?: string | null }>(
        '/api/admin/builder-outreach',
        { method: 'POST', body: JSON.stringify({ id, action }) },
      );
      if (out.warning) setNote(out.warning);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const assign = async (builderId: string) => {
    setBusy('assign');
    setNote(null);
    try {
      const out = await adminFetch<{ ok: boolean; warning?: string | null }>(
        '/api/admin/builder-outreach',
        { method: 'POST', body: JSON.stringify({ action: 'assign', property_id: propertyId, builder_id: builderId }) },
      );
      setNote(out.warning ?? 'Builder assigned to this viewing.');
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // The panel exists whenever there is a roster to pick from, not only once
  // invites have been drafted: hand-picking is a first-class way in.
  if (!rows.length && !roster.length) return null;

  const live = rows.filter((r) => r.status !== 'skipped');
  const assignedName = roster.find((b) => b.id === assignedId)?.name ?? '';

  return (
    <div className="rounded-md border border-border bg-white" data-testid="builder-outreach-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[12px] font-semibold text-ink"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <HardHat className="w-3.5 h-3.5 text-amber-600" />
        Builder invites
        <span className="ml-auto text-[11px] font-normal text-ink-muted">
          {assignedName ? `${assignedName} is going`
            : live.filter((r) => r.status === 'sent' || r.status === 'replied').length
              ? `${live.filter((r) => r.status === 'sent' || r.status === 'replied').length} out`
              : `${live.filter((r) => r.status === 'draft').length} waiting for your press`}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border p-2">
          {note && <p className="text-[11px] text-amber-700">{note}</p>}

          {/* WHO IS GOING TO THIS HOUSE. Hugo, 2026-08-20: he wanted to say it
              himself, not only let a WhatsApp reply decide it. Picking here
              books the builder, moves the card to Viewing booked and puts the
              chip on it, exactly like the confirm press does. */}
          {roster.length > 0 && (
            <div className="rounded border border-border bg-surface px-2 py-1.5">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                Who is going to this house
              </label>
              <select
                data-testid="builder-assign-select"
                disabled={busy !== null}
                value={assignedId}
                onChange={(e) => { if (e.target.value) void assign(e.target.value); }}
                className="mt-1 w-full rounded border border-border bg-white px-1.5 py-1 text-[11.5px] text-ink"
              >
                <option value="">Pick a builder from the roster</option>
                {roster.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.coverage?.length ? ` (${b.coverage.join(', ')})` : ''}
                  </option>
                ))}
              </select>
              {assignedName && (
                <p className="mt-1 text-[10.5px] text-emerald-700">
                  {assignedName} is booked onto this viewing.
                </p>
              )}
            </div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="rounded border border-border p-2" data-testid={`builder-outreach-row-${r.id}`}>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-ink">{r.brrr_builders?.name ?? 'Builder'}</span>
                <span className="text-[11px] text-ink-muted">{r.brrr_builders?.phone ?? ''}</span>
                <span className={cn(
                  'ml-auto rounded border px-1.5 py-0.5 text-[10px] font-medium',
                  STATUS_STYLE[r.status] ?? STATUS_STYLE.draft,
                )}
                >
                  {r.status}
                </span>
              </div>
              {r.blocked_reason && r.status === 'draft' && (
                <p className="mt-1 text-[11px] text-amber-700">
                  {BLOCKED_WORDS[r.blocked_reason] ?? r.blocked_reason}
                </p>
              )}
              {r.error && r.status === 'failed' && (
                <p className="mt-1 text-[11px] text-red-600">{r.error}</p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-muted">{r.body}</p>
              <div className="mt-1.5 flex gap-1.5">
                {r.status === 'draft' && !r.blocked_reason && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void press(r.id, 'send')}
                    className="inline-flex items-center gap-1 rounded bg-ink px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    {busy === `${r.id}send` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Send invite
                  </button>
                )}
                {(r.status === 'draft' || r.status === 'approved') && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void press(r.id, 'skip')}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-ink-muted disabled:opacity-50"
                  >
                    <X className="w-3 h-3" /> Skip
                  </button>
                )}
                {(r.status === 'sent' || r.status === 'replied') && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void press(r.id, 'confirm')}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                    data-testid={`builder-confirm-${r.id}`}
                  >
                    {busy === `${r.id}confirm` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Builder confirmed
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
