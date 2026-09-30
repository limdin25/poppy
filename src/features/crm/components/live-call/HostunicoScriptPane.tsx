import { hostunicoPriceCopy } from '../../../../../supabase/functions/_shared/hostunico-pricing';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { HOSTUNICO_ANSWERS } from '../../../../../supabase/functions/_shared/hostunico-sales';
import type { SaListing } from '../../hooks/useSaListings';
import { hostunicoProperty } from '../../lib/hostunicoProperty';
import CallTextSizeControls, { useCallTextSize } from './CallTextSizeControls';
import { hostunicoReportHook, type HostunicoReportPitch } from '../../lib/hostunicoReportPitch';

type Mode = 'spareroom' | 'facebook' | 'followup';
export default function HostunicoScriptPane({ listing, agentName, onOpener, onMode, country = 'GB', reportPitch, controls }: { onMode?: (mode: Mode) => void; country?: string; listing: SaListing | null; agentName: string; onOpener: (line: string) => void; reportPitch?: HostunicoReportPitch | null; controls?: ReactNode }) {
  const [mode, setMode] = useState<Mode>('spareroom');
  const [rolling, setRolling] = useState(false);
  const { size, changeSize } = useCallTextSize('script');
  const secondaryText = { fontSize: Math.max(12, Math.round(size * 0.5)) };
  const headingText = { fontSize: Math.max(14, Math.round(size * 0.6)) };
  const scroll = useRef<HTMLDivElement>(null);
  const property = hostunicoProperty(listing);
  const { place } = property;
  const rent = property.rent ? ` at ${property.rent}` : '';
  const opener = mode === 'spareroom'
    ? `Hi, it's ${agentName || 'Pedro'} from Hostunico. I saw your ${property.description} in ${place}${rent} on SpareRoom. Is it still available?`
    : mode === 'facebook'
      ? `Hi, it's ${agentName || 'Pedro'} from Hostunico. You enquired about managing your property through Airbnb. Is the property still available?`
      : `Hi, it's ${agentName || 'Pedro'} from Hostunico. Have you had a chance to look at the property report? What did you think of the numbers?`;
  useEffect(() => { onOpener(opener); }, [opener, onOpener]);
  useEffect(() => { onMode?.(mode); }, [mode, onMode]);
  useEffect(() => { setRolling(false); scroll.current?.scrollTo(0, 0); }, [mode, listing?.id]);
  useEffect(() => {
    if (!rolling) return;
    const timer = window.setInterval(() => {
      const el = scroll.current;
      if (!el || el.scrollTop + el.clientHeight >= el.scrollHeight - 1) { setRolling(false); return; }
      el.scrollTop += 1;
    }, 65);
    return () => window.clearInterval(timer);
  }, [rolling]);
  const steps = mode === 'followup' ? [
    ['Listen first', opener, 'Not read it? Offer to go through it together. Questions? Answer them first. A no? Thank them and record it.'],
    ['Confirm the price', hostunicoPriceCopy(country), 'Check that the fee and separate costs are clear.'],
    ['Prepare the property', 'If you would like to go ahead, can I ask a few questions so we can give you a clear setup checklist?', 'When is it available? Who can authorise this? Are the lease, mortgage, building and local permissions checked?'],
    ['Find what is missing', 'Is it furnished and ready for guests? Do you have current photos, a way for guests to get in, and a cleaner? Do you already have an Airbnb account?', 'Owner keeps their Airbnb account. Pedro records needs; Elsie and the team handle operations.'],
    ['Agree the next step', 'What still needs doing, what budget do you have for setup, and when do you think it could be ready? I will send you the checklist with the next steps.', 'Record each missing item and its date. Arrange the agreement and owner login through onboarding. Confirm launch only after checks.'],
  ] : [
    ['Start here', opener, 'Wait for the answer. Keep it conversational. This queue is for whole-property studios and one-bedroom homes. If it turns out to be a room or house share, mark unsuitable and move on.'],
    ['Give the comparison, then ask', hostunicoReportHook(reportPitch), 'Use only the figures in this property report. Keep area and studio comparison assumptions clear. Respect a no.'],
    ['After yes, confirm where to send it', 'What mobile number or email should I send the link to?', 'If this is a landline, enter their mobile in Send report. Read the number or email back. Check the recipient, advert photo and correct report, then press Send yourself. If the report is preparing, send only when it is ready.'],
    ['After the send succeeds', 'I have sent the report link. Could you check if you have received it?', 'Use this line only after a successful manual send. Record receipt. The report has one invitation: Want me to walk you through what onboarding looks like?'],
    ['Optional details after permission', 'If you have a moment, can I confirm any missing property details so we can refine the estimate?', 'Ask only for missing facts, such as full postcode, bedrooms and bathrooms. Keep unknowns labelled. After permission, if useful, ask when it would be ready to let and whether they are the owner or authorised manager. Do not hold up the first hook with these questions.'],
  ];
  return <section className="flex h-full min-h-0 flex-col bg-white" aria-label="Hostunico sales script">
    <header className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2" aria-label="Script controls">
      {controls}
      <h2 className="sr-only">Your script</h2>
      <select aria-label="Choose the call script" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="h-8 min-w-0 flex-1 rounded-lg border bg-white py-1 pl-2 pr-5 text-xs font-semibold">
        <option value="spareroom">1. SpareRoom</option><option value="facebook">1. Facebook</option><option value="followup">2. Review report</option>
      </select>
      <button title={rolling ? 'Pause scrolling' : 'Auto-scroll'} aria-label={rolling ? 'Pause scrolling' : 'Auto-scroll'} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${rolling ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`} onClick={() => setRolling(!rolling)} aria-pressed={rolling}>{rolling ? <Pause size={14} /> : <Play size={14} />}</button>
      <CallTextSizeControls pane="script" size={size} onChange={changeSize} />
    </header>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6" onWheel={() => setRolling(false)} onTouchStart={() => setRolling(false)}>
      {steps.map(([title, line, note], i) => <article key={title}><p style={secondaryText} className="mb-2 font-bold uppercase tracking-wide text-slate-500">{i + 1}. {title}</p><p style={{ fontSize: size }} className="whitespace-pre-line font-medium leading-relaxed text-slate-900">{line}</p><p style={secondaryText} className="mt-2 leading-relaxed text-slate-500">{note}</p></article>)}
      <details className="rounded-xl border p-3"><summary style={headingText} className="cursor-pointer font-semibold">Quick answers, including price</summary><div className="mt-3 space-y-4">{HOSTUNICO_ANSWERS.map((a) => <div key={a.key}><b style={headingText}>{a.title}</b><p style={{ fontSize: size }} className="mt-1 whitespace-pre-line leading-relaxed">{a.key === 'price' ? hostunicoPriceCopy(country) : a.say}</p></div>)}</div></details>
      <a href="https://hostunico-sales-scripts.briny-scout-0044.chatgpt.site" target="_blank" rel="noreferrer" style={secondaryText} className="block text-blue-700 underline">Open the study guide</a>
    </div>
  </section>;
}
