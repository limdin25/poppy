// The house panel: everything behind the three numbers pinned above the script.
//
// It lived in a tab on the right until 2026-08-12, when Hugo moved it into the
// LEFT column under the SMS history so the Coach can stay open beside it: "in
// that way he can have the coach always open as well." Nothing inside changed
// with the move; it is the same panel in a different column.
//
// Layout follows Tajul's NFStay BrrrrCallPanel, which Hugo pointed at as the
// shape he wants: property picker, the facts, then sold comps and rentals, then
// the questions. What it does NOT follow is his offer maths (GDV x 0.70, which
// produces offers above asking) — the figures here all come from the same
// offerRange() the dial cron uses. See api/lib/brrr-offer.ts.
//
// Only mounted when the dialer is on the property script, so nothing here is
// reachable from a plumber dial.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { gbpShort } from '../../../../../api/lib/brrr-offer';
import { usePropertyListings, type PropertyComp, type PropertyListing } from '../../hooks/usePropertyListings';

/** The 16 questions, mirroring QUALIFICATION_QUESTIONS in api/lib/brrr.ts so a
 *  human call and an AI call record the same facts under the same keys. */
const QUESTIONS: Array<{ key: string; label: string; only?: 'flat' | 'house' }> = [
  // The figure comes FIRST now. It was question 15 of 16, and on the first day
  // of real calls not one outcome was logged all day, so the only number any
  // branch gave (Alan Cooper, 140k) survived nowhere but in Pedro's head. It is
  // the reason the call happens, so it is the first thing on the card.
  { key: 'best_price_indicated', label: 'FIGURE THEY MENTIONED' },
  { key: 'offer_reaction', label: 'How did the offer land?' },
  { key: 'still_available', label: 'Still available?' },
  { key: 'occupancy', label: 'Vacant or tenanted?' },
  { key: 'condition_notes', label: 'Condition / works needed?' },
  { key: 'why_selling', label: 'Why are they selling?' },
  { key: 'interest_level', label: 'Viewings or offers so far?' },
  { key: 'fallen_through', label: 'Has a sale fallen through before?' },
  { key: 'motivation', label: 'How motivated?' },
  { key: 'chain', label: 'Onward chain?' },
  { key: 'tenure', label: 'Freehold or leasehold?' },
  { key: 'lease_years', label: 'Years left on the lease', only: 'flat' },
  { key: 'service_charge', label: 'Service charge', only: 'flat' },
  { key: 'ground_rent', label: 'Ground rent', only: 'flat' },
  { key: 'major_works', label: 'Major works / cladding', only: 'flat' },
  // We never view a property: our builder does, and he prices the refurb while
  // he is there. So the question is no longer "when can viewings happen" but
  // whether we got the video that lets the builder quote without driving.
  { key: 'video_walkthrough', label: 'Video walkthrough asked for?' },
  { key: 'branch_contact_name', label: 'Who did you speak to?' },
  { key: 'viewing_availability', label: 'Builder visit, easy to arrange?' },
];

/** The end states of a property call, in the order they are worth.
 *
 *  'figure_obtained' arrived 2026-08-10 with the script rewrite that has the
 *  agent negotiate on the call. It is the best outcome there is: the branch has
 *  said a number that would get it done and the deal is now on the director. It
 *  gets its own button, and its own pipeline stage, because filing it as plain
 *  Qualified hid the one thing Hugo actually has to act on.
 *
 *  'deciding' and 'follow_up' arrived 2026-08-11 at Hugo's request ("add more
 *  disposition option like deciding so its specific for me and follow up as
 *  well"). Deciding = the branch has our interest and is thinking it over;
 *  Follow up = warm, ring again. Each has its own board column (see the
 *  matching migration) so Hugo can watch them, and both flag a follow-up. */
const OUTCOMES: Array<{ key: string; label: string; cls: string }> = [
  { key: 'figure_obtained', label: 'Figure obtained', cls: 'bg-[#B8860B] hover:bg-[#a2760a]' },
  { key: 'qualified', label: 'Qualified', cls: 'bg-[#2E7D43] hover:bg-[#276b39]' },
  { key: 'deciding', label: 'Offer with vendor', cls: 'bg-[#7C5CBF] hover:bg-[#6a4ea8]' },
  { key: 'follow_up', label: 'Follow up', cls: 'bg-[#2F8F9D] hover:bg-[#297d8a]' },
  { key: 'callback', label: 'Call back', cls: 'bg-[#3C5A87] hover:bg-[#33507a]' },
  { key: 'not_qualified', label: 'Not for us', cls: 'bg-[#6B7280] hover:bg-[#5b626d]' },
  { key: 'no_answer', label: 'No answer', cls: 'bg-[#9CA3AF] hover:bg-[#8b919b]' },
];

