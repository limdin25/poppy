import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, ExternalLink } from 'lucide-react';
import HostunicoScriptPane from './HostunicoScriptPane';
import HostunicoListingLinks from '../contacts/HostunicoListingLinks';
import SaReportPanel, { reportAction } from './SaReportPanel';
import LiveTranscriptPane from './LiveTranscriptPane';
import SaListingPane from './SaListingPane';
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
import type { HostunicoSpeech } from '../../lib/hostunicoSpeech';
import { refreshHostunicoReports } from '../../lib/hostunicoPreparation';

export interface SaCallRoomProps {
  contact: Contact | null; contactHeader?: ReactNode; emptyState?: ReactNode;
  currentCallId: string | null; callConnected: boolean; liveDurationSec?: number;
  callInProgress?: boolean;
  agentFirstName: string; campaignId?: string | null; pipelineId?: string | null;
  direction: 'outbound' | 'inbound'; autoSaveId?: string;
  onControlsMount?: (node: HTMLDivElement | null) => void;
  onEndCall?: () => void;
}

export default function SaCallRoom({ contact, contactHeader, emptyState, currentCallId, callConnected, callInProgress = callConnected, liveDurationSec = 0, agentFirstName, campaignId, direction, onControlsMount, onEndCall }: SaCallRoomProps) {
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
  const [country, setCountry] = useState('GB');
  const [pitchSnapshot, setPitchSnapshot] = useState<{ listingId: string; country: string; value: HostunicoReportPitch | null } | null>(null);
  const receivePitch = useCallback((listingId: string, country: string, value: HostunicoReportPitch | null) => setPitchSnapshot({ listingId, country, value }), []);
  const [mobileSnapshot, setMobileSnapshot] = useState<{ listingId: string; mobile: string } | null>(null);
  const receiveMobile = useCallback((listingId: string, mobile: string) => setMobileSnapshot({ listingId, mobile }), []);
  const [reviewRequest, setReviewRequest] = useState<{ contactId: string; listingId: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [countryError, setCountryError] = useState('');
  const [contextError, setContextError] = useState('');
  const [speechSnapshot, setSpeechSnapshot] = useState<{ scope: string; lines: HostunicoSpeech[] } | null>(null);
  const receiveSpeech = useCallback((lines: HostunicoSpeech[]) => setSpeechSnapshot({ scope: `${contact?.id}:${currentCallId}`, lines }), [contact?.id, currentCallId]);
  const agentSpeech = speechSnapshot?.scope === `${contact?.id}:${currentCallId}` ? speechSnapshot.lines.filter((line) => line.speaker === 'agent').map((line) => line.body).join(' ') : '';
  useEffect(() => {
    let cancelled = false;
    setCountry(hostunicoCountry(null, contact?.phone)); setCountryError('');
    if (contact?.id) void (supabase as any).from('wk_contacts').select('hostunico_country').eq('id', contact.id).maybeSingle().then(({ data }: any) => {
      if (!cancelled) setCountry(hostunicoCountry(data?.hostunico_country, contact.phone));
    });
    return () => { cancelled = true; };
  }, [contact?.id, contact?.phone]);
  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  useEffect(() => { setSelectedId(null); setNotesOpen(false); setReviewRequest(null); }, [contact?.id]);
  const selected = useMemo(() => listings.find((l) => l.id === selectedId) ?? listings[0] ?? null, [listings, selectedId]);
  const facts = hostunicoProperty(selected);
  const reviewRequested = !!selected && reviewRequest?.listingId === selected.id && reviewRequest.contactId === contact?.id;
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
        await refreshHostunicoReports(
          offset => reportAction('prepare_queue', { campaign_id: campaignId, contact_id: contact?.id, offset }),
          (totals, checking) => setAhead(`${totals.ready} ready ahead${totals.preparing ? `, ${totals.preparing} preparing` : ''}${totals.needsDetails ? `, ${totals.needsDetails} need details` : ''}${totals.failed ? `, ${totals.failed} need review` : ''}${checking ? ', checking next reports' : ''}`),
          () => cancelled,
        );
      } catch { if (!cancelled) setAhead('Reports ahead could not refresh.'); }
      finally { running = false; }
    }
    void prepare();
    const timer = window.setInterval(() => void prepare(), 45000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [campaignId, contact?.id]);

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50" data-testid="dialer-sa-panel">
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <aside id="hostunico-call-sidebar" aria-label="Property, report and call controls" className={`${collapsed ? 'hidden' : 'flex'} absolute inset-y-0 left-0 z-20 w-[300px] max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r bg-slate-50 lg:static lg:z-auto xl:w-[320px]`}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-white px-3"><p className="min-w-0 flex-1 truncate text-sm font-semibold" title={contact?.name}>{contact?.name || 'Choose a lead'}</p><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${callConnected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{callConnected ? 'On call' : 'Ready'}</span><button onClick={() => setCollapsed(true)} aria-label="Hide property and controls" title="Hide property and controls" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"><PanelLeftClose size={16} /></button></div>
        <div ref={onControlsMount} className="shrink-0 p-2" data-testid="hostunico-dialer-controls" />
        {contact && <div className="space-y-3 p-3 pt-0">
          <section className="overflow-hidden rounded-xl border bg-white" aria-label="Property on this call">
            {selected?.photoUrls[0] && <img key={selected.id} src={selected.photoUrls[0]} alt={`SpareRoom advert: ${selected.address}`} className="h-32 w-full object-cover" referrerPolicy="no-referrer" />}
            <div className="space-y-2 p-3">
              <h2 className="text-sm font-semibold">Property on this call</h2>
              {selected?.listingUrl && <a href={selected.listingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1.5 text-xs font-semibold text-blue-800"><ExternalLink size={14} />Open SpareRoom advert</a>}
              {!selected && <HostunicoListingLinks contactId={contact.id} />}
              {listings.length > 1 ? <label className="block text-xs text-slate-500">{listings.length} properties, one contact<select aria-label="Property on this call" value={selected?.id || ''} onChange={(e) => setSelectedId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-2 py-2 text-xs text-slate-900">{listings.map((l) => <option key={l.id} value={l.id}>{l.address}</option>)}</select></label> : <p className="text-sm font-medium">{selected?.address || 'Property details to confirm'}</p>}
              <div className="flex flex-wrap gap-1 text-[11px]">{[facts.layout, facts.bathroom, facts.rent].filter(Boolean).map((fact) => <span key={fact} className="rounded-md bg-slate-100 px-2 py-1">{fact}</span>)}</div>
              <p className="text-[11px] text-slate-500">Whole studio or one-bedroom advert. Report assumptions are labelled.</p>
              {selected?.summary && <details><summary className="cursor-pointer text-xs font-medium">Read advert description</summary><p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-600">{selected.summary}</p></details>}
            </div>
          </section>
          {contact.customFields?.hostunico_internal_test && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Internal rehearsal. These example property details are for testing this call.</p>}
          <SaReportPanel key={`${contact.id}:${selected?.id || 'none'}:${country}`} listing={selected} phone={contact.phone} country={country} contactId={contact.id} contactEmail={contact.email} agentName={callerName} onReportPitch={receivePitch} onReportMobile={receiveMobile} />
          {ahead && <p className="text-[11px] text-slate-500" role="status">{ahead}</p>}
          <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-semibold">Lead country and pricing</summary><label className="mt-2 block text-xs text-slate-600">Lead country<select aria-label="Lead country for pricing" value={country === 'GB' ? 'GB' : 'US'} className="mt-1 w-full rounded-lg border bg-white px-2 py-2" onChange={async (e) => {
            const next = e.target.value;
            if (!selected) return;
            try { await reportAction('country', { listing_id: selected.id, country: next }); setCountry(next); setCountryError(''); } catch { setCountryError('Country was not saved. Please try again.'); }
          }}><option value="GB">United Kingdom (software £29/month)</option><option value="US">Outside UK (software $29/month)</option></select></label>{countryError && <p role="alert" className="mt-2 text-xs text-red-700">{countryError}</p>}</details>
          <details open={notesOpen} onToggle={(event) => setNotesOpen(event.currentTarget.open)} className="rounded-xl border bg-white"><summary className="cursor-pointer p-3 text-xs font-semibold">Contact, notes and outcome</summary>{contactHeader}<SaListingPane contactId={contact.id} selectedId={selected?.id ?? null} onSelect={handleSelect} currentCallId={currentCallId} reviewRequested={reviewRequested} onReviewClosed={() => setReviewRequest(null)} /></details>
        </div>}
      </aside>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[2fr_3fr] md:overflow-hidden" data-testid="hostunico-focus-columns">
        <div className="min-h-[440px] min-w-0 border-r md:min-h-0"><HostunicoScriptPane key={contact?.id || 'no-contact'} listing={selected} agentName={callerName} agentSpeech={agentSpeech} contactName={contact?.name} onEditName={() => { setCollapsed(false); setNotesOpen(true); }} onOpener={setOpener} onMode={setMode} country={country} reportPitch={pitchSnapshot?.listingId === selected?.id && pitchSnapshot?.country === country ? pitchSnapshot.value : null} phone={contact?.phone} reportMobile={mobileSnapshot?.listingId === selected?.id ? mobileSnapshot?.mobile : null} onArrangeCallback={contact && selected ? () => { setCollapsed(false); setNotesOpen(true); setReviewRequest({ contactId: contact.id, listingId: selected.id }); } : undefined} controls={<>
          <button onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed} aria-controls="hostunico-call-sidebar" aria-label={collapsed ? 'Show property and controls' : 'Hide property and controls'} title={collapsed ? 'Show property and controls' : 'Hide property and controls'} className="flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border bg-slate-50 text-xs hover:bg-slate-100 xl:w-auto xl:px-2">{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}<span className="hidden xl:inline">Property</span></button>
          {callInProgress && onEndCall && <button onClick={onEndCall} className="h-8 shrink-0 rounded-lg bg-red-700 px-2 text-xs font-semibold text-white">End call</button>}
        </>} /></div>
        <section className="flex min-h-[440px] min-w-0 flex-col bg-white md:min-h-0" aria-label="Live AI coach">
          {direction === 'inbound' && <p className="border-b bg-blue-50 p-2 text-xs text-blue-700">They called back. Confirm which property they mean.</p>}
          {contextError && <p role="alert" className="bg-amber-50 p-2 text-xs text-amber-900">{contextError}</p>}
          <div className="min-h-0 flex-1">{contact ? <LiveTranscriptPane key={currentCallId || contact.id} durationSec={liveDurationSec} contactId={contact.id} callId={currentCallId} agentFirstName={callerName} hostunicoCountry={country} hostunicoContext={`${selected?.id || ''}:${mode}:${country}`} hostunicoPhone={contact.phone} hostunicoReportMobile={mobileSnapshot?.listingId === selected?.id ? mobileSnapshot?.mobile : null} onHostunicoSpeech={receiveSpeech} isSaCall propertyOpener={opener} /> : <div className="p-5 text-sm text-slate-500">{emptyState || 'Choose a lead to start. The live coach appears here.'}</div>}</div>
        </section>
      </div>
    </div>
  </div>;
}
