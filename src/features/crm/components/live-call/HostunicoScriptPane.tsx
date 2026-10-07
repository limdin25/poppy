import { hostunicoPriceCopy } from '../../../../../supabase/functions/_shared/hostunico-pricing';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { HOSTUNICO_ANSWERS, hostunicoAnswerCopy } from '../../../../../supabase/functions/_shared/hostunico-sales';
import type { SaListing } from '../../hooks/useSaListings';
import { hostunicoProperty } from '../../lib/hostunicoProperty';
import CallTextSizeControls, { useCallTextSize } from './CallTextSizeControls';
import { hostunicoReportIntroduction, hostunicoReportHook, hostunicoReportRecipient, type HostunicoReportPitch } from '../../lib/hostunicoReportPitch';
import SpokenText from './SpokenText';
import { hostunicoNeedsName } from '../../../../../supabase/functions/_shared/hostunico-contact-name';

type Mode = 'spareroom' | 'facebook' | 'followup';
export default function HostunicoScriptPane({ listing, agentName, onOpener, onMode, country = 'GB', reportPitch, controls, phone, reportMobile, onArrangeCallback, agentSpeech = '', contactName, onEditName }: { onMode?: (mode: Mode) => void; country?: string; listing: SaListing | null; agentName: string; onOpener: (line: string) => void; reportPitch?: HostunicoReportPitch | null; controls?: ReactNode; phone?: string; reportMobile?: string | null; onArrangeCallback?: () => void; agentSpeech?: string; contactName?: string; onEditName?: () => void }) {
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
    ? `Hi, this is ${agentName || 'Pedro'} here. I saw your ${property.description} in ${place}${rent} on SpareRoom. Is it still available?`
    : mode === 'facebook'
      ? `Hi, this is ${agentName || 'Pedro'} here. You enquired about partnering with us for short-term lets through Airbnb. Is the property still available?`
      : `Hi, this is ${agentName || 'Pedro'} here. We spoke about your property and I sent you the earnings report. Have you had a chance to look at it?`;
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
    ['Listen first', opener, 'Use call two only after the report was sent. If they have read it, ask: What did you think of the numbers? Not read it? Offer to go through it together. Questions? Answer them first. A no? Thank them and record it.'],
    ['Confirm the price', hostunicoPriceCopy(country), 'Check that the fee and separate costs are clear.'],
    ['Prepare the property', 'If you would like to go ahead, can I ask a few questions so we can give you a clear setup checklist?', 'When is it available? Who can authorise this? Are the lease, mortgage, building and local permissions checked?'],
    ['Find what is missing', 'Is it furnished and ready for guests? Do you have current photos, a way for guests to get in, and a cleaner? Do you already have an Airbnb account?', 'Owner keeps their Airbnb account. Pedro records needs; Elsie and the team handle operations.'],
    ['Agree the next step', 'What still needs doing, what budget do you have for setup, and when do you think it could be ready? I will send you the checklist with the next steps.', 'Record each missing item and its date. Arrange the agreement and owner login through onboarding. Confirm launch only after checks.'],
  ] : [
    ['Start here', opener, 'Wait for the answer. Keep it conversational. This queue is for whole properties: studios and one, two or three-bedroom homes. If it turns out to be a single room or house share, mark unsuitable and move on.'],
    ['Ask for one minute, then pause', hostunicoReportIntroduction(), 'Wait for their answer before explaining the service or giving figures. If asked who you are with, say Hostunico. Do not claim to be looking for a place to rent. If they are busy, briefly offer to send the earnings report instead. Respect a no.'],
    ['If yes, explain why and give the comparison', hostunicoReportHook(reportPitch), 'Use this report\'s figures. Keep it conversational, then pause for their answer. The report contains the detail; answer questions if they ask.'],
    ...((listing?.bedrooms ?? 0) >= 2 ? [['Make clear we want the whole property', 'Just so you know, ideally we would manage the whole property as one Airbnb listing. We can do it room by room as well, but the whole place is what we prefer.', 'Say this for homes with two or more bedrooms. The report figure is for the whole property. If they would only let it room by room, note that in the contact notes and carry on.']] : []),
    ...(hostunicoNeedsName(contactName, [{ speaker: 'agent', body: agentSpeech }]) ? [['After they agree, if you need their name', "By the way, what's your name?", 'Skip if they already introduced themselves. Save the name with the pencil in Contact, notes and outcome, then confirm where to send the report.']] : []),
    ['After yes, confirm where to send it', hostunicoReportRecipient(phone, reportMobile), 'This line follows the current contact and saved report mobile. Confirm that they can receive texts. For a different number, enter and save their confirmed mobile in Send report. Read it back. If they prefer email, use Email instead.'],
    ['Send the report', 'I will send that over now.', 'Check the recipient, advert photo and correct report, then press Send report by SMS yourself. Tick permission only after they agree. If the report is preparing, say you will send it when ready.'],
    ['After the send succeeds', 'I have sent the report link. Could you check if you have received it?', 'Use this line only after a successful manual send. Record receipt. The message simply says: Let me know what you think.'],
    ['Agree a callback', 'Would tomorrow work for a quick call to talk through the report?', 'If yes, ask: What time suits you? Confirm the day, UK time and number. If tomorrow does not work, ask which day does. Save only the time they actually agree to in Review call booked. This creates a reminder for Pedro, not an automatic call or text.'],
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
      {steps.map(([title, line, note], i) => <article key={title}><p style={secondaryText} className="mb-2 font-bold uppercase tracking-wide text-slate-500">{i + 1}. {title}</p><p style={{ fontSize: size }} className="whitespace-pre-line font-medium leading-relaxed text-slate-900"><SpokenText text={line} spoken={agentSpeech} /></p><p style={secondaryText} className="mt-2 leading-relaxed text-slate-500">{note}</p>{title === 'After they agree, if you need their name' && onEditName && <button onClick={onEditName} className="mt-2 text-sm font-medium text-blue-700 underline">Edit contact name</button>}{title === 'Agree a callback' && onArrangeCallback && <button onClick={onArrangeCallback} className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">Save agreed callback</button>}</article>)}
      <details className="rounded-xl border p-3"><summary style={headingText} className="cursor-pointer font-semibold">Quick answers, including price</summary><div className="mt-3 space-y-2">{HOSTUNICO_ANSWERS.map((a) => <details key={a.key} className="rounded-lg border p-2"><summary style={headingText} className="cursor-pointer font-semibold">{a.title}</summary><p style={{ fontSize: size }} className="mt-2 whitespace-pre-line leading-relaxed">{hostunicoAnswerCopy(a, country)}</p>{a.nextQuestion && <p style={{ fontSize: size }} className="mt-2 font-medium">{a.nextQuestion}</p>}</details>)}</div></details>
      <a href="https://hostunico-sales-scripts.briny-scout-0044.chatgpt.site" target="_blank" rel="noreferrer" style={secondaryText} className="block text-blue-700 underline">Open the study guide</a>
    </div>
  </section>;
}
