// The Flat tab: the rental Pedro is ringing a letting agent about, on the
// Serviced Accommodation desk (Hugo, 2026-09-23).
//
// One agency, one flat at a time (scripts/lib/sa-listings.mjs), so this is the
// flat, its photos and facts, what happened last time this agency was rung,
// and the outcome buttons.
//
// WE ARE THE MIDDLEMAN. Hugo: "we're gonna find the agent that'll say yes ...
// agent or landlord to say yes, doesn't matter. And then after that, we're
// gonna find a service accommodation company that will rent from the
// landlord." So the win is a YES IN PRINCIPLE from whoever can give it, and it
// goes to Hugo. Nothing here agrees a rent, a start date or a contract.

import { useState } from 'react';
import { BedDouble, ExternalLink, Home, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { availableText, gbpMonth, useSaListings, type SaListing } from '../../hooks/useSaListings';

/** What Pedro can press. Mirrors OUTCOMES in api/crm/sa-outcome.ts. */
export const SA_OUTCOMES = [
  { key: 'yes_in_principle', label: 'Yes in principle', hint: 'goes to Hugo' },
  { key: 'checking_with_landlord', label: 'Checking with the landlord' },
  { key: 'said_no', label: 'Said no' },
  { key: 'no_company_lets', label: 'Never do company lets' },
  { key: 'already_let', label: 'Already let' },
  { key: 'no_answer', label: 'No answer' },
] as const;
export type SaOutcome = (typeof SA_OUTCOMES)[number]['key'];

export const SA_OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  SA_OUTCOMES.map((o) => [o.key, o.label]),
);

interface Props {
  contactId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  currentCallId?: string | null;
}

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';

export default function SaListingPane({ contactId, selectedId, onSelect, currentCallId }: Props) {
  const { listings, loading, error, refetch } = useSaListings(contactId);
  const selected = listings.find((l) => l.id === selectedId) ?? listings[0] ?? null;

  if (loading) return <div className="p-4 text-[12px] text-[#9CA3AF]">Loading the flat...</div>;
  if (error) return <div className="p-4 text-[12px] text-[#B91C1C]">Could not load the flat: {error}</div>;
  if (listings.length === 0) {
    return <div className="p-4 text-[12px] text-[#9CA3AF]">No flat on file for this agency.</div>;
  }

  // Earlier flats from this agency, with what they said. The newest is the one
  // on the call; the rest are history.
  const earlier = listings.filter((l) => l.id !== selected?.id && l.outcome);
  return (
    <div className="h-full overflow-y-auto" data-testid="sa-listing-pane">
      {earlier.length > 0 && (
        <div className="mx-3 mt-3 rounded-[10px] border border-[#F0DFB0] bg-[#FFF8EC] px-3 py-2 text-[11.5px] text-[#5a4a20]" data-testid="sa-agency-history">
          <b>You have rung this agency before.</b>
          {earlier.slice(0, 3).map((l) => (
            <div key={l.id} className="mt-0.5">
              {shortDate(l.outcomeAt ?? l.dealtAt)}, {l.address.split(',')[0]}: {SA_OUTCOME_LABEL[l.outcome ?? ''] ?? l.outcome}
              {l.outcomeNote ? `, ${l.outcomeNote}` : ''}
            </div>
          ))}
        </div>
      )}

      {listings.length > 1 && (
        <div className="px-3 pt-3 space-y-1">
          {listings.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelect(l.id)}
              className={`w-full text-left rounded-[8px] border px-2.5 py-1.5 text-[12px] leading-snug ${
                selected?.id === l.id ? 'border-[#1A1A1A] bg-[#F5F5F0]' : 'border-[#E5E7EB] hover:bg-[#FAFAF8]'
              }`}
            >
              <span className="font-bold">{l.bedrooms} bed</span>{' '}
              <span className="text-[#374151]">{l.address.split(',').slice(0, 2).join(',')}</span>
              <span className="ml-1 text-[10.5px] text-[#9CA3AF]">{shortDate(l.dealtAt)}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SaListingDetail
          key={selected.id}
          listing={selected}
          currentCallId={currentCallId ?? null}
          onSaved={() => void refetch()}
        />
      )}
    </div>
  );
}

