import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import { useSaListings } from '../../hooks/useSaListings';
import { useCurrentAgent } from '../../hooks/useCurrentAgent';
import { hostunicoCountry } from '../../../../../supabase/functions/_shared/hostunico-pricing';
import SaReportPanel from '../live-call/SaReportPanel';
import HostunicoListingLinks from './HostunicoListingLinks';

type ReportContact = { id: string; name?: string | null; phone?: string | null; email?: string; customFields?: Record<string, any> };
export function HostunicoReportContent({ contact }: { contact: ReportContact }) {
  const { listings, loading, error } = useSaListings(contact.id);
  const { firstName } = useCurrentAgent();
  const [selectedId, setSelectedId] = useState<string>(contact.customFields?.hostunico_listing_id || '');
  const selected = listings.find((listing) => listing.id === selectedId) || listings[0] || null;
  const country = hostunicoCountry(contact.customFields?.hostunico_country, contact.phone || '');
  if (loading) return <p role="status" className="p-4 text-sm">Loading saved property reports...</p>;
  if (error) return <p role="alert" className="p-4 text-sm text-red-700">Could not load the properties. Close and try again.</p>;
  return <div className="space-y-3 p-4">
    {listings.length > 0 && <label className="block text-xs font-medium">Property report to send<select className="mt-1 w-full rounded-lg border bg-white p-2 text-sm" value={selected?.id || ''} onChange={(event) => setSelectedId(event.target.value)}>{listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.address}</option>)}</select></label>}
    <SaReportPanel key={`${contact.id}:${selected?.id}:${country}`} listing={selected} contactId={contact.id} phone={contact.phone || ''} contactEmail={contact.email} agentName={firstName || 'Pedro'} country={country} />
  </div>;
}

export default function HostunicoReportButton({ contact }: { contact: ReportContact }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  return <>
    <HostunicoListingLinks contactId={contact.id} />
    <button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border bg-white px-2 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50" title="Open saved report and ready-made SMS"><FileText size={13} />Report / SMS</button>
    {open && createPortal(<div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/40 p-3" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Property report and SMS" className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-xl">
      <header className="flex items-center justify-between border-b bg-white p-4"><div><h2 className="font-semibold">Report and SMS</h2><p className="text-xs text-slate-500">{contact.name || contact.phone}</p></div><button type="button" autoFocus aria-label="Close property report" onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button></header>
      <div className="overflow-y-auto"><HostunicoReportContent key={contact.id} contact={contact} /></div>
    </section></div>, document.body)}
  </>;
}
