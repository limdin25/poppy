// The refurb estimator. Pick the house, let two AIs look at it, confirm every
// part of it yourself, then price only what you confirmed.
//
// Hugo, 2026-08-25, upgrading this screen:
//
//   "The estimator should analyse each property using property/listing
//   information already available in the CRM, property photos from the listing,
//   the agent's phone conversation, and any additional photos uploaded by the
//   agent. For every area of the property show the relevant property photo
//   directly beside that section. NEVER invent work. If there is no clearly
//   necessary work, the result must simply say Nothing to do. Every item must
//   require agent confirmation, even if the information came directly from the
//   listing or AI. This estimator is designed to prevent over-estimation."
//
// SO THE SCREEN IS A CONFIRMATION SCREEN, NOT A SUGGESTION SCREEN. The counter
// at the top counts CONFIRMED parts of the property, not filled-in ones, and
// the Generate button will not price a single line out of a part nobody has
// pressed a button on. An AI answer sitting on screen is worth exactly nothing
// until a human agrees with it, which is the difference between this and a
// machine that quietly decides how much of Hugo's money to spend.
//
// The three things a section can be:
//   Nothing to do      the answer this whole feature exists to make possible
//   Work needed        priced, but only the lines that are ticked
//   Needs a look       flagged for the builder, never priced
//
// The rate card, the arithmetic and the builder's message live in
// ../lib/refurbCard.ts. The two-reader merge lives in ../lib/refurbAssessment.ts.
// This file is the screen and nothing else.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Camera, Check, ChevronDown, ChevronRight, ClipboardCopy, Eye,
  HardHat, Home, Loader2, Mic, Plus, PoundSterling, Search, Square, Trash2, X,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useDictation } from '../lib/useDictation';
import { CARD, SECTIONS, gbp, type Estimate, type LineKey } from '../lib/refurbCard';
import {
  blankAreas, confirmedCount, verdictOf,
  type AreaAssessment, type AreaVerdict, type AreaWork,
} from '../lib/refurbAssessment';

interface HouseOption {
  id: string;
  address: string | null;
  viewingAddress: string | null;
  viewingAt: string | null;
  bedrooms: number | null;
  propertyType: string | null;
  askingPrice: number | null;
  priceText: string | null;
  listingUrl: string | null;
  analysedAt: string | null;
}

interface ListingPhoto { url: string; thumb: string; caption: string | null }
interface Listing {
  photos: ListingPhoto[];
  floorplans: string[];
  keyFeatures: string[];
  description: string;
  bedrooms: number | null;
  bathrooms: number | null;
  propertySubType: string | null;
  tenure: string | null;
  floorAreaSqm: number | null;
}
interface HouseView {
  id: string;
  address: string | null;
  viewingAddress: string | null;
  viewingAt: string | null;
  listingUrl: string | null;
  askingPrice: number | null;
  priceText: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  tenure: string | null;
  floorAreaSqm: number | null;
  listingFloorAreaSqm: number | null;
  floorplans: string[];
}
interface AnalysisMeta {
  readers?: { id: string; model: string }[];
  failed?: string[];
  band?: string | null;
  summary?: string | null;
  unknowns?: string[];
  photos?: number;
  usedCall?: boolean;
}
interface LoadedHouse {
  house: HouseView;
  listing: Listing | null;
  call: { facts: string; transcript: string; calls: number };
  areas: AreaAssessment[];
  analysedAt: string | null;
  analysisMeta: AnalysisMeta | null;
  confirmedAddress: string | null;
  confirmedSqm: number | null;
  areaConfirmed: boolean;
}
interface BuilderAsk { label: string; detail: string; where: string }
interface PriceResult {
  estimate: Estimate;
  toConfirm: BuilderAsk[];
  toInspect: BuilderAsk[];
  nothingToDo: string[];
  unconfirmed: string[];
  brief: string;
}

const VERDICT_UI: Record<AreaVerdict, { label: string; cls: string; dot: string }> = {
  unknown: { label: 'Not looked at', cls: 'bg-[#F3F4F6] text-[#6B7280]', dot: 'bg-[#D1D5DB]' },
  nothing: { label: 'Nothing to do', cls: 'bg-[#DCFCE7] text-[#166534]', dot: 'bg-[#22C55E]' },
  work: { label: 'Work needed', cls: 'bg-[#FEF3C7] text-[#B45309]', dot: 'bg-[#F59E0B]' },
  inspect: { label: 'Needs a look', cls: 'bg-[#DBEAFE] text-[#1D4ED8]', dot: 'bg-[#3B82F6]' },
};

const BASIS_LABEL: Record<string, string> = {
  photo: 'seen in a photo',
  listing: 'stated on the advert',
  agent: 'told to us',
  none: 'no evidence',
};

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error('You are not signed in. Refresh the page and try again.');
  const res = await fetch('/api/crm/refurb-estimate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  // Read as text first: a long read can hit a gateway timeout, which answers
  // HTML, and JSON.parse turns that into a baffling "Unexpected token A".
  const raw = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(raw) as Record<string, unknown>; }
  catch {
    throw new Error(res.status === 504 || res.status === 502
      ? 'That took too long to come back. Nothing you confirmed is lost, it is all still on this page. Press the button again.'
      : `The server had a problem (HTTP ${res.status}). Nothing you confirmed is lost. Try again.`);
  }
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json as T;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-testid="copy-button"
      onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
        done ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#3C5A87] text-white hover:bg-[#324D74]',
      )}
    >
      {done ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
      {done ? 'Copied' : label}
    </button>
  );
}

