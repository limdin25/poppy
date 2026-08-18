// "Who is this?" for an inbound call from a number we do not hold.
//
// WHY (2026-08-18). A branch is filed under its switchboard, which is the
// number the scraper found and the number Pedro dialled. When they ring back it
// is very often from a negotiator's direct line, so the caller matches nothing
// and the room has no deal to show. Hugo: "make it a no brainer for Pedro, and
// right script in front of him, even if he needs to search the branch because
// it is unknown".
//
// So the room still opens on the call-one script, and this sits where the
// contact card would be. He types the agency name, presses the right one, and
// the whole room fills in: the houses, the offer band, the brief, the coach
// facts. It also files the call against that branch, so the outcome he presses
// afterwards lands on the right deal instead of nowhere.
//
// Two sources on purpose: the CRM store first (already in memory, instant, and
// it is his own leads), then wk_contacts for anything the store has not loaded.
// The house counts come from the same batched RPC the pipeline board uses, so a
// branch with properties on file is obvious at a glance.

import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Home } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../../store/SmsV2Store';
import { usePropertyLinks, phoneTail } from '../../hooks/usePropertyLinks';
import type { Contact } from '../../types';

interface Props {
  /** The number that rang, shown so he can read it back to them. */
  callerPhone: string;
  /** hasHouses says the branch has properties on file, so the call can be
   *  filed as a property call and the coach can be told which script it is
   *  listening to. */
  onPick: (contact: Contact, hasHouses: boolean) => void;
}

/** A wk_contacts row in the shape the call room expects. */
function rowToContact(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id),
    name: (r.name as string) ?? '',
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? undefined,
    ownerAgentId: (r.owner_agent_id as string) ?? undefined,
    pipelineColumnId: (r.pipeline_column_id as string) ?? undefined,
    tags: [],
    isHot: r.is_hot === true,
    dealValuePence: (r.deal_value_pence as number) ?? undefined,
    customFields: (r.custom_fields as Record<string, string>) ?? {},
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
    lastContactAt: (r.last_contact_at as string) ?? undefined,
  };
}

const SELECT =
  'id, name, phone, email, owner_agent_id, pipeline_column_id, is_hot, deal_value_pence, custom_fields, created_at, last_contact_at';

export default function BranchSearchPanel({ callerPhone, onPick }: Props) {
  const { contacts } = useSmsV2();
  const [term, setTerm] = useState('');
  const [remote, setRemote] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

  const q = term.trim();

  // What is already in memory. Free, and covers the branches he has worked.
  const local = useMemo(() => {
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    const digits = q.replace(/\D/g, '');
    return contacts
      .filter((c) =>
        c.name?.toLowerCase().includes(needle)
        || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
      .slice(0, 8);
  }, [contacts, q]);

  // Anything the store has not loaded. Debounced, because this fires while a
  // live call is on and a keystroke is not worth a round trip.
  useEffect(() => {
    if (q.length < 2) { setRemote([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      void (async () => {
        const like = `%${q.replace(/[%,]/g, ' ')}%`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase.from('wk_contacts' as any) as any)
          .select(SELECT)
          .or(`name.ilike.${like},phone.ilike.${like}`)
          .limit(8);
        if (cancelled) return;
        setRemote(((data ?? []) as Array<Record<string, unknown>>).map(rowToContact));
        setSearching(false);
      })();
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q]);

  const results = useMemo(() => {
    const seen = new Set<string>();
    return [...local, ...remote].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).slice(0, 10);
  }, [local, remote]);

  const { byPhone } = usePropertyLinks(results.map((c) => c.phone));
  const housesFor = (phone: string) => byPhone.get(phoneTail(phone))?.length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="branch-search">
      <div className="text-[13px] font-semibold text-[#1A1A1A]">Who is calling?</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-[#6B7280]">
        This number is not on any lead: <span className="tabular-nums">{callerPhone || 'withheld'}</span>.
        Branches often ring back from a direct line. Find the office and the whole deal opens up.
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#E5E7EB] px-2 py-1.5 focus-within:border-[#3C5A87]">
        <Search className="h-3.5 w-3.5 flex-shrink-0 text-[#9CA3AF]" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Agency name or number"
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-[#9CA3AF]"
          data-testid="branch-search-input"
        />
        {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9CA3AF]" />}
      </div>

      {q.length >= 2 && results.length === 0 && !searching && (
        <div className="mt-3 text-[11.5px] text-[#9CA3AF]">
          Nothing found. Take the call on the script below and file it afterwards.
        </div>
      )}

      <div className="mt-2 space-y-1">
        {results.map((c) => {
          const n = housesFor(c.phone);
          return (
            <button
              key={c.id}
              onClick={() => onPick(c, n > 0)}
              className="flex w-full items-baseline gap-2 rounded-md border border-[#E5E7EB] px-2 py-1.5 text-left transition hover:bg-[#FAFAF8]"
            >
              <span className="flex-1 truncate text-[12px] font-medium text-[#1A1A1A]">{c.name || 'Unnamed'}</span>
              {n > 0 && (
                <span className="flex items-center gap-1 whitespace-nowrap rounded bg-[#EEF2F8] px-1 text-[10px] font-semibold text-[#3C5A87]">
                  <Home className="h-2.5 w-2.5" /> {n}
                </span>
              )}
              <span className="whitespace-nowrap text-[11px] tabular-nums text-[#6B7280]">{c.phone}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
