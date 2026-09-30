import { hostunicoPriceCopy } from '../../../../../supabase/functions/_shared/hostunico-pricing';
import { useEffect, useRef, useState } from 'react';
import { HOSTUNICO_ANSWERS } from '../../../../../supabase/functions/_shared/hostunico-sales';
import type { SaListing } from '../../hooks/useSaListings';
import { hostunicoProperty } from '../../lib/hostunicoProperty';
import CallTextSizeControls, { useCallTextSize } from './CallTextSizeControls';

type Mode = 'spareroom' | 'facebook' | 'followup';
export default function HostunicoScriptPane({ listing, agentName, onOpener, onMode, country = 'GB' }: { onMode?: (mode: Mode) => void; country?: string; listing: SaListing | null; agentName: string; onOpener: (line: string) => void }) {
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
      ? `Hi, it's ${agentName || 'Pedro'} from Hostunico. You enquired about managing your property through Airbnb. Is now a good time for a quick chat?`
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
    ['Start here', opener, 'Wait for the answer. Keep it conversational.'],
    ['Check the timing', mode === 'spareroom' ? 'When would it be ready to let? And are you the owner, or managing it for the owner?' : 'Can you tell me about the property and when you would like to start?', 'This queue is for whole-property studios and one-bedroom homes. If the advert turns out to be a room or house share, record it and move on.'],
    ['Offer something useful', 'The reason I am calling is that we help owners manage short stays through Airbnb. I can send you an area estimate showing possible earnings and costs compared with your current rent. It labels the assumptions, and we can refine it with your property details. Would that be useful?', 'Ask for the yes. Estimated earnings depend on the property, permissions, demand and costs.'],
    ['Send the report', 'This first estimate uses area assumptions. Can I confirm the full postcode, bedrooms and bathrooms for the whole property? What mobile number or email should I send the link to?', 'If this is a landline, enter their mobile in Send report. Read it back and confirm permission before sending.'],
    ['Confirm and follow up', 'I am sending it now. Could you check if you have received the link?', 'Say this after sending. Record receipt. The report has one invitation: Want me to walk you through what onboarding looks like? No need to push the setup on call one.'],
  ];
  return <section className="flex h-full min-h-0 flex-col bg-white" aria-label="Hostunico sales script">
    <header className="border-b p-3 space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 style={{ fontSize: Math.max(16, Math.round(size * 0.6)) }} className="font-semibold">Your script</h2><button className="rounded-lg border px-3 py-1.5 text-xs" onClick={() => setRolling(!rolling)} aria-pressed={rolling}>{rolling ? 'Pause scrolling' : 'Auto-scroll'}</button></div>
      <CallTextSizeControls pane="script" size={size} onChange={changeSize} />
      <div className="flex flex-wrap gap-1" aria-label="Choose the call script">{(['spareroom', 'facebook', 'followup'] as const).map((m) => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`rounded-lg px-3 py-2 text-xs font-semibold ${mode === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{m === 'spareroom' ? '1 · SpareRoom' : m === 'facebook' ? '1 · Facebook' : '2 · Review report'}</button>)}</div>
    </header>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6" onWheel={() => setRolling(false)} onTouchStart={() => setRolling(false)}>
      {steps.map(([title, line, note], i) => <article key={title}><p style={secondaryText} className="mb-2 font-bold uppercase tracking-wide text-slate-500">{i + 1}. {title}</p><p style={{ fontSize: size }} className="whitespace-pre-line font-medium leading-relaxed text-slate-900">{line}</p><p style={secondaryText} className="mt-2 leading-relaxed text-slate-500">{note}</p></article>)}
      <details className="rounded-xl border p-3"><summary style={headingText} className="cursor-pointer font-semibold">Quick answers, including price</summary><div className="mt-3 space-y-4">{HOSTUNICO_ANSWERS.map((a) => <div key={a.key}><b style={headingText}>{a.title}</b><p style={{ fontSize: size }} className="mt-1 whitespace-pre-line leading-relaxed">{a.key === 'price' ? hostunicoPriceCopy(country) : a.say}</p></div>)}</div></details>
      <a href="https://hostunico-sales-scripts.briny-scout-0044.chatgpt.site" target="_blank" rel="noreferrer" style={secondaryText} className="block text-blue-700 underline">Open the study guide</a>
    </div>
  </section>;
}
