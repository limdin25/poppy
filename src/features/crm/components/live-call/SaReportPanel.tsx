import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { SaListing } from '../../hooks/useSaListings';

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
  stage: string; message?: string; reportUrl?: string; smsStatus?: string; receivedAt?: string;
  property?: { postcode: string; bedrooms: number; bathrooms: number; advertisedRentPcm?: number; areaEstimate?: boolean; areaLabel?: string };
}
export default function SaReportPanel({ listing, phone, onEmail }: { listing: SaListing | null; phone?: string; onEmail?: (url: string) => void }) {
  const [report, setReport] = useState<ReportState | null>(null);
  const [postcode, setPostcode] = useState('');
  const [bedrooms, setBedrooms] = useState('');
  const [bathrooms, setBathrooms] = useState('');
  const [rent, setRent] = useState('');
  const [whole, setWhole] = useState(false);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!listing) return;
    return reportAction('status', { listing_id: listing.id });
  }, [listing?.id]);
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
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load report.'); }
    }
    void load(true);
    const timer = window.setInterval(() => void load(), 8000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refresh, listing?.id]);
  async function act(action: 'prepare' | 'send_sms' | 'received') {
    if (!listing || busy) return;
    setBusy(true); setError('');
    try {
      const result = await reportAction(action, { listing_id: listing.id, permission, replace: true, property: { postcode, bedrooms: Number(bedrooms), bathrooms: Number(bathrooms), wholeProperty: whole, ...(rent ? { advertisedRentPcm: Number(rent) } : {}) } });
      setReport(await refresh());
      if (result.warning) setError(result.warning);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete action.'); }
    finally { setBusy(false); }
  }
  if (!listing) return null;
  const needsDetails = report?.stage === 'needs_details';
  const area = report?.property?.areaEstimate;
  const alreadySent = !!report?.smsStatus && report.smsStatus !== 'unsent';
  return <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Property report">
    <div className="flex flex-wrap items-center gap-3 justify-between">
      <div><h2 className="text-sm font-semibold">{area ? 'Area estimate' : 'Property report'}</h2><p className="text-xs text-slate-500" role="status">{report?.stage === 'ready' ? area ? 'Area estimate ready. Confirm the assumptions.' : 'Report ready' : report?.message || 'Checking report...'}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {report?.reportUrl && <a href={report.reportUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-xs font-medium">View report</a>}
        {report?.reportUrl && onEmail && <button onClick={() => onEmail(report.reportUrl!)} className="rounded-lg border px-3 py-2 text-xs font-medium">Email instead</button>}
        <button onClick={() => void act('send_sms')} disabled={busy || !permission || report?.stage !== 'ready' || alreadySent} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Working...' : alreadySent ? 'Report SMS submitted' : 'Send report by SMS'}</button>
      </div>
    </div>
    {area && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Area illustration for {report.property?.areaLabel || report.property?.postcode}. Assumes a whole home with {report.property?.bedrooms} bedroom(s) and {report.property?.bathrooms} bathroom(s). These details and the full postcode are unconfirmed. A room's advertised rent is not a whole-home comparison.</p>}
    <details open={needsDetails} className="mt-3"><summary className="text-xs font-medium cursor-pointer">{area ? 'Collect missing details and replace estimate' : 'Confirm or correct property details'}</summary><div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-xs">Full postcode<input aria-label="Full postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="mt-1 block w-28 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Bedrooms<input type="number" min="1" max="12" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="mt-1 block w-20 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Bathrooms<input type="number" min="1" max="12" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="mt-1 block w-20 rounded-lg border px-2 py-2 text-sm" /></label>
      <label className="text-xs">Advertised rent / month<input type="number" min="1" value={rent} onChange={(e) => setRent(e.target.value)} className="mt-1 block w-28 rounded-lg border px-2 py-2 text-sm" /></label>
      <button disabled={busy || !whole} onClick={() => void act('prepare')} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{needsDetails ? 'Prepare report' : 'Replace estimate'}</button>
    </div><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />The lead confirmed these details describe the whole property, not a room.</label><p className="mt-2 text-xs text-slate-500">Replacing creates a new report. A report already shared keeps its original assumptions.</p></details>
    {!alreadySent && <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />They agreed to receive this report at {phone || 'their contact number'}.</label>}
    {alreadySent && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><span>SMS status: <b>{report?.smsStatus?.replaceAll('_', ' ')}</b></span>{report?.receivedAt ? <span className="text-green-700">They confirmed receipt</span> : <button disabled={busy || ['sending', 'check_inbox'].includes(report?.smsStatus || '')} onClick={() => void act('received')} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">They confirmed receipt</button>}<a href="/admin/crm/inbox" className="text-blue-700 underline">Open inbox</a></div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </section>;
}
