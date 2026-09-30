import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, ExternalLink } from 'lucide-react';
import HostunicoScriptPane from './HostunicoScriptPane';
import SaReportPanel, { reportAction } from './SaReportPanel';
import LiveTranscriptPane from './LiveTranscriptPane';
import SaListingPane from './SaListingPane';
import SaEmailPane from './SaEmailPane';
import { useSaListings } from '../../hooks/useSaListings';
import { hostunicoProperty } from '../../lib/hostunicoProperty';
import type { Contact } from '../../types';
import { supabase } from '@/integrations/supabase/browser';
import { hostunicoCountry } from '../../../../../supabase/functions/_shared/hostunico-pricing';
import type { HostunicoReportPitch } from '../../lib/hostunicoReportPitch';
import { useAuth } from '../../lib/useCrmAuth';
import { useViewAs } from '../../lib/ViewAsContext';
import { useAgentDirectory } from '../../hooks/useAgentDirectory';
import { hostunicoCallerName } from '../../lib/hostunicoCaller';

export interface SaCallRoomProps {
  contact: Contact | null; contactHeader?: ReactNode; emptyState?: ReactNode;
  currentCallId: string | null; callConnected: boolean; liveDurationSec?: number;
  agentFirstName: string; campaignId?: string | null; pipelineId?: string | null;
  direction: 'outbound' | 'inbound'; autoSaveId?: string;
  onControlsMount?: (node: HTMLDivElement | null) => void;
  onEndCall?: () => void;
}

