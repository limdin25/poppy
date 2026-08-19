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
  brrr_properties: { address: string | null; wk_contact_id: string | null } | null;
}

const BLOCKED_WORDS: Record<string, string> = {
  no_viewing_time: 'Waiting for the viewing time (book it on the call)',
  template_pending: 'Waiting for Meta to approve the template',
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

export default function BuilderOutreachPanel({ propertyId }: { propertyId: string }) {
  const [rows, setRows] = useState<OutreachRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { rows: got } = await adminFetch<{ rows: OutreachRow[] }>(
        `/api/admin/builder-outreach?property_id=${encodeURIComponent(propertyId)}`,
      );
      setRows(got);
    } catch {
      // Non-admins (agents) get a 403; the panel simply stays empty for them.
      setRows([]);
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

  if (!rows.length) return null;

  const live = rows.filter((r) => r.status !== 'skipped');

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
          {live.filter((r) => r.status === 'confirmed').length ? 'builder confirmed'
            : live.filter((r) => r.status === 'sent' || r.status === 'replied').length
              ? `${live.filter((r) => r.status === 'sent' || r.status === 'replied').length} out`
              : `${live.filter((r) => r.status === 'draft').length} waiting for your press`}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border p-2">
          {note && <p className="text-[11px] text-amber-700">{note}</p>}
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