function Thumb({ photo, size = 'h-24 w-32' }: { photo: ListingPhoto; size?: string }) {
  return (
    <a href={photo.url} target="_blank" rel="noreferrer" className="block flex-shrink-0">
      <img
        src={photo.thumb}
        alt={photo.caption ?? 'Property photo'}
        loading="lazy"
        className={cn('rounded-lg border border-[#E5E7EB] object-cover', size)}
      />
    </a>
  );
}

const ukTime = (iso: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/London',
    });
  } catch { return ''; }
};

export default function RefurbEstimatorPage() {
  const [params, setParams] = useSearchParams();
  const dictation = useDictation();

  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [housesError, setHousesError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState(params.get('property') ?? '');

  const [loaded, setLoaded] = useState<LoadedHouse | null>(null);
  const [areas, setAreas] = useState<AreaAssessment[]>(blankAreas());
  const [sqm, setSqm] = useState('');
  const [address, setAddress] = useState('');
  const [sizeConfirmed, setSizeConfirmed] = useState(false);
  /** The last thing the server accepted. "Saved" is this compared against what
   *  is on screen, never a flag, so a failed save cannot report success. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);

  const [analysing, setAnalysing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PriceResult | null>(null);
  const [anchor, setAnchor] = useState(true);
  const [showAdvert, setShowAdvert] = useState(false);
  const [showCall, setShowCall] = useState(false);

  // ---- the dropdown ----------------------------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const r = await post<{ houses: HouseOption[] }>({ action: 'houses' });
        setHouses(r.houses);
      } catch (e) {
        setHousesError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // ---- open a house ----------------------------------------------------
  //
  // "Loading" is DERIVED, not a flag. A flag would have to be raised
  // synchronously inside the effect, which is a cascading render, and it can
  // also get stuck on if a request is superseded. Comparing what is loaded
  // against what is selected cannot get stuck.
  const loading = Boolean(propertyId) && loaded?.house.id !== propertyId && !error;

  useEffect(() => {
    if (!propertyId) return;
    // A second selection while the first is still in flight must not have its
    // answer land on top of the newer one.
    let live = true;
    void (async () => {
      try {
        const r = await post<LoadedHouse>({ action: 'load', propertyId });
        if (!live) return;
        setLoaded(r);
        setAreas(r.areas?.length ? r.areas : blankAreas());
        setAddress(r.confirmedAddress ?? r.house.viewingAddress ?? r.house.address ?? '');
        const size = r.confirmedSqm ?? r.house.floorAreaSqm ?? r.house.listingFloorAreaSqm;
        setSqm(size ? String(size) : '');
        setSizeConfirmed(Boolean(r.areaConfirmed));
        setSavedSnapshot(null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, [propertyId]);

  /** Switching house is an event, so the clear-down happens here rather than in
   *  an effect. It also has to happen BEFORE the new one arrives, or the old
   *  house's confirmations are on screen against the new house's address. */
  const chooseHouse = useCallback((id: string) => {
    dictation.stop();
    setPropertyId(id);
    setLoaded(null);
    setAreas(blankAreas());
    setResult(null);
    setError(null);
    setSavedSnapshot(null);
    setAddress('');
    setSqm('');
    setSizeConfirmed(false);
    // dictation is a hook object rebuilt on every render; depending on it would
    // rebuild this callback constantly, which is the shape of the bug in
    // project_crm_hydration_loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- save, quietly, after he stops typing ----------------------------
  const snapshot = useMemo(
    () => JSON.stringify({ areas, address, sqm, sizeConfirmed }),
    [areas, address, sqm, sizeConfirmed],
  );
  const saved = snapshot === savedSnapshot;
  useEffect(() => {
    if (!loaded || saved) return;
    const t = setTimeout(() => {
      void post({
        action: 'save', propertyId: loaded.house.id, areas,
        address, floorAreaSqm: sqm ? Number(sqm) : null, areaConfirmed: sizeConfirmed,
      }).then(() => setSavedSnapshot(snapshot))
        .catch(() => { /* the page still works, it just keeps saying Saving */ });
    }, 1200);
    return () => clearTimeout(t);
  }, [snapshot, saved, loaded, areas, address, sqm, sizeConfirmed]);

  // ---- editing one area ------------------------------------------------
  const patch = useCallback((id: string, fn: (a: AreaAssessment) => AreaAssessment) => {
    setAreas((prev) => prev.map((a) => (a.id === id ? fn(a) : a)));
  }, []);

  const appendNote = useCallback((id: string, words: string) => {
    if (!words) return;
    patch(id, (a) => ({ ...a, agentNote: a.agentNote ? `${a.agentNote} ${words}` : words }));
  }, [patch]);

  const analyse = useCallback(async () => {
    if (!loaded) return;
    dictation.stop();
    setAnalysing(true); setError(null); setResult(null);
    try {
      const r = await post<{ areas: AreaAssessment[]; analysisMeta: AnalysisMeta; analysedAt: string; listing: Listing | null }>({
        action: 'analyse', propertyId: loaded.house.id, areas,
      });
      setAreas(r.areas);
      setLoaded((l) => (l ? { ...l, analysisMeta: r.analysisMeta, analysedAt: r.analysedAt, listing: r.listing ?? l.listing } : l));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalysing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, areas]);

  const generate = useCallback(async () => {
    if (!loaded) return;
    dictation.stop();
    setPricing(true); setError(null);
    try {
      const r = await post<PriceResult>({
        action: 'price', propertyId: loaded.house.id, areas, address,
        floorAreaSqm: sqm ? Number(sqm) : null, includeBudget: anchor,
      });
      setResult(r);
      setTimeout(() => document.getElementById('estimate-result')?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPricing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, areas, address, sqm, anchor]);

  const done = confirmedCount(areas);
  const analysed = Boolean(loaded?.analysedAt);
  const photos = loaded?.listing?.photos ?? [];

  // ---- the screen ------------------------------------------------------
  return (
    <div className="h-full overflow-y-auto bg-[#F7F8FA]">
      <div className="mx-auto w-full max-w-4xl px-4 py-6">

        {/* ---- what to do ---- */}
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#EEF2F8] p-2.5"><Home className="h-5 w-5 text-[#3C5A87]" /></div>
            <div>
              <h1 className="text-[18px] font-bold text-[#1A1A1A]">Price up a refurb</h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6B7280]">
                Pick the house you are going to see. The page pulls the advert, the photos
                and what the estate agent said on the phone, then two separate AIs look at
                it and only agree on what they can both actually see.
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6B7280]">
                Then you go through every part of the property and say yes or no. Nothing is
                priced until you have. If a kitchen is old but fine, the answer is
                <strong className="text-[#166534]"> Nothing to do</strong>, and that is a
                right answer, not a lazy one. We are letting it, not moving into it.
              </p>
            </div>
          </div>
        </div>

        {/* ---- pick the house ---- */}
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5">
          <label className="mb-1.5 block text-[12px] font-semibold text-[#374151]">
            Which property? <span className="font-normal text-[#9CA3AF]">(the ones booked in for a viewing)</span>
          </label>
          <select
            data-testid="estimator-property"
            value={propertyId}
            onChange={(e) => {
              chooseHouse(e.target.value);
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('property', e.target.value); else next.delete('property');
              setParams(next, { replace: true });
            }}
            className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3C5A87]"
          >
            <option value="">Choose a property</option>
            {houses.map((hh) => (
              <option key={hh.id} value={hh.id}>
                {hh.viewingAddress || hh.address || 'Unnamed property'}
                {hh.viewingAt ? ` — ${ukTime(hh.viewingAt)}` : ''}
                {hh.analysedAt ? ' (started)' : ''}
              </option>
            ))}
          </select>
          {housesError && (
            <p className="mt-2 text-[12px] text-[#B91C1C]">{housesError}</p>
          )}
          {!housesError && !houses.length && (
            <p className="mt-2 text-[12px] text-[#9CA3AF]">
              No properties are booked in for a viewing yet. Book one on the pipeline and it
              will appear here.
            </p>
          )}
        </div>

        {loading && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white p-5 text-[13px] text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" /> Pulling the advert and the photos.
          </div>
        )}

        {loaded && !loading && (
          <>
            {/* ---- the property ---- */}
            <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5" data-testid="house-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-bold text-[#1A1A1A]">
                    {loaded.house.viewingAddress || loaded.house.address || 'This property'}
                  </h2>
                  <p className="mt-1 text-[12.5px] text-[#6B7280]">
                    {[
                      loaded.house.propertyType,
                      loaded.house.bedrooms ? `${loaded.house.bedrooms} bed` : null,
                      loaded.house.bathrooms ? `${loaded.house.bathrooms} bath` : null,
                      loaded.house.tenure,
                      loaded.house.priceText || (loaded.house.askingPrice ? gbp(loaded.house.askingPrice) : null),
                      loaded.house.viewingAt ? `viewing ${ukTime(loaded.house.viewingAt)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {loaded.house.listingUrl && (
                  <a
                    href={loaded.house.listingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#EEF2F8] px-3 py-2 text-[12.5px] font-semibold text-[#3C5A87]"
                  >
                    <Search className="h-3.5 w-3.5" /> Open the advert
                  </a>
                )}
              </div>

              {/* address and size, both of which he has to agree with */}
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <label className="mb-1 block text-[12px] font-semibold text-[#374151]">
                    Address on the quote
                  </label>
                  <input
                    data-testid="estimator-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3C5A87]"
                  />
                </div>
                <div className="sm:w-56">
                  <label className="mb-1 block text-[12px] font-semibold text-[#374151]">Size in sq m</label>
                  <input
                    data-testid="estimator-sqm"
                    value={sqm}
                    onChange={(e) => { setSqm(e.target.value.replace(/[^\d.]/g, '')); setSizeConfirmed(false); }}
                    inputMode="decimal"
                    placeholder="88"
                    className="w-full rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#3C5A87]"
                  />
                </div>
              </div>
              {/* The advert's own figure is not a fact until he agrees with it. */}
              <label className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-[#374151]">
                <input
                  type="checkbox"
                  data-testid="size-confirmed"
                  checked={sizeConfirmed}
                  onChange={(e) => setSizeConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#3C5A87]"
                />
                <span>
                  I have checked the size and the address are right.
                  {loaded.house.listingFloorAreaSqm
                    ? ` The advert says ${Math.round(loaded.house.listingFloorAreaSqm)} square metres.`
                    : ' The advert does not give a size, so this is priced as a typical 88 square metre terrace unless you put one in.'}
                </span>
              </label>

              {/* key features and the blurb */}
              {loaded.listing?.keyFeatures.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {loaded.listing.keyFeatures.map((k) => (
                    <li key={k} className="rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[11.5px] text-[#374151]">{k}</li>
                  ))}
                </ul>
              ) : null}

              {loaded.listing?.description ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvert((v) => !v)}
                    className="flex items-center gap-1 text-[12.5px] font-semibold text-[#3C5A87]"
                  >
                    {showAdvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    What the advert says
                  </button>
                  {showAdvert && (
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#F9FAFB] p-3 text-[12.5px] leading-relaxed text-[#374151]">
                      {loaded.listing.description}
                    </p>
                  )}
                </div>
              ) : null}

              {(loaded.call.facts || loaded.call.transcript) && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowCall((v) => !v)}
                    className="flex items-center gap-1 text-[12.5px] font-semibold text-[#3C5A87]"
                  >
                    {showCall ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    What the estate agent told us on the phone
                  </button>
                  {showCall && (
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-[#F9FAFB] p-3 font-sans text-[12px] leading-relaxed text-[#374151]">
                      {[loaded.call.facts, loaded.call.transcript].filter(Boolean).join('\n\n')}
                    </pre>
                  )}
                </div>
              )}

              {/* every photo, once, at the top */}
              {photos.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                    All {photos.length} photos from the advert
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {photos.map((p, i) => (
                      <div key={p.url} className="relative">
                        <Thumb photo={p} size="h-20 w-28" />
                        <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{i}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {loaded.house.floorplans.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Floor plan</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {loaded.house.floorplans.map((f) => (
                      <Thumb key={f} photo={{ url: f, thumb: f, caption: 'Floor plan' }} size="h-24 w-32" />
                    ))}
                  </div>
                </div>
              )}
              {!photos.length && (
                <p className="mt-3 rounded-lg bg-[#FFFBEB] px-3 py-2 text-[12px] leading-relaxed text-[#78350F]">
                  No photos could be pulled off the advert for this one, so every part of the
                  property will come back as needing a look. Open the advert yourself, say what
                  you can see in the boxes below, then run the reading.
                </p>
              )}
            </div>

            {/* ---- run the readers ---- */}
            <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[14px] font-bold text-[#1A1A1A]">
                    {analysed ? 'Read again' : 'Have it read'}
                  </h2>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#6B7280]">
                    Two AIs look at the photos, the advert and the call separately. Only what
                    they BOTH see gets priced. Anything one of them saw on its own goes to the
                    builder to confirm.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="estimator-analyse"
                  disabled={analysing}
                  onClick={() => void analyse()}
                  className="flex items-center gap-2 rounded-xl bg-[#3C5A87] px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-[#324D74] disabled:cursor-not-allowed disabled:bg-[#C7CDD6]"
                >
                  {analysing
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Looking at it</>
                    : <><Eye className="h-4 w-4" /> {analysed ? 'Read it again' : 'Read the property'}</>}
                </button>
              </div>
              {analysing && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-[#6B7280]">
                  This takes a minute or so. Leave the page open, nothing you have already
                  confirmed can be lost.
                </p>
              )}
              {loaded.analysisMeta && !analysing && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-[#9CA3AF]" data-testid="analysis-meta">
                  Read by {loaded.analysisMeta.readers?.map((r) => r.id).join(' and ') || 'one reader'}
                  {loaded.analysisMeta.readers && loaded.analysisMeta.readers.length < 2
                    ? '. Only one reader answered, so nothing is marked as agreed and every line needs the builder to confirm it.'
                    : '.'}
                  {loaded.analysisMeta.photos ? ` ${loaded.analysisMeta.photos} photos.` : ' No photos.'}
                  {loaded.analysisMeta.usedCall ? ' The phone call was used.' : ' There was no call to read.'}
                  {loaded.analysisMeta.band ? ` Overall: ${loaded.analysisMeta.band.replace(/_/g, ' ')}.` : ''}
                </p>
              )}
              {loaded.analysisMeta?.summary && !analysing && (
                <p className="mt-2 rounded-xl bg-[#F9FAFB] p-3 text-[12.5px] leading-relaxed text-[#374151]">
                  {loaded.analysisMeta.summary}
                </p>
              )}
            </div>

            {/* ---- the counter. Confirmed, not filled in. ---- */}
            <div className="sticky top-0 z-10 mt-3 rounded-2xl border border-[#E5E7EB] bg-white/95 p-4 backdrop-blur">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold text-[#1A1A1A]">
                  <span data-testid="sections-done">{done}</span> of {SECTIONS.length} parts of the property confirmed
                </span>
                <span className={cn('font-medium', done < SECTIONS.length ? 'text-[#B45309]' : 'text-[#166534]')}>
                  {done < SECTIONS.length ? `${SECTIONS.length - done} still to confirm` : 'All confirmed'}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#F3F4F6]">
                <div
                  className="h-full rounded-full bg-[#3C5A87] transition-all duration-300"
                  style={{ width: `${(done / SECTIONS.length) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-[#9CA3AF]">
                {saved ? 'Saved.' : 'Saving...'} Only confirmed parts get priced.
              </p>
            </div>

            {dictation.error && (
              <div className="mt-3 flex gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#DC2626]" />
                <p className="text-[12.5px] leading-relaxed text-[#991B1B]">{dictation.error}</p>
              </div>
            )}

            {/* ---- one card per part of the property ---- */}
            <div className="mt-3 space-y-3">
              {areas.map((area) => (
                <AreaCard
                  key={area.id}
                  area={area}
                  photos={photos}
                  recording={dictation.activeId === area.id}
                  interim={dictation.interim}
                  micSupported={dictation.supported}
                  onMic={() => (dictation.activeId === area.id
                    ? dictation.stop()
                    : dictation.start(area.id, (w) => appendNote(area.id, w)))}
                  onPatch={(fn) => patch(area.id, fn)}
                />
              ))}
            </div>

            {/* ---- generate ---- */}
            <div className="mt-4">
              <button
                type="button"
                data-testid="estimator-generate"
                disabled={pricing || done === 0}
                onClick={() => void generate()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3C5A87] py-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#324D74] disabled:cursor-not-allowed disabled:bg-[#C7CDD6]"
              >
                {pricing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Working it out</>
                  : <><PoundSterling className="h-4 w-4" /> Generate the costs and the builder message</>}
              </button>
              {done === 0 && (
                <p className="mt-2 text-center text-[11.5px] text-[#9CA3AF]">
                  Confirm at least one part of the property first.
                </p>
              )}
              {done > 0 && done < SECTIONS.length && !pricing && (
                <p className="mt-2 text-center text-[11.5px] text-[#B45309]">
                  {SECTIONS.length - done} part{SECTIONS.length - done > 1 ? 's are' : ' is'} still
                  unconfirmed, and nothing unconfirmed is priced or sent to the builder.
                </p>
              )}
              {error && (
                <div className="mt-3 flex gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#DC2626]" />
                  <p data-testid="estimator-error" className="text-[12.5px] leading-relaxed text-[#991B1B]">{error}</p>
                </div>
              )}
            </div>

            {result && <Result result={result} address={address} anchor={anchor} setAnchor={setAnchor} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One part of the property
// ---------------------------------------------------------------------------

function AreaCard({ area, photos, recording, interim, micSupported, onMic, onPatch }: {
  area: AreaAssessment;
  photos: ListingPhoto[];
  recording: boolean;
  interim: string;
  micSupported: boolean;
  onMic: () => void;
  onPatch: (fn: (a: AreaAssessment) => AreaAssessment) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const section = SECTIONS.find((s) => s.id === area.id);
  const verdict = verdictOf(area);
  const ui = VERDICT_UI[verdict];
  const mine = area.photos.map((i) => photos[i]).filter(Boolean);

  const setVerdict = (v: AreaVerdict) => onPatch((a) => ({
    ...a,
    agentVerdict: v,
    // "Nothing to do" means nothing to do. Leaving ticked work lines behind a
    // green badge is how a confirmed nothing quietly costs four thousand pounds.
    works: v === 'nothing' ? a.works.map((w) => ({ ...w, include: false })) : a.works,
    inspect: v === 'inspect' ? true : v === 'nothing' ? false : a.inspect,
  }));

  return (
    <div
      data-testid={`section-${area.id}`}
      className={cn(
        'rounded-2xl border bg-white p-4 transition-colors',
        recording ? 'border-[#DC2626] ring-2 ring-[#FEE2E2]'
          : area.confirmed ? 'border-[#BBF7D0]' : 'border-[#E5E7EB]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-bold text-[#1A1A1A]">{area.label}</h2>
            <span className={cn('rounded-full px-2 py-[2px] text-[9.5px] font-bold uppercase', ui.cls)}>
              {ui.label}
            </span>
            {area.confirmed && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-[#DCFCE7] px-1.5 py-[1px] text-[9.5px] font-bold uppercase text-[#166534]">
                <Check className="h-2.5 w-2.5" /> confirmed
              </span>
            )}
          </div>
          {section && <p className="mt-1 text-[12px] leading-relaxed text-[#9CA3AF]">{section.look}</p>}
        </div>
        {micSupported && (
          <button
            type="button"
            data-testid={`mic-${area.id}`}
            onClick={onMic}
            className={cn(
              'flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold transition-colors',
              recording ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]' : 'bg-[#EEF2F8] text-[#3C5A87] hover:bg-[#DCE5F1]',
            )}
          >
            {recording ? <><Square className="h-3.5 w-3.5 fill-current" /> Stop</> : <><Mic className="h-4 w-4" /> Speak</>}
          </button>
        )}
      </div>

      {/* the photos for THIS part of the property, right beside it */}
      {(mine.length > 0 || area.agentPhotos.length > 0) && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {mine.map((p) => <Thumb key={p.url} photo={p} />)}
          {area.agentPhotos.map((u) => (
            <div key={u} className="relative flex-shrink-0">
              <Thumb photo={{ url: u, thumb: u, caption: 'Your photo' }} />
              <span className="absolute left-1 top-1 rounded bg-[#3C5A87] px-1 text-[9px] font-bold text-white">yours</span>
              <button
                type="button"
                onClick={() => onPatch((a) => ({ ...a, agentPhotos: a.agentPhotos.filter((x) => x !== u) }))}
                className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"
                aria-label="Remove this photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {!mine.length && !area.agentPhotos.length && area.aiVerdict !== 'unknown' && (
        <p className="mt-2 text-[11.5px] italic text-[#9CA3AF]">
          No photo of this part of the property on the advert.
        </p>
      )}

      {/* what the readers said */}
      {area.summary && (
        <p className="mt-3 text-[13px] leading-relaxed text-[#1A1A1A]">{area.summary}</p>
      )}
      {area.readers.length > 0 && (
        <div className="mt-2 space-y-1">
          {area.readers.map((r) => (
            <p key={r.reader} className="text-[11.5px] leading-snug text-[#6B7280]">
              <span className="font-semibold uppercase">{r.reader}</span>
              {' '}said <em>{VERDICT_UI[r.verdict].label.toLowerCase()}</em>
              {r.evidence ? `: ${r.evidence}` : ''}
              {r.basis ? ` (${BASIS_LABEL[r.basis] ?? r.basis})` : ''}
            </p>
          ))}
          {area.readers.length < 2 && (
            <p className="text-[11.5px] italic text-[#B45309]">
              Only one reader answered on this one, so nothing here is treated as agreed.
            </p>
          )}
        </div>
      )}

      {/* the work lines */}
      {area.works.length > 0 && (
        <div className="mt-3 space-y-2">
          {area.works.map((w) => (
            <WorkRow
              key={w.key}
              work={w}
              disabled={verdict === 'nothing'}
              onChange={(next) => onPatch((a) => ({
                ...a, works: a.works.map((x) => (x.key === w.key ? next : x)),
              }))}
              onRemove={() => onPatch((a) => ({ ...a, works: a.works.filter((x) => x.key !== w.key) }))}
            />
          ))}
        </div>
      )}

      {/* his own words */}
      {recording && (
        <p className="mt-2.5 flex items-center gap-2 text-[12.5px] italic text-[#DC2626]">
          <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#DC2626]" />
          {interim || `Listening. Say what you can see in the ${area.label.toLowerCase()}.`}
        </p>
      )}
      <textarea
        data-testid={`text-${area.id}`}
        value={area.agentNote}
        onChange={(e) => onPatch((a) => ({ ...a, agentNote: e.target.value }))}
        rows={2}
        placeholder={micSupported
          ? 'Your own words about this part. Press Speak, or type. This goes to the builder instead of the AI sentence.'
          : 'Your own words about this part. This goes to the builder instead of the AI sentence.'}
        className="mt-3 w-full resize-y rounded-xl border border-[#E5E7EB] px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none focus:border-[#3C5A87]"
      />

      {/* add work, add a photo */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`add-work-${area.id}`}
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg bg-[#F3F4F6] px-2.5 py-1.5 text-[12px] font-semibold text-[#374151]"
        >
          <Plus className="h-3.5 w-3.5" /> Add work
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-[#F3F4F6] px-2.5 py-1.5 text-[12px] font-semibold text-[#374151]">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading' : 'Add a photo'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            data-testid={`photo-${area.id}`}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) return;
              setUploading(true);
              try {
                const path = `refurb/${area.id}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                const { error: upErr } = await supabase.storage
                  .from('crm-attachments').upload(path, file, { upsert: true });
                if (upErr) throw upErr;
                const { data } = supabase.storage.from('crm-attachments').getPublicUrl(path);
                onPatch((a) => ({ ...a, agentPhotos: [...a.agentPhotos, data.publicUrl] }));
              } catch { /* the section still works without the picture */ }
              finally { setUploading(false); }
            }}
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-[#374151]">
          <input
            type="checkbox"
            data-testid={`inspect-${area.id}`}
            checked={area.inspect}
            onChange={(e) => onPatch((a) => ({ ...a, inspect: e.target.checked }))}
            className="h-4 w-4 accent-[#3C5A87]"
          />
          Somebody needs to look at this properly
        </label>
      </div>

      {adding && (
        <AddWork
          existing={area.works.map((w) => w.key)}
          onAdd={(key) => {
            onPatch((a) => ({
              ...a,
              agentVerdict: 'work',
              works: [...a.works, {
                key, label: CARD[key].label, detail: CARD[key].label,
                status: 'added', include: true, qty: 1, portion: 1,
              }],
            }));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* the confirmation. Nothing below this line is optional. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#F3F4F6] pt-3">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Your answer</span>
        {(['nothing', 'work', 'inspect'] as AreaVerdict[]).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`verdict-${area.id}-${v}`}
            onClick={() => setVerdict(v)}
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
              verdict === v ? VERDICT_UI[v].cls : 'bg-[#F9FAFB] text-[#6B7280] hover:bg-[#F3F4F6]',
            )}
          >
            {VERDICT_UI[v].label}
          </button>
        ))}
        <button
          type="button"
          data-testid={`confirm-${area.id}`}
          onClick={() => onPatch((a) => ({
            ...a,
            confirmed: !a.confirmed,
            // Pressing confirm on a part nobody has judged is him saying it is
            // fine, so it has to become an answer rather than stay "unknown"
            // and slip through as neither confirmed nor priced.
            agentVerdict: a.agentVerdict ?? (a.aiVerdict === 'unknown' ? 'nothing' : a.aiVerdict),
          }))}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition-colors',
            area.confirmed
              ? 'bg-[#DCFCE7] text-[#166534] hover:bg-[#BBF7D0]'
              : 'bg-[#3C5A87] text-white hover:bg-[#324D74]',
          )}
        >
          <Check className="h-3.5 w-3.5" /> {area.confirmed ? 'Confirmed' : 'Confirm this part'}
        </button>
      </div>
    </div>
  );
}

function WorkRow({ work, disabled, onChange, onRemove }: {
  work: AreaWork;
  disabled: boolean;
  onChange: (w: AreaWork) => void;
  onRemove: () => void;
}) {
  const badge = work.status === 'agreed'
    ? { text: 'both readers', cls: 'bg-[#DCFCE7] text-[#166534]' }
    : work.status === 'added'
      ? { text: 'you added it', cls: 'bg-[#EEF2F8] text-[#3C5A87]' }
      : { text: 'only one reader, not priced', cls: 'bg-[#FEF3C7] text-[#B45309]' };
  return (
    <div className={cn('rounded-xl border p-2.5', disabled ? 'border-[#F3F4F6] opacity-50' : 'border-[#E5E7EB]')}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          data-testid={`work-${work.key}`}
          checked={work.include}
          disabled={disabled}
          onChange={(e) => onChange({ ...work, include: e.target.checked })}
          className="mt-1 h-4 w-4 flex-shrink-0 accent-[#3C5A87]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold text-[#1A1A1A]">{work.label}</span>
            <span className={cn('rounded-full px-1.5 py-[1px] text-[9px] font-bold uppercase', badge.cls)}>{badge.text}</span>
            {CARD[work.key]?.source === 'course' && (
              <span className="rounded-full bg-[#FEF3C7] px-1.5 py-[1px] text-[9px] font-bold uppercase text-[#B45309]">off card</span>
            )}
          </div>
          <input
            value={work.detail}
            disabled={disabled}
            onChange={(e) => onChange({ ...work, detail: e.target.value })}
            className="mt-1 w-full rounded-lg border border-[#F3F4F6] bg-[#F9FAFB] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#3C5A87]"
          />
        </div>
        <button type="button" onClick={onRemove} className="mt-1 text-[#9CA3AF] hover:text-[#DC2626]" aria-label="Remove this work">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function AddWork({ existing, onAdd, onCancel }: {
  existing: LineKey[];
  onAdd: (k: LineKey) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState('');
  const options = useMemo(() => Object.values(CARD)
    .filter((l) => !existing.includes(l.key))
    .filter((l) => !q || `${l.label} ${l.when}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8), [existing, q]);
  return (
    <div className="mt-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-2.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type what it needs, for example kitchen or damp"
          className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[#3C5A87]"
        />
        <button type="button" onClick={onCancel} className="text-[#9CA3AF]" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 space-y-1">
        {options.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => onAdd(l.key)}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-white"
          >
            <span className="font-semibold text-[#1A1A1A]">{l.label}</span>
            <span className="ml-1.5 text-[11.5px] text-[#9CA3AF]">{l.when}</span>
          </button>
        ))}
        {!options.length && <p className="px-2 py-1.5 text-[12px] text-[#9CA3AF]">Nothing on the rate card matches that.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

function Result({ result, address, anchor, setAnchor }: {
  result: PriceResult;
  address: string;
  anchor: boolean;
  setAnchor: (v: boolean) => void;
}) {
  const est = result.estimate;
  return (
    <div id="estimate-result" className="scroll-mt-24">
      <div data-testid="estimate-totals" className="mt-4 rounded-2xl border border-[#E5E7EB] bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#EEF2F8] p-2.5"><PoundSterling className="h-5 w-5 text-[#3C5A87]" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              Our budget for {address || 'this property'}
            </p>
            <p data-testid="estimate-budget" className="mt-0.5 text-[34px] font-bold leading-none text-[#1A1A1A]">
              {gbp(est.budget)}
            </p>
            <p className="mt-1.5 text-[12px] text-[#6B7280]">
              materials and labour, <strong>excluding VAT</strong>, and before the 5% contingency
              the deal calculator adds itself
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'Budget', v: est.budget, hint: 'our own crew' },
            { label: 'Medium', v: est.medium, hint: 'normal builder' },
            { label: 'Premium', v: est.premium, hint: 'top of the range' },
          ].map((c) => (
            <div key={c.label} className="rounded-xl bg-[#F9FAFB] px-3 py-2.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{c.label}</p>
              <p className="mt-0.5 text-[17px] font-bold text-[#1A1A1A]">{gbp(c.v)}</p>
              <p className="text-[10.5px] text-[#9CA3AF]">{c.hint}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-[#9CA3AF]">
          All three are the same list of jobs at three different labour rates, all three include
          materials, and all three exclude VAT. {est.scaleNote}
        </p>
      </div>

      {result.nothingToDo.length > 0 && (
        <div className="mt-3 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4" data-testid="nothing-to-do">
          <h2 className="text-[13.5px] font-bold text-[#166534]">Nothing to do</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#166534]">
            {result.nothingToDo.join(', ')}. You confirmed these are fine as they are, so there is
            no money against them and they are not on the builder message.
          </p>
        </div>
      )}

      {result.unconfirmed.length > 0 && (
        <div className="mt-3 flex gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#B45309]" />
          <p className="text-[12.5px] leading-relaxed text-[#78350F]">
            Not confirmed and therefore not priced at all: {result.unconfirmed.join(', ')}.
          </p>
        </div>
      )}

      {est.warnings.map((w) => (
        <div key={w} className="mt-3 flex gap-2.5 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#B45309]" />
          <p className="text-[12.5px] leading-relaxed text-[#78350F]">{w}</p>
        </div>
      ))}

      <div className="mt-3 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white">
        <div className="border-b border-[#F3F4F6] px-4 py-3">
          <h2 className="text-[14px] font-bold text-[#1A1A1A]">Where the money goes</h2>
          <p className="mt-0.5 text-[11.5px] text-[#9CA3AF]">
            Every line here came out of a part of the property you confirmed. All figures exclude VAT.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#F3F4F6] text-[10.5px] uppercase tracking-wide text-[#9CA3AF]">
                <th className="px-4 py-2 text-left font-semibold">Work</th>
                <th className="px-2 py-2 text-right font-semibold">Budget</th>
                <th className="px-2 py-2 text-right font-semibold">Medium</th>
                <th className="px-4 py-2 text-right font-semibold">Premium</th>
              </tr>
            </thead>
            <tbody data-testid="estimate-lines">
              {est.lines.map((l) => (
                <tr key={l.key} className="border-b border-[#F9FAFB] align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-[#1A1A1A]">{l.label}</span>
                      {l.where && <span className="text-[10.5px] text-[#6B7280]">{l.where}</span>}
                      {l.units > 1 && Number.isInteger(l.units) && (
                        <span className="text-[10.5px] font-semibold text-[#6B7280]">x{l.units}</span>
                      )}
                      {l.source === 'course' && (
                        <span className="rounded-full bg-[#FEF3C7] px-1.5 py-[1px] text-[9px] font-bold uppercase text-[#B45309]">off card</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-[#6B7280]">{l.detail}</p>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-[#1A1A1A]">{gbp(l.budget)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-[#6B7280]">{gbp(l.medium)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#9CA3AF]">{gbp(l.premium)}</td>
                </tr>
              ))}
              {!est.lines.length && (
                <tr><td colSpan={4} className="px-4 py-6 text-center italic text-[#9CA3AF]">
                  Nothing needs doing on anything you confirmed. That is a real answer, not an error.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {est.offCard.length > 0 && (
          <div className="border-t border-[#F3F4F6] bg-[#FFFBEB] px-4 py-2.5 text-[11.5px] leading-relaxed text-[#78350F]">
            <strong>{gbp(est.offCardBudget)}</strong> of this is marked <em>off card</em>: roofs,
            windows, damp and heating. Our offer engine refuses to price those from photographs, so
            they were never inside the ballpark. They need a builder to look.
          </div>
        )}
      </div>

      {result.toConfirm.length > 0 && (
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4" data-testid="to-confirm">
          <h2 className="text-[14px] font-bold text-[#1A1A1A]">The builder confirms and prices these</h2>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#9CA3AF]">
            Only one reader saw these, or you unticked them. They carry no money on our side.
          </p>
          <ul className="mt-2 space-y-1.5">
            {result.toConfirm.map((a) => (
              <li key={`${a.where}-${a.label}`} className="flex gap-2 text-[12.5px] leading-relaxed text-[#374151]">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#F59E0B]" />
                <span><strong>{a.where}:</strong> {a.label}. {a.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.toInspect.length > 0 && (
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4" data-testid="to-inspect">
          <div className="mb-1 flex items-center gap-2">
            <Eye className="h-4 w-4 text-[#3C5A87]" />
            <h2 className="text-[14px] font-bold text-[#1A1A1A]">Somebody has to stand in these</h2>
          </div>
          <ul className="mt-2 space-y-1.5">
            {result.toInspect.map((a) => (
              <li key={a.where} className="flex gap-2 text-[12.5px] leading-relaxed text-[#374151]">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#3B82F6]" />
                <span><strong>{a.where}:</strong> {a.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {est.unknowns.length > 0 && (
        <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
          <h2 className="text-[14px] font-bold text-[#1A1A1A]">Worth checking on the day</h2>
          <ul className="mt-2 space-y-1.5">
            {est.unknowns.map((u) => (
              <li key={u} className="flex gap-2 text-[12.5px] leading-relaxed text-[#374151]">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#9CA3AF]" />{u}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 rounded-2xl border border-[#E5E7EB] bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardHat className="h-4 w-4 text-[#3C5A87]" />
            <h2 className="text-[14px] font-bold text-[#1A1A1A]">Message for the builder</h2>
          </div>
          <Copy text={result.brief} label="Copy" />
        </div>
        <label className="mb-3 flex items-center gap-2 text-[12px] text-[#374151]">
          <input
            type="checkbox"
            data-testid="anchor-toggle"
            checked={anchor}
            onChange={(e) => setAnchor(e.target.checked)}
            className="h-4 w-4 accent-[#3C5A87]"
          />
          Put our budget on it, to anchor him at a price. Press Generate again after changing this.
        </label>
        <pre
          data-testid="builder-brief"
          className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-[#F9FAFB] p-3.5 font-sans text-[12.5px] leading-relaxed text-[#374151]"
        >{result.brief}</pre>
        <p className="mt-2 text-[11px] leading-relaxed text-[#9CA3AF]">
          It does not tell him we have not been inside. It asks him to confirm the flagged items
          and price them, which is the same information without the discount he would price in.
        </p>
      </div>
    </div>
  );
}