function Fact({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  if (v === '' || v == null) return null;
  return (
    <div className="flex gap-2 py-1 border-b border-[#F3F4F6] last:border-0">
      <div className="w-[108px] flex-shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-[#9CA3AF] pt-0.5">{k}</div>
      <div className={`text-[12.5px] ${strong ? 'font-bold text-[#1A1A1A]' : 'text-[#374151]'}`}>{v}</div>
    </div>
  );
}

function SaListingDetail({ listing: l, currentCallId, onSaved }: { listing: SaListing; currentCallId: string | null; onSaved: () => void }) {
  const [person, setPerson] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bigPhoto, setBigPhoto] = useState<string | null>(null);

  async function save(outcome: SaOutcome) {
    setSaving(outcome);
    setSaved(null);
    setSaveError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('not signed in');
      const res = await fetch('/api/crm/sa-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ listing_id: l.id, outcome, person, note, wk_call_id: currentCallId ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `failed (${res.status})`);
      setSaved(json.board_warning || (outcome === 'yes_in_principle' ? 'Saved and sent to Hugo' : 'Saved'));
      setNote('');
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  const listed = l.firstListedAt ? `${shortDate(l.firstListedAt)}` : '';
  return (
    <div className="px-3 py-3 space-y-3" data-testid="sa-listing-detail">
      {l.photoUrls.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="sa-listing-photos">
          {l.photoUrls.map((u) => (
            <button key={u} type="button" onClick={() => setBigPhoto(u)} className="flex-shrink-0">
              <img src={u} alt="" loading="lazy" className="h-[74px] w-[104px] rounded-[6px] object-cover border border-[#E5E7EB]" />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11.5px] text-[#9CA3AF]"><ImageOff className="w-3.5 h-3.5" /> No photos on the listing</div>
      )}
      {bigPhoto && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6" onClick={() => setBigPhoto(null)}>
          <img src={bigPhoto} alt="" className="max-h-full max-w-full rounded-[8px]" />
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#1A1A1A]">
          <Home className="w-3.5 h-3.5" /> {l.address}
        </div>
        <div className="mt-2 rounded-[10px] border border-[#E5E7EB] px-3 py-1">
          <Fact k="Rent" v={gbpMonth(l.rentPcm)} strong />
          <Fact
            k="The flat"
            v={
              <span className="inline-flex items-center gap-1">
                <BedDouble className="w-3.5 h-3.5 text-[#9CA3AF]" />
                {[l.bedrooms ? `${l.bedrooms} bed` : '', l.bathrooms ? `${l.bathrooms} bath` : '', l.propertyType].filter(Boolean).join(', ')}
              </span>
            }
          />
          <Fact k="City" v={[l.city, l.outcode].filter(Boolean).join(', ')} />
          <Fact k="Available" v={availableText(l.letAvailableDate)} />
          <Fact k="Listed" v={listed} />
          <Fact k="Agency" v={l.agency} />
        </div>
        {l.summary && <p className="mt-2 text-[11.5px] leading-snug text-[#6B7280]">{l.summary}</p>}
        {l.listingUrl && (
          <a href={l.listingUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-[7px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] font-semibold text-[#1A1A1A] hover:bg-[#FAFAF8]">
            <ExternalLink className="w-3 h-3" /> Open the listing
          </a>
        )}
      </div>

      {l.outcome && (
        <div className="rounded-[8px] border border-[#E5E7EB] bg-[#FAFAF8] px-3 py-2 text-[11.5px] text-[#374151]">
          Last answer on this flat: <b>{SA_OUTCOME_LABEL[l.outcome] ?? l.outcome}</b>
          {l.outcomeNote ? `, ${l.outcomeNote}` : ''}
        </div>
      )}

      <div className="rounded-[10px] border border-[#E5E7EB] px-3 py-2.5 space-y-2" data-testid="sa-listing-outcome">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">What they said</div>
        <input
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="Who you spoke to (name, and agent or landlord)"
          data-testid="sa-outcome-person"
          className="w-full rounded-[7px] border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What they said: yes in principle? any conditions (lease, building, mortgage)? when to ring back?"
          rows={3}
          data-testid="sa-outcome-note"
          className="w-full rounded-[7px] border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
        />
        <div className="flex flex-wrap gap-1.5">
          {SA_OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={saving !== null}
              onClick={() => void save(o.key)}
              data-testid={`sa-outcome-${o.key}`}
              className={`rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-bold transition-colors ${
                o.key === 'yes_in_principle' ? 'bg-[#1A1A1A] text-white hover:bg-black' : 'border border-[#E5E7EB] text-[#1A1A1A] hover:bg-[#FAFAF8]'
              } disabled:opacity-50`}
            >
              {saving === o.key ? 'Saving...' : o.label}
            </button>
          ))}
        </div>
        {saved && <div className="text-[11.5px] text-[#166534]">{saved}</div>}
        {saveError && <div className="text-[11.5px] text-[#B91C1C]">{saveError}</div>}
      </div>
    </div>
  );
}
