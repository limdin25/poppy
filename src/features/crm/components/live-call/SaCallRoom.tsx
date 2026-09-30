import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import HostunicoScriptPane from './HostunicoScriptPane';
import SaReportPanel, { reportAction } from './SaReportPanel';
import LiveTranscriptPane from './LiveTranscriptPane';
import SaListingPane from './SaListingPane';
import SaEmailPane from './SaEmailPane';
import { useSaListings, gbpMonth } from '../../hooks/useSaListings';
import type { Contact } from '../../types';
import { supabase } from '@/integrations/supabase/browser';
import { hostunicoCountry } from '../../../../../supabase/functions/_shared/hostunico-pricing';

export interface SaCallRoomProps {
  contact: Contact | null;
  contactHeader?: ReactNode;
  emptyState?: ReactNode;
  currentCallId: string | null;
  callConnected: boolean;
  liveDurationSec?: number;
  agentFirstName: string;
  campaignId?: string | null;
  pipelineId?: string | null;
  direction: 'outbound' | 'inbound';
  autoSaveId?: string;
}

export default function SaCallRoom({ contact, contactHeader, emptyState, currentCallId, liveDurationSec = 0, agentFirstName, campaignId, direction }: SaCallRoomProps) {
  const { listings } = useSaListings(contact?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [opener, setOpener] = useState('');
  const [ahead, setAhead] = useState('');
  const [emailReport, setEmailReport] = useState<string | null>(null);
  const [country, setCountry] = useState('GB');
  const [countryError, setCountryError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setCountry(hostunicoCountry(null, contact?.phone)); setCountryError('');
    if (contact?.id) void (supabase as any).from('wk_contacts').select('hostunico_country').eq('id', contact.id).maybeSingle().then(({ data }: any) => {
      if (!cancelled) setCountry(hostunicoCountry(data?.hostunico_country, contact.phone));
    });
    return () => { cancelled = true; };
  }, [contact?.id, contact?.phone]);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  useEffect(() => { setSelectedId(null); setDetails(false); }, [contact?.id]);
  const selected = useMemo(() => listings.find((l) => l.id === selectedId) ?? listings[0] ?? null, [listings, selectedId]);
  useEffect(() => { setEmailReport(null); }, [contact?.id, selected?.id]);
  useEffect(() => {
    if (!campaignId || campaignId !== '5d9657f9-d9b4-4e27-a2d1-83db80867f92') return;
    let cancelled = false;
    let running = false;
    async function prepare() {
      if (running) return;
      running = true;
      try {
        const result = await reportAction('prepare_queue', { campaign_id: campaignId, contact_id: contact?.id });
        if (!cancelled) setAhead(`${result.ready} reports ready ahead${result.preparing ? `, ${result.preparing} preparing` : ''}${result.needsDetails ? `, ${result.needsDetails} need property details` : ''}${result.failed ? `, ${result.failed} could not be prepared` : ''}`);
      } catch (e) { if (!cancelled) setAhead(e instanceof Error ? e.message : 'Could not prepare reports ahead.'); }
      finally { running = false; }
    }
    void prepare();
    const timer = window.setInterval(() => void prepare(), 45000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [campaignId, contact?.id]);
  if (!contact) return <div className="flex h-full items-center justify-center text-slate-500">{emptyState || 'Choose a lead to start calling.'}</div>;
  return <div className="flex h-full min-h-0 flex-col bg-slate-50" data-testid="dialer-sa-panel">
    <header className="shrink-0 border-b bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0"><p className="text-sm font-semibold">{contact.name} <span className="ml-2 font-normal text-slate-500">{contact.phone}</span></p><p className="text-xs text-slate-500">{selected ? [selected.address, gbpMonth(selected.rentPcm)].filter(Boolean).join(' · ') : 'Choose a property'}</p></div>
        <button onClick={() => setDetails(!details)} aria-expanded={details} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium"><Building2 size={14} />{details ? 'Close details' : `Property, notes and outcome${listings.length > 1 ? ` (${listings.length})` : ''}`}</button>
      </div>
      {listings.length > 1 && <select aria-label="Property on this call" value={selected?.id || ''} onChange={(e) => setSelectedId(e.target.value)} className="h-9 w-full rounded-lg border bg-white px-2 text-xs">{listings.map((l) => <option key={l.id} value={l.id}>{l.address} · {gbpMonth(l.rentPcm)}</option>)}</select>}
      {direction === 'inbound' && <p className="text-xs text-blue-700">They called back. Thank them, check which property they mean, then choose the right script.</p>}
      <label className="flex items-center gap-2 text-xs text-slate-600">Lead country<select aria-label="Lead country for pricing" value={country === 'GB' ? 'GB' : 'US'} className="rounded-lg border bg-white px-3 py-2" onChange={async (e) => {
        const next = e.target.value;
        if (!selected) return;
        try { await reportAction('country', { listing_id: selected.id, country: next }); setCountry(next); setCountryError(''); } catch { setCountryError('Country was not saved. Please try again.'); }
      }}><option value="GB">United Kingdom (software £29/month)</option><option value="US">Outside UK (software $29/month)</option></select></label>
      {countryError && <p role="alert" className="text-xs text-red-700">{countryError}</p>}
      <SaReportPanel key={selected?.id || 'none'} listing={selected} phone={contact.phone} onEmail={setEmailReport} />
      {ahead && <p className="text-[11px] text-slate-500" role="status">{ahead}</p>}
    </header>
    <div className="relative min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-y-auto lg:overflow-hidden">
      <div className="min-h-[360px] lg:min-h-0 border-r"><HostunicoScriptPane listing={selected} agentName={agentFirstName} onOpener={setOpener} country={country} /></div>
      <section className="min-h-[340px] lg:min-h-0 flex flex-col bg-white" aria-label="Live AI coach"><h2 className="border-b p-3 font-semibold">Live coach <span className="ml-2 text-xs font-normal text-slate-500">Listen, answer, pause</span></h2><div className="min-h-0 flex-1"><LiveTranscriptPane key={currentCallId || contact.id} durationSec={liveDurationSec} contactId={contact.id} callId={currentCallId} agentFirstName={agentFirstName} hostunicoCountry={country} isSaCall propertyOpener={opener} /></div></section>
      {details && <section aria-label="Property details and outcome" className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l bg-white shadow-xl"><div className="flex items-center justify-between border-b p-3"><h2 className="font-semibold">Property and next step</h2><button onClick={() => setDetails(false)} className="rounded-lg border px-3 py-1.5 text-xs">Close</button></div><div className="overflow-y-auto min-h-0">{contactHeader}<SaListingPane contactId={contact.id} selectedId={selected?.id ?? null} onSelect={handleSelect} currentCallId={currentCallId} /></div></section>}
      {emailReport && <section aria-label="Email property report" className="absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l bg-white shadow-xl"><div className="flex items-center justify-between border-b p-3"><h2 className="font-semibold">Email the report</h2><button onClick={() => setEmailReport(null)} className="rounded-lg border px-3 py-1.5 text-xs">Close</button></div><div className="min-h-0 flex-1"><SaEmailPane key={selected?.id} contactId={contact.id} contactEmail={contact.email} listing={selected} agentFirstName={agentFirstName} reportUrl={emailReport} country={country} /></div></section>}
    </div>
  </div>;
}