interface Props {
  contactPhone?: string;
  selectedPropertyId: string | null;
  onSelectProperty: (id: string, listing: PropertyListing) => void;
  /** The live wk_calls id, so the outcome can be joined to the call later. */
  currentCallId?: string | null;
}

export default function PropertiesPane({
  contactPhone, selectedPropertyId, onSelectProperty, currentCallId,
}: Props) {
  const { listings, loading, error, refetch } = usePropertyListings(contactPhone);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selected = useMemo(
    () => listings.find((l) => l.id === selectedPropertyId) ?? listings[0] ?? null,
    [listings, selectedPropertyId],
  );

  // Auto-select the best deal as soon as the branch loads, so the offer strip
  // and the script are filled before the agent touches anything.
  useEffect(() => {
    if (!selectedPropertyId && listings.length > 0) {
      onSelectProperty(listings[0].id, listings[0]);
    }
  }, [listings, selectedPropertyId, onSelectProperty]);

  // A different property means a different set of answers.
  useEffect(() => {
    setAnswers({});
    setNote('');
    setSaved(null);
    setSaveError(null);
  }, [selected?.id]);

  // The most recent call anywhere on this branch, so a re-dealt office is
  // never opened cold. Hugo, 2026-08-13: "when call again crm should show
  // clear, when we last call them and for what property, do pedro knows
  // whats going on."
  //
  // TWO sources, merged, because each one alone has a hole. The listings RPC
  // carries last_call_at and the saved answers PER PROPERTY, but an outcome
  // pressed on a property that was later withdrawn or pruned leaves every
  // surviving listing blank (McDonald of Bispham, checked 2026-08-13: rung
  // twice, both listings said never-called). wk_calls is the authoritative
  // "did we ring this number" record, the same one the redial blacklist
  // reads, so the WHEN and the outcome come from there; the property and the
  // figure come from the RPC when a listing still carries them.
  const phoneKey = (contactPhone ?? '').replace(/\s+/g, '');
  const lastCallQ = useQuery({
    queryKey: ['branch-last-call', phoneKey, currentCallId ?? ''],
    enabled: phoneKey.length >= 9,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('wk_calls')
        .select('id, started_at, disposition_column_id, agent_note')
        .eq('to_e164', phoneKey)
        .eq('direction', 'outbound')
        .not('started_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(1);
      // The live call already has a wk_calls row; the banner is about the
      // time BEFORE this one.
      if (currentCallId) q = q.neq('id', currentCallId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const row = data?.[0];
      if (!row) return null;
      let outcome = '';
      if (row.disposition_column_id) {
        const { data: col } = await supabase
          .from('wk_pipeline_columns')
          .select('name')
          .eq('id', row.disposition_column_id)
          .maybeSingle();
        outcome = col?.name ?? '';
      }
      return {
        at: row.started_at as string,
        outcome,
        note: (row.agent_note ?? '').trim(),
      };
    },
  });

  const priorCall = useMemo(() => {
    const called = listings.filter((l) => l.last_call_at);
    const latest = called.length === 0 ? null
      : [...called].sort((a, b) =>
        String(b.last_call_at).localeCompare(String(a.last_call_at)))[0];
    const wk = lastCallQ.data ?? null;
    if (!wk && !latest) return null;
    const figure = latest
      ? String((latest.qualification as Record<string, unknown> | null)?.best_price_indicated ?? '').trim()
      : '';
    return {
      at: (wk?.at ?? latest?.last_call_at) as string,
      outcome: wk?.outcome ?? '',
      address: latest?.address ?? '',
      figure,
      note: (latest?.last_call_summary || wk?.note || '').trim(),
    };
  }, [listings, lastCallQ.data]);

  const isFlat = /flat|apartment|maisonette/i.test(selected?.property_type ?? '');
  const isHouse = !isFlat && !!selected?.property_type;
  const visibleQuestions = QUESTIONS.filter((q) =>
    !q.only || (q.only === 'flat' && !isHouse) || (q.only === 'house' && !isFlat),
  );

  async function submit(outcome: string) {
    if (!selected) return;
    setSaving(outcome);
    setSaveError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('not signed in');
      const res = await fetch('/api/crm/property-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          property_id: selected.id,
          outcome,
          qualification: answers,
          note,
          wk_call_id: currentCallId ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `failed (${res.status})`);
      setSaved(json.warning || (json.property_updated === false ? json.reason : 'Saved'));
      void refetch();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  if (!contactPhone) {
    return <Empty>No lead on screen.</Empty>;
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-[#9CA3AF]" />
      </div>
    );
  }
  if (error) {
    return <Empty>Could not load this branch: {error}</Empty>;
  }
  if (listings.length === 0) {
    return (
      <Empty>
        No properties on file for this number. It may have been imported as an
        ordinary lead rather than from the scraper.
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Branch header */}
      <div className="border-b border-[#E5E7EB] px-3 py-2">
        <div className="text-[12px] font-semibold text-[#1A1A1A]">
          {listings[0].agent_name || 'This branch'}
        </div>
        <div className="text-[11px] text-[#6B7280]">
          {listings[0].agent_phone} · {listings.length} listing{listings.length === 1 ? '' : 's'} on file
        </div>
      </div>

      {/* Spoken to before: what happened last time, before Pedro says a word */}
      {priorCall && (
        <div className="border-b border-[#F0DFB0] bg-[#FFF8EC] px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#8a6d1a]">
            You have spoken to this office before
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-[#5a4a20]">
            Last call {callAgo(priorCall.at)}
            {priorCall.outcome && <>, outcome <b>{priorCall.outcome}</b></>}
            {priorCall.address && <>, about <b>{priorCall.address}</b></>}.
            {priorCall.figure && <> They said: <b>{priorCall.figure}</b>.</>}
          </div>
          {priorCall.note && (
            <div className="mt-0.5 text-[11px] italic leading-snug text-[#5a4a20]">
              Your note: {priorCall.note}
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-[#8a6d1a]">
            Open by picking up where you left off, never as a cold call.
          </div>
        </div>
      )}

      {/* Property picker, only when there is a choice to make */}
      {listings.length > 1 && (
        <div className="border-b border-[#E5E7EB] px-3 py-2">
          <Label>Talking about</Label>
          <div className="mt-1 space-y-1">
            {listings.map((l) => (
              <button
                key={l.id}
                onClick={() => onSelectProperty(l.id, l)}
                className={`flex w-full items-baseline gap-2 rounded-md border px-2 py-1.5 text-left transition ${
                  l.id === selected?.id
                    ? 'border-[#3C5A87] bg-[#EEF2F8]'
                    : 'border-[#E5E7EB] hover:bg-[#FAFAF8]'
                }`}
              >
                <span className="flex-1 truncate text-[11.5px] text-[#1A1A1A]">{l.address}</span>
                {l.last_call_at && (
                  <span className="whitespace-nowrap rounded bg-[#FFF8EC] px-1 text-[10px] font-semibold text-[#8a6d1a]">
                    rung {callAgo(l.last_call_at)}
                  </span>
                )}
                <span className="whitespace-nowrap text-[11px] font-semibold text-[#2E7D43]">
                  {gbpShort(l.offerMin)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <>
          {/* Facts */}
          <div className="border-b border-[#E5E7EB] px-3 py-2 text-[11.5px] text-[#4B5563]">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {selected.bedrooms != null && <span>{selected.bedrooms} bed</span>}
              {selected.property_type && <span>{selected.property_type}</span>}
              {selected.days_on_market && <span>{selected.days_on_market} days listed</span>}
              <span>asking {selected.price_text || gbpShort(selected.asking_price)}</span>
            </div>
            {/* The whole strategy in one line: what it is worth once the kitchen
                becomes a bedroom, and what that conversion costs. Sits directly
                under "2 bed, Terraced, asking £124,950", which is the context
                that makes "as a 3 bed" mean anything. */}
            {selected.upliftValue > 0 && (
              <div className="mt-0.5 text-[11.5px] leading-snug text-[#4B5563]">
                as a {(selected.bedrooms ?? 0) + 1} bed:{' '}
                <b>{gbpShort(selected.upliftValue)}</b>
                {selected.upliftRefurbBudget > 0
                  ? <>, refurb about <b>{gbpShort(selected.upliftRefurbBudget)}</b></>
                  : null}
              </div>
            )}
            {selected.listing_url && (
              <a
                href={selected.listing_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[#3C5A87] hover:underline"
              >
                Open the listing <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {(selected.floorplan_urls ?? []).length > 0 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                {(selected.floorplan_urls ?? []).map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="flex-shrink-0">
                    <img
                      src={u}
                      alt="Floor plan"
                      className="h-20 w-auto rounded border border-[#E5E7EB] bg-white object-contain"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* The evidence behind the number.
              The engine sends these as objects, so they are grouped by what
              they prove: a sale at today's bed count is what the house is
              worth now, a sale at the target bed count is what it is worth
              once the conversion is done. Reading one out as the other is how
              an agent quotes a 5 bed price for a 3 bed house. */}
          {(selected.comps.length > 0 || selected.evidence.length > 0) && (
            <div className="border-b border-[#E5E7EB] px-3 py-2">
              <Label>Sold nearby, your evidence</Label>
              {selected.comps.length > 0 ? (
                <div className="mt-1 space-y-2">
                  <CompGroup
                    heading="Same size as it is now"
                    comps={selected.comps.filter((c) => c.when === 'today')}
                  />
                  <CompGroup
                    heading="The size it becomes after the conversion"
                    comps={selected.comps.filter((c) => c.when === 'after')}
                  />
                </div>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {selected.evidence.map((e) => (
                    <li key={e} className="text-[11.5px] leading-snug text-[#4B5563]">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {selected.flags.length > 0 && (
            <div className="border-b border-[#E5E7EB] bg-[#FDF9F0] px-3 py-2">
              <Label>Worth knowing</Label>
              <ul className="mt-1 space-y-0.5">
                {selected.flags.map((f) => (
                  <li key={f} className="text-[11.5px] leading-snug text-[#9A6B1E]">{f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* The checklist */}
          <div className="border-b border-[#E5E7EB] px-3 py-2">
            <Label>What you learned{isFlat ? ' (flat)' : isHouse ? ' (house)' : ''}</Label>
            <div className="mt-1.5 space-y-1.5">
              {visibleQuestions.map((q) => (
                <label key={q.key} className="block">
                  <span className="text-[10.5px] font-medium text-[#6B7280]">{q.label}</span>
                  <input
                    value={answers[q.key] ?? ''}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                    className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1 text-[12px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
                  />
                </label>
              ))}
              <label className="block">
                <span className="text-[10.5px] font-medium text-[#6B7280]">Anything else</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="mt-0.5 w-full resize-y rounded border border-[#E5E7EB] px-2 py-1 text-[12px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
                />
              </label>
            </div>
          </div>

          {/* Outcome */}
          <div className="px-3 py-2.5">
            <Label>How did it go</Label>
            <p className="mt-1 text-[10.5px] leading-snug text-[#9CA3AF]">
              Got a number out of them? Type it in the box at the top, then press
              Figure obtained. Whatever the number is, even miles above ours.
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  onClick={() => void submit(o.key)}
                  disabled={!!saving}
                  className={`rounded-md px-2 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50 ${o.cls}`}
                >
                  {saving === o.key ? 'Saving…'.replace('…', '...') : o.label}
                </button>
              ))}
            </div>
            {saved && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-[#2E7D43]">
                <Check className="mt-px h-3 w-3 flex-shrink-0" /> {saved}
              </div>
            )}
            {saveError && (
              <div className="mt-2 text-[11px] text-[#EF4444]">{saveError}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One block of sold comps under its own plain-English heading. Draws nothing
 *  when the engine found none of that kind, which is common: plenty of
 *  properties have same-size sales nearby and no converted ones. */
function CompGroup({ heading, comps }: { heading: string; comps: PropertyComp[] }) {
  if (comps.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-[#6B7280]">{heading}</div>
      <ul className="mt-0.5 space-y-0.5">
        {comps.map((c) => (
          <li key={`${c.text}${c.url}`} className="text-[11.5px] leading-snug text-[#4B5563] break-words">
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                {c.text}
              </a>
            ) : c.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "2h ago" / "3d ago" plus the actual date, so "a while back" never happens.
 *  UK time on purpose: it is when the office remembers being rung. */
function callAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const hours = Math.max(0, (Date.now() - t) / 3_600_000);
  const rel = hours < 24 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
  const abs = new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short',
  });
  return `${rel} (${abs})`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{children}</span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center text-[12px] leading-snug text-[#9CA3AF]">{children}</div>
  );
}
