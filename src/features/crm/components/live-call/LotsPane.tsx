// The Lots tab: every unsold lot we hold for the auction office on the phone
// (Auction desk, Hugo 2026-09-18).
//
// Hugo: "make sure everything from the auction, the pricing, the data, shows
// for him in the CRM when he calls, so he has enough data. The number, the
// property photos, the basics." So per lot: the auction facts, the photos, the
// size, the engine's value with the sold houses behind it, and one box to
// write down what the auctioneer said.
//
// One call covers every lot of this office on our list, so the picker is at the
// top and the selection drives the script's tokens (lifted into
// AuctionCallRoom, same pattern as the Houses tab).
//
// NOTHING HERE IS WORKED OUT IN THE BROWSER. Value, discount, tier and comps
// are read off what the VPS engine filed.

import { useState } from 'react';
import { ExternalLink, FileText, Gavel, ImageOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import { useBranchLastCall } from '../../hooks/useBranchLastCall';
import { gbp, guideText, spokenDate, useAuctionLots, type AuctionLot } from '../../hooks/useAuctionLots';

/** What Pedro can press. Mirrors OUTCOMES in api/crm/auction-outcome.ts. */
export const AUCTION_OUTCOMES = [
  { key: 'figure_given', label: 'Figure given', hint: 'goes to the director' },
  { key: 'call_back', label: 'Still available, call back' },
  { key: 'viewing_booked', label: 'Viewing booked' },
  { key: 'sold', label: 'Sold or under offer' },
  { key: 'not_suitable', label: 'Not suitable' },
  { key: 'no_answer', label: 'No answer' },
] as const;
export type AuctionOutcome = (typeof AUCTION_OUTCOMES)[number]['key'];

interface Props {
  contactPhone: string;
  selectedLotId: string | null;
  onSelectLot: (id: string) => void;
  currentCallId?: string | null;
}

export default function LotsPane({ contactPhone, selectedLotId, onSelectLot, currentCallId }: Props) {
  const { lots, loading, error, refetch } = useAuctionLots(contactPhone);
  const { lastCall } = useBranchLastCall(contactPhone, currentCallId ?? null);
  const selected = lots.find((l) => l.id === selectedLotId) ?? lots[0] ?? null;

  if (loading) return <div className="p-4 text-[12px] text-[#9CA3AF]">Loading lots...</div>;
  if (error) return <div className="p-4 text-[12px] text-[#B91C1C]">Could not load the lots: {error}</div>;
  if (lots.length === 0) {
    return <div className="p-4 text-[12px] text-[#9CA3AF]">No lots on file for this number.</div>;
  }

  const live = lots.filter((l) => !l.withdrawn);
  return (
    <div className="h-full overflow-y-auto" data-testid="auction-lots-pane">
      {lastCall && (
        <div className="mx-3 mt-3 rounded-[10px] border border-[#F0DFB0] bg-[#FFF8EC] px-3 py-2 text-[11.5px] text-[#5a4a20]" data-testid="office-last-call">
          <b>You have rung this office before</b>, {new Date(lastCall.at).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' })}
          {lastCall.outcome ? `, ${lastCall.outcome}` : ''}{lastCall.note ? `: ${lastCall.note}` : ''}
        </div>
      )}

      {/* The picker. Ask about every live lot on this one call. */}
      <div className="px-3 pt-3">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-1.5">
          {live.length} lot{live.length === 1 ? '' : 's'} to ask about{lots.length > live.length ? `, ${lots.length - live.length} gone` : ''}
        </div>
        <div className="space-y-1">
          {lots.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelectLot(l.id)}
              data-testid="auction-lot-pick"
              className={`w-full text-left rounded-[8px] border px-2.5 py-1.5 text-[12px] leading-snug transition-colors ${
                selected?.id === l.id ? 'border-[#1A1A1A] bg-[#F5F5F0]' : 'border-[#E5E7EB] hover:bg-[#FAFAF8]'
              } ${l.withdrawn ? 'opacity-50' : ''}`}
            >
              <span className="font-bold">Lot {l.auction.lot_number || '?'}</span>{' '}
              <span className="text-[#374151]">{l.address.split(',').slice(0, 2).join(',')}</span>
              {l.withdrawn && <span className="ml-1 text-[10px] font-bold text-[#B91C1C]">GONE</span>}
            </button>
          ))}
        </div>
      </div>

      {selected && <LotDetail lot={selected} currentCallId={currentCallId ?? null} onSaved={() => void refetch()} />}
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

function LotDetail({ lot, currentCallId, onSaved }: { lot: AuctionLot; currentCallId: string | null; onSaved: () => void }) {
  const a = lot.auction;
  const [figure, setFigure] = useState(String(lot.qualification.seller_figure ?? ''));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bigPhoto, setBigPhoto] = useState<string | null>(null);

  const size = lot.floorAreaSqm
    ? `${Math.round(lot.floorAreaSqm)} sqm${a.sqm_source === 'epc_register' ? ' (energy certificate)' : a.sqm_source === 'floor_plan' ? ' (floor plan)' : ''}`
    : '';

  async function save(outcome: AuctionOutcome) {
    setSaving(outcome);
    setSaved(null);
    setSaveError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('not signed in');
      const res = await fetch('/api/crm/auction-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ property_id: lot.id, outcome, seller_figure: figure, note, wk_call_id: currentCallId ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `failed (${res.status})`);
      setSaved(json.warning || 'Saved');
      setNote('');
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="px-3 py-3 space-y-3" data-testid="auction-lot-detail">
      {lot.withdrawn && (
        <div className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#991B1B]">
          <b>This lot has gone.</b> {lot.withdrawnWhy}
        </div>
      )}

      {/* Photos. Click one to see it large. */}
      {lot.photoUrls.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1" data-testid="auction-lot-photos">
          {lot.photoUrls.map((u) => (
            <button key={u} type="button" onClick={() => setBigPhoto(u)} className="flex-shrink-0">
              <img src={u} alt="" loading="lazy" className="h-[74px] w-[104px] rounded-[6px] object-cover border border-[#E5E7EB]" />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[11.5px] text-[#9CA3AF]"><ImageOff className="w-3.5 h-3.5" /> No photos published for this lot</div>
      )}
      {bigPhoto && (
        <div className="fixed inset-0 z-[300] bg-black/80 flex items-center justify-center p-6" onClick={() => setBigPhoto(null)}>
          <img src={bigPhoto} alt="" className="max-h-full max-w-full rounded-[8px]" />
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#1A1A1A]">
          <Gavel className="w-3.5 h-3.5" /> Lot {a.lot_number || '?'} · {lot.address}
        </div>
        <div className="mt-2 rounded-[10px] border border-[#E5E7EB] px-3 py-1">
          <Fact k="Auction" v={[a.house, a.office].filter(Boolean).join(', ')} />
          <Fact k="Sale date" v={a.auction_date ? `${spokenDate(a.auction_date)} (did not sell)` : ''} />
          <Fact k="Status now" v={a.status_text || a.status} />
          <Fact k="Guide" v={guideText(a)} strong />
          <Fact k="Post-auction" v={gbp(a.post_auction_price)} strong />
          <Fact k="Office" v={[a.office_phone, a.office_email].filter(Boolean).join(' · ')} />
          <Fact k="House" v={[lot.bedrooms ? `${lot.bedrooms} bed` : '', lot.propertyType].filter(Boolean).join(' ')} />
          <Fact k="Size" v={size} />
          <Fact k="Tenure" v={a.tenure} />
          <Fact k="Occupancy" v={a.occupancy === 'vacant' ? 'Vacant (says the advert)' : a.occupancy === 'tenanted' ? 'TENANTED' : 'Not stated, ask'} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {lot.lotUrl && (
            <a href={lot.lotUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[7px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] font-semibold text-[#1A1A1A] hover:bg-[#FAFAF8]">
              <ExternalLink className="w-3 h-3" /> Open the lot page
            </a>
          )}
          {a.legal_pack_url && (
            <a href={a.legal_pack_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[7px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] font-semibold text-[#1A1A1A] hover:bg-[#FAFAF8]">
              <FileText className="w-3 h-3" /> Legal pack
            </a>
          )}
          {lot.floorplanUrls[0] && (
            <a href={lot.floorplanUrls[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-[7px] border border-[#E5E7EB] px-2 py-1 text-[11.5px] font-semibold text-[#1A1A1A] hover:bg-[#FAFAF8]">
              <FileText className="w-3 h-3" /> Floor plan
            </a>
          )}
        </div>
      </div>

      {/* Why it is worth the call. For Pedro only, never said aloud. */}
      <div className="rounded-[10px] border border-[#D8E2EE] bg-[#F6F8FB] px-3 py-2" data-testid="auction-lot-value">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#7D93B0]">Why we are calling (never say these figures)</div>
        <div className="mt-1 text-[12.5px] text-[#1A1A1A]">
          Similar houses nearby say it is worth about <b>{gbp(lot.value)}</b>
          {a.price_to_beat ? <> and the seller was holding out for up to <b>{gbp(a.price_to_beat)}</b></> : null}
          {lot.discount != null ? <>, so it is <b>{Math.round(lot.discount * 100)}% under</b></> : null}.
        </div>
        {lot.tier && <div className="mt-0.5 text-[11px] text-[#6B7F96]">Evidence: {lot.tier} ({lot.valueNote})</div>}
        {lot.evidence.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-[#4A5B6E] list-disc pl-4" data-testid="auction-lot-comps">
            {lot.evidence.map((s) => <li key={s}>{s}</li>)}
          </ul>
        )}
      </div>

      {/* What the auctioneer said. */}
      <div className="rounded-[10px] border border-[#E5E7EB] px-3 py-2.5 space-y-2" data-testid="auction-lot-outcome">
        <div className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF]">What they said</div>
        <input
          value={figure}
          onChange={(e) => setFigure(e.target.value)}
          placeholder="The seller's figure, exactly as they said it"
          className="w-full rounded-[7px] border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Vacant? Offers in? How they sell it now, deadline, fees, viewing day, who you spoke to"
          rows={3}
          className="w-full rounded-[7px] border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]"
        />
        <div className="flex flex-wrap gap-1.5">
          {AUCTION_OUTCOMES.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={saving !== null}
              onClick={() => void save(o.key)}
              data-testid={`auction-outcome-${o.key}`}
              className={`rounded-[7px] px-2.5 py-1.5 text-[11.5px] font-bold transition-colors ${
                o.key === 'figure_given' ? 'bg-[#1A1A1A] text-white hover:bg-black' : 'border border-[#E5E7EB] text-[#1A1A1A] hover:bg-[#FAFAF8]'
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