export default function SaCallRoom({ contact, contactHeader, emptyState, currentCallId, callConnected, liveDurationSec = 0, agentFirstName, campaignId, direction, onControlsMount, onEndCall }: SaCallRoomProps) {
  const { isAdmin, loading } = useAuth();
  const { viewAsId, viewAsName } = useViewAs();
  const { byId } = useAgentDirectory();
  const callerName = hostunicoCallerName({ signedInName: agentFirstName, isAdmin, loading, viewAsId, viewAsName, assignedAgentId: contact?.ownerAgentId, agents: byId });
  const { listings } = useSaListings(contact?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [opener, setOpener] = useState('');
  const [mode, setMode] = useState('spareroom');
  const [ahead, setAhead] = useState('');
  const [emailReport, setEmailReport] = useState<string | null>(null);
  const [country, setCountry] = useState('GB');
  const [pitchSnapshot, setPitchSnapshot] = useState<{ listingId: string; country: string; value: HostunicoReportPitch | null } | null>(null);
  const receivePitch = useCallback((listingId: string, country: string, value: HostunicoReportPitch | null) => setPitchSnapshot({ listingId, country, value }), []);
  const [countryError, setCountryError] = useState('');
  const [contextError, setContextError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setCountry(hostunicoCountry(null, contact?.phone)); setCountryError('');
    if (contact?.id) void (supabase as any).from('wk_contacts').select('hostunico_country').eq('id', contact.id).maybeSingle().then(({ data }: any) => {
      if (!cancelled) setCountry(hostunicoCountry(data?.hostunico_country, contact.phone));
    });
    return () => { cancelled = true; };
  }, [contact?.id, contact?.phone]);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  useEffect(() => { setSelectedId(null); }, [contact?.id]);
  const selected = useMemo(() => listings.find((l) => l.id === selectedId) ?? listings[0] ?? null, [listings, selectedId]);
  const facts = hostunicoProperty(selected);
  useEffect(() => { setEmailReport(null); }, [contact?.id, selected?.id]);
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setContextError('');
    void reportAction('coach_context', { listing_id: selected.id, mode, context_at: new Date().toISOString() }).catch(() => {
      if (!cancelled) setContextError('The coach could not load this property. Use the script while it reconnects.');
    });
    return () => { cancelled = true; };
  }, [selected?.id, mode, currentCallId]);
  useEffect(() => {
    if (campaignId !== '5d9657f9-d9b4-4e27-a2d1-83db80867f92') return;
    let cancelled = false, running = false;
    async function prepare() {
      if (running) return;
      running = true;
      try {
        const totals = { ready: 0, preparing: 0, needsDetails: 0, failed: 0 };
        let offset: number | null = 0;
        while (offset !== null && !cancelled) {
          const result = await reportAction('prepare_queue', { campaign_id: campaignId, contact_id: contact?.id, offset });
          if (cancelled) break;
          for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += Number(result[key]) || 0;
          offset = result.nextOffset ?? null;
          setAhead(`${totals.ready} ready ahead${totals.preparing ? `, ${totals.preparing} preparing` : ''}${totals.needsDetails ? `, ${totals.needsDetails} need details` : ''}${totals.failed ? `, ${totals.failed} need review` : ''}${offset !== null ? ', checking next reports' : ''}`);
        }
      } catch { if (!cancelled) setAhead('Reports ahead could not refresh.'); }
      finally { running = false; }
    }
    void prepare();
    const timer = window.setInterval(() => void prepare(), 45000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [campaignId, contact?.id]);

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50" data-testid="dialer-sa-panel">
    <header className="flex shrink-0 items-center gap-3 border-b bg-white px-3 py-2">
      <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="hostunico-call-sidebar" className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold hover:bg-slate-100">
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}{collapsed ? 'Show property and controls' : 'Hide property and controls'}
      </button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{contact?.name || 'Hostunico calling room'} <span className="ml-2 font-normal text-slate-500">{contact?.phone}</span></p><p className="truncate text-xs text-slate-500">{selected ? `${facts.description} in ${facts.place}${facts.rent ? ` · ${facts.rent}` : ''}` : 'One call per unique contact number'}</p></div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${callConnected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{callConnected ? 'On the call' : 'Ready to call'}</span>
      {callConnected && onEndCall && <button onClick={onEndCall} className="shrink-0 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white">End call</button>}
    </header>
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <aside id="hostunico-call-sidebar" aria-label="Property, report and call controls" className={`${collapsed ? 'hidden' : 'flex'} w-[320px] max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r bg-slate-50 xl:w-[340px]`}>
        <div ref={onControlsMount} className="shrink-0 p-2" data-testid="hostunico-dialer-controls" />
        {contact && <div className="space-y-3 p-3 pt-0">
          <section className="overflow-hidden rounded-xl border bg-white" aria-label="Property on this call">
            {selected?.photoUrls[0] && <img key={selected.id} src={selected.photoUrls[0]} alt={`SpareRoom advert: ${selected.address}`} className="h-32 w-full object-cover" referrerPolicy="no-referrer" />}
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Property on this call</h2>{selected?.listingUrl && <a href={selected.listingUrl} target="_blank" rel="noreferrer" aria-label="Open SpareRoom advert" className="text-blue-700"><ExternalLink size={15} /></a>}</div>
              {listings.length > 1 ? <label className="block text-xs text-slate-500">{listings.length} properties, one contact<select aria-label="Property on this call" value={selected?.id || ''} onChange={(e) => setSelectedId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs text-slate-900">{listings.map((l) => <option key={l.id} value={l.id}>{l.address}</option>)}</select></label> : <p className="text-sm font-medium">{selected?.address || 'Property details to confirm'}</p>}
              <div className="flex flex-wrap gap-1 text-[11px]">{[facts.layout, facts.bathroom, facts.rent].filter(Boolean).map((fact) => <span key={fact} className="rounded-md bg-slate-100 px-2 py-1">{fact}</span>)}</div>
              <p className="text-[11px] text-slate-500">Whole studio or one-bedroom advert. Report assumptions are labelled.</p>
              {selected?.summary && <details><summary className="cursor-pointer text-xs font-medium">Read advert description</summary><p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-600">{selected.summary}</p></details>}
            </div>
          </section>
          <SaReportPanel key={`${selected?.id || 'none'}:${country}`} listing={selected} phone={contact.phone} country={country} onReportPitch={receivePitch} onEmail={(url) => { setEmailReport(url); setCollapsed(false); }} />
          {ahead && <p className="text-[11px] text-slate-500" role="status">{ahead}</p>}
          <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-semibold">Lead country and pricing</summary><label className="mt-2 block text-xs text-slate-600">Lead country<select aria-label="Lead country for pricing" value={country === 'GB' ? 'GB' : 'US'} className="mt-1 w-full rounded-lg border bg-white px-2 py-2" onChange={async (e) => {
            const next = e.target.value;
            if (!selected) return;
            try { await reportAction('country', { listing_id: selected.id, country: next }); setCountry(next); setCountryError(''); } catch { setCountryError('Country was not saved. Please try again.'); }
          }}><option value="GB">United Kingdom (software £29/month)</option><option value="US">Outside UK (software $29/month)</option></select></label>{countryError && <p role="alert" className="mt-2 text-xs text-red-700">{countryError}</p>}</details>
          <details className="rounded-xl border bg-white"><summary className="cursor-pointer p-3 text-xs font-semibold">Contact, notes and outcome</summary>{contactHeader}<SaListingPane contactId={contact.id} selectedId={selected?.id ?? null} onSelect={handleSelect} currentCallId={currentCallId} /></details>
        </div>}
      </aside>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-2 md:overflow-hidden" data-testid="hostunico-focus-columns">
        <div className="min-h-[440px] min-w-0 border-r md:min-h-0"><HostunicoScriptPane key={contact?.id || 'no-contact'} listing={selected} agentName={callerName} onOpener={setOpener} onMode={setMode} country={country} reportPitch={pitchSnapshot?.listingId === selected?.id && pitchSnapshot?.country === country ? pitchSnapshot.value : null} /></div>
        <section className="flex min-h-[440px] min-w-0 flex-col bg-white md:min-h-0" aria-label="Live AI coach">
          {direction === 'inbound' && <p className="border-b bg-blue-50 p-2 text-xs text-blue-700">They called back. Confirm which property they mean.</p>}
          {contextError && <p role="alert" className="bg-amber-50 p-2 text-xs text-amber-900">{contextError}</p>}
          <div className="min-h-0 flex-1">{contact ? <LiveTranscriptPane key={currentCallId || contact.id} durationSec={liveDurationSec} contactId={contact.id} callId={currentCallId} agentFirstName={callerName} hostunicoCountry={country} hostunicoContext={`${selected?.id || ''}:${mode}:${country}`} isSaCall propertyOpener={opener} /> : <div className="p-5 text-sm text-slate-500">{emptyState || 'Choose a lead to start. The live coach appears here.'}</div>}</div>
        </section>
      </div>
      {emailReport && contact && <section aria-label="Email property report" className="absolute inset-y-0 left-0 z-30 flex w-full max-w-md flex-col border-r bg-white shadow-xl"><div className="flex items-center justify-between border-b p-3"><h2 className="font-semibold">Email the report</h2><button onClick={() => setEmailReport(null)} className="rounded-lg border px-3 py-1.5 text-xs">Close email</button></div><div className="min-h-0 flex-1"><SaEmailPane key={selected?.id} contactId={contact.id} contactEmail={contact.email} listing={selected} agentFirstName={callerName} reportUrl={emailReport} country={country} /></div></section>}
    </div>
  </div>;
}
