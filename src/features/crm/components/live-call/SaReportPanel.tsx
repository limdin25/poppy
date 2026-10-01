import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { SaListing } from '../../hooks/useSaListings';
import { reportPhoneKind } from '../../../../../supabase/functions/_shared/hostunico-phone';
import HostunicoReportActivity from './HostunicoReportActivity';
import type { HostunicoReportPitch } from '../../lib/hostunicoReportPitch';
import SaEmailPane from './SaEmailPane';
import HostunicoCallMessages from './HostunicoCallMessages';

export async function reportAction(action: string, values: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Please sign in.');
  const status = action === 'status';
  const query = new URLSearchParams({ action, listing_id: String(values.listing_id ?? '') });
  const response = await fetch(`/api/crm/sa-report${status ? `?${query}` : ''}`, {
    method: status ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    ...(status ? {} : { body: JSON.stringify({ action, ...values }) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not complete this report action.');
  return result;
}

interface ReportState {
  stage: string; message?: string; reportUrl?: string; smsStatus?: string; receivedAt?: string; mobile?: string;
  property?: { postcode: string; bedrooms: number; bathrooms: number; advertisedRentPcm?: number; areaEstimate?: boolean; areaLabel?: string };
  reportPitch?: HostunicoReportPitch | null;
  smsDraft?: string; smsBlocked?: boolean; contactBlocked?: boolean; eligibilityBlocked?: boolean;
}
export default function SaReportPanel({ listing, phone, contactId, contactEmail, agentName = 'Pedro', country = 'GB', onReportPitch, onReportMobile }: { listing: SaListing | null; phone?: string; contactId?: string; contactEmail?: string; agentName?: string; country?: string; onReportPitch?: (listingId: string, country: string, pitch: HostunicoReportPitch | null) => void; onReportMobile?: (listingId: string, mobile: string) => void }) {
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [messageVersion, setMessageVersion] = useState(0);
  const [report, setReport] = useState<ReportState | null>(null);
  const [postcode, setPostcode] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [rent, setRent] = useState('');
  const [whole, setWhole] = useState(false);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobile, setMobile] = useState(reportPhoneKind(phone) === 'mobile' ? phone || '' : '');
  const [savedMobile, setSavedMobile] = useState(mobile);
  const [mobileConfirmed, setMobileConfirmed] = useState(false);
  const refresh = useCallback(async () => {
    if (!listing) return;
    return reportAction('status', { listing_id: listing.id });
  }, [listing?.id]);
  const loadActivity = useCallback(() => reportAction('activity', { listing_id: listing?.id }), [listing?.id]);
  useEffect(() => {
    if (listing) onReportPitch?.(listing.id, country, report?.stage === 'ready' ? report.reportPitch ?? null : null);
  }, [listing?.id, country, report?.stage, report?.reportPitch, onReportPitch]);
  useEffect(() => {
    if (listing) onReportMobile?.(listing.id, savedMobile);
  }, [listing?.id, savedMobile, onReportMobile]);
  useEffect(() => {
    let cancelled = false;
    setReport(null); setError(''); setPermission(false); setWhole(false);
    setPostcode(''); setBedrooms(listing?.bedrooms ? String(listing.bedrooms) : ''); setBathrooms(listing?.bathrooms ? String(listing.bathrooms) : '');
    setRent(listing?.rentPcm ? String(listing.rentPcm) : '');
    async function load(first = false) {
      try {
        const result = await refresh();
        if (cancelled || !result) return;
        setReport(result);
        if (first && result.property) {
          setPostcode(result.property.areaEstimate ? '' : result.property.postcode); setBedrooms(String(result.property.bedrooms)); setBathrooms(String(result.property.bathrooms)); setWhole(!result.property.areaEstimate);
          if (result.property.advertisedRentPcm) setRent(String(result.property.advertisedRentPcm));
          if (result.stage === 'needs_details' && result.property.areaEstimate) {
            await reportAction('prepare_current', { listing_id: listing!.id });
            const prepared = await refresh();
            if (!cancelled) setReport(prepared);
          }
        }
        if (first && result.mobile) { setMobile(result.mobile); setSavedMobile(result.mobile); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load report.'); }
    }
    void load(true);
    const timer = window.setInterval(() => void load(), 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refresh, listing?.id]);
  async function act(action: 'prepare' | 'send_sms' | 'received' | 'retry') {
    if (!listing || busy) return;
    setBusy(true); setError('');
    try {
      const result = await reportAction(action, { listing_id: listing.id, permission, replace: true, property: { postcode, bedrooms: Number(bedrooms), bathrooms: Number(bathrooms), wholeProperty: whole, ...(rent ? { advertisedRentPcm: Number(rent) } : {}) } });
      setReport(await refresh());
      if (action === 'send_sms') setMessageVersion((v) => v + 1);
      if (result.warning) setError(result.warning);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete action.'); }
    finally { setBusy(false); }
  }
  if (!listing) return <section className="rounded-xl border bg-white p-3" aria-label="Report and inbox"><h2 className="text-sm font-semibold">Report and inbox</h2><p className="mt-2 text-xs text-amber-800">No eligible property is attached yet. Choose a property before preparing or sending its report.</p>{contactId && <HostunicoCallMessages contactId={contactId} />}</section>;
  const needsDetails = report?.stage === 'needs_details';
  const area = report?.property?.areaEstimate;
  const studio = /studio/i.test(listing.propertyType || listing.address);
  const alreadySent = !!report?.smsStatus && report.smsStatus !== 'unsent';
  const canText = !!savedMobile && mobile === savedMobile && report?.smsBlocked === false && report?.eligibilityBlocked === false;
  return <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Property report">
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div><h2 className="text-sm font-semibold">{report?.reportPitch?.planning ? 'Initial property report' : area ? 'Area estimate' : 'Property report'}</h2><p className="text-xs text-slate-500" role="status">{report?.message || (report?.stage === 'ready' ? 'Report ready to send' : 'Checking report...')}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {report?.stage === 'review' && !alreadySent && <button disabled={busy} onClick={() => void act('retry')} className="rounded-lg border px-3 py-2 text-xs font-medium">Retry research</button>}
        {report?.reportUrl && <a href={`${report.reportUrl}?preview=1`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-xs font-medium">Preview report</a>}
      </div>
    </div>
    {area && <details className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><summary className="cursor-pointer font-medium">Area estimate: assumptions to confirm</summary><p className="mt-2">For {report.property?.areaLabel || report.property?.postcode}. Assumes a whole home with {report.property?.bedrooms} bedroom(s) and {report.property?.bathrooms} bathroom(s). These details and the full postcode are unconfirmed. A room's advertised rent is not a whole-home comparison.</p></details>}
    {studio && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Studio advertised. The report uses a labelled one-bedroom area comparison, not a studio earnings forecast. Record the confirmed postcode and bathroom count in Property notes for a studio assessment.</p>}
    <details open={needsDetails} className="mt-3"><summary className="text-xs font-medium cursor-pointer">{area ? 'Collect missing details and replace estimate' : 'Confirm or correct property details'}</summary><div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-xs">Full postcode<input aria-label="Full postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="mt-1 block w-28 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Bedrooms<input type="number" min="1" max="12" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="mt-1 block w-20 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Bathrooms<input type="number" min="1" max="12" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="mt-1 block w-20 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Advertised rent / month<input type="number" min="1" value={rent} onChange={(e) => setRent(e.target.value)} className="mt-1 block w-28 rounded-lg border px-2 py-2 text-sm" /></label>
      <button disabled={busy || !whole || studio} onClick={() => void act('prepare')} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{needsDetails ? 'Prepare report' : 'Replace estimate'}</button>
    </div><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />The lead confirmed these details describe the whole property, not a room.</label><p className="mt-2 text-xs text-slate-500">Replacing creates a new report. A report already shared keeps its original assumptions.</p></details>
    <div className="mt-3 border-t pt-3" aria-label="Report message composer">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Send report</h3><div className="flex rounded-lg bg-slate-100 p-1" aria-label="Message channel">{(['sms', 'email'] as const).map((value) => <button key={value} aria-pressed={channel === value} onClick={() => setChannel(value)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${channel === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{value === 'sms' ? 'SMS' : 'Email'}</button>)}</div></div>
      {report?.reportUrl ? <a href={`${report.reportUrl}?preview=1`} target="_blank" rel="noreferrer" className="mt-2 block break-all rounded-lg bg-blue-50 p-2 text-xs font-medium text-blue-800" aria-label="Report link included in the message">{report.reportUrl}</a> : <p className="mt-2 text-xs text-slate-500">The report link will appear here when ready.</p>}
      {report?.contactBlocked && <p role="alert" className="mt-2 text-xs text-red-700">This lead has asked not to be contacted. Sending is blocked.</p>}
      {report?.eligibilityBlocked && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{report.message} Choose the next qualified lead.</p>}
      {channel === 'sms' && <>
      {report?.smsDraft && <label className="mt-2 block text-xs font-medium text-slate-600">Ready-made SMS<textarea aria-label="Ready-made report SMS" readOnly value={report.smsDraft} rows={6} className="mt-1 w-full resize-y rounded-lg border bg-slate-50 p-2 text-xs leading-relaxed text-slate-900" /></label>}
      {report?.smsBlocked && !report.contactBlocked && <p role="alert" className="mt-2 text-xs text-red-700">SMS is blocked: this contact has a do-not-text preference.</p>}
    {!alreadySent && <div className="mt-3 space-y-2">
      <label className="block text-xs font-semibold">Mobile to receive the report<input aria-label="Mobile to receive the report" type="tel" autoComplete="off" value={mobile} onChange={(e) => { setMobile(e.target.value); setPermission(false); setMobileConfirmed(false); }} placeholder="Ask for their mobile number" className="mt-1 w-full rounded-lg border px-2 py-2 text-sm" /></label>
      {!savedMobile && <p className="text-xs text-amber-800">This number is a landline or not confirmed as mobile. Ask for their mobile, read it back, or choose Email above.</p>}
      {mobile !== savedMobile && <><label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={mobileConfirmed} onChange={(e) => setMobileConfirmed(e.target.checked)} />They confirmed this is their mobile number.</label><button disabled={busy || !mobileConfirmed} onClick={async () => {
        if (!listing) return;
        setBusy(true); setError('');
        try { const result = await reportAction('recipient', { listing_id: listing.id, mobile, mobile_confirmed: mobileConfirmed }); setMobile(result.mobile); setSavedMobile(result.mobile); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save their mobile.'); } finally { setBusy(false); }
      }} className="rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-40">Save confirmed mobile</button></>}
      <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" disabled={!canText} checked={permission} onChange={(e) => setPermission(e.target.checked)} />They agreed to receive this report{savedMobile ? ` at ${savedMobile}` : ' by SMS'}.</label>
      <button onClick={() => void act('send_sms')} disabled={busy || !canText || !permission || report?.stage !== 'ready'} className="w-full rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Working...' : 'Send report by SMS'}</button>
    </div>}
    {alreadySent && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>SMS status: <b>{report?.smsStatus?.replaceAll('_', ' ')}</b></span>{report?.receivedAt ? <span className="text-green-700">They confirmed receipt</span> : <button disabled={busy || report?.contactBlocked || ['sending', 'check_inbox'].includes(report?.smsStatus || '')} onClick={() => void act('received')} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">They confirmed receipt</button>}</div>}
      </>}
      {channel === 'email' && <SaEmailPane key={`${contactId}:${listing.id}:${report?.reportUrl || ''}:${country}`} contactId={contactId} contactEmail={contactEmail} listing={listing} agentFirstName={agentName} reportUrl={report?.reportUrl} country={country} requireReport blocked={report?.contactBlocked !== false || report?.eligibilityBlocked !== false} onSent={() => setMessageVersion((v) => v + 1)} />}
    </div>
    {contactId && <HostunicoCallMessages key={contactId} contactId={contactId} refreshVersion={messageVersion} />}
    {report?.reportUrl && <HostunicoReportActivity load={loadActivity} />}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </section>;
}
