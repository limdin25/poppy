import { useEffect, useState } from 'react';

type Event = { event: string; section: string; occurred_at: string };
export type Activity = { opens: number; lastOpenedAt: string | null; activeSeconds: number; onboardingOpened: boolean; events: Event[] };
const names: Record<string, string> = { report: 'Report', comparison: 'Rent and earnings comparison', fees: 'Fees', costs: 'Other costs', aircover: 'AirCover', evidence: 'Market evidence', methodology: 'Assumptions', onboarding: 'Onboarding walkthrough', readiness: 'Property checks', agreement: 'Management agreement', airbnb: 'Their Airbnb account', setup: 'Guest setup', launch: 'Launch approval', advert: 'SpareRoom advert', airbnb_cover: 'Airbnb AirCover details', airbnb_evidence: 'Airbnb comparable property', privacy: 'Privacy information' };
export function activityLabel(event: Event) {
  const section = names[event.section] || 'Report section';
  if (event.event === 'report_open') return 'Opened the report';
  if (event.event === 'onboarding_open') return 'Opened the onboarding walkthrough';
  if (event.event === 'onboarding_step') return `Onboarding: ${section}`;
  if (event.event === 'link_click') return `Clicked: ${section}`;
  return `${event.event === 'section_open' ? 'Expanded' : 'Viewed'}: ${section}`;
}
export default function HostunicoReportActivity({ load }: { load: () => Promise<{ activity: Activity }> }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false, running = false;
    setActivity(null); setError(false);
    async function refresh() {
      if (running) return;
      running = true;
      try { const result = await load(); if (!cancelled) { setActivity(result.activity); setError(false); } }
      catch { if (!cancelled) setError(true); }
      finally { running = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [load]);
  return <details className="mt-3 rounded-lg border bg-slate-50 p-2" aria-label="Report activity">
    <summary className="cursor-pointer text-xs font-semibold">Report activity{activity ? `: ${activity.opens} ${activity.opens === 1 ? 'open' : 'opens'}${activity.onboardingOpened ? ', onboarding viewed' : ''}` : ''}</summary>
    <div className="mt-2 space-y-2 text-xs">
      {error && <p role="status" className="text-amber-800">Activity could not refresh. Trying again shortly.</p>}
      {!error && !activity && <p>Loading activity...</p>}
      {activity && <><p className="text-slate-600">{activity.lastOpenedAt ? `Last opened ${new Date(activity.lastOpenedAt).toLocaleString('en-GB')}.` : 'No tracked opens yet.'} {activity.activeSeconds > 0 ? `${Math.round(activity.activeSeconds / 60)} min of recent visible reading time.` : ''}</p>
        <ol className="space-y-2">{activity.events.map((event, i) => <li key={`${event.occurred_at}:${i}`}><span className="font-medium">{activityLabel(event)}</span><time className="ml-1 text-slate-500" dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol>
        <p className="text-[11px] text-slate-500">Activity belongs to this link and can include someone it was forwarded to. Staff previews are excluded. Paused tracking or blocked scripts may leave gaps. External link clicks show the destination, not what happens on another website.</p></>}
    </div>
  </details>;
}
