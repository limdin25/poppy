import { useEffect, useId, useRef, useState } from 'react';
import { hostunicoInstantAnswer } from '../../../../../supabase/functions/_shared/hostunico-sales';
import { splitHostunicoCoach } from '../../../../../supabase/functions/_shared/hostunico-coach';
import CallTextSizeControls, { useCallTextSize } from './CallTextSizeControls';

type Line = { id: string; body: string; speaker: string; ts: string };
type Card = { id: string; body: string; ts: string; status?: string | null };
export default function HostunicoCoachView({ lines, cards, active, offline, connected, opener, country, agentName = 'Pedro', phone, reportMobile }: { lines: Line[]; cards: Card[]; active: boolean; offline: boolean; connected: boolean; opener: string; country: string; agentName?: string; phone?: string; reportMobile?: string | null }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const transcriptId = useId();
  const adviceScroll = useRef<HTMLDivElement>(null);
  const transcriptScroll = useRef<HTMLDivElement>(null);
  const followTranscript = useRef(true);
  const { size, changeSize } = useCallTextSize('coach');
  const secondaryText = { fontSize: Math.max(12, Math.round(size * 0.4)) };
  const labelText = { fontSize: Math.max(11, Math.round(size * 0.35)) };
  const lastCaller = [...lines].reverse().find((line) => line.speaker !== 'agent');
  const lastAgent = [...lines].reverse().find((line) => line.speaker === 'agent');
  const latest = cards.at(-1);
  const instant = lastCaller && (!latest || latest.ts < lastCaller.ts) ? hostunicoInstantAnswer(lastCaller.body, country, { phone, mobile: reportMobile }) : null;
  const current = latest && (!lastCaller || latest.ts >= lastCaller.ts);
  const answer = instant ? { say: instant.say, ask: instant.nextQuestion } : current ? splitHostunicoCoach(latest.body) : { say: '', ask: '' };
  const thinking = !!lastCaller && !instant && (!current || (latest?.status === 'streaming' && (!answer.say || ['...', '\u2026'].includes(answer.say))));
  const earlierCards = current && !instant ? cards.slice(0, -1) : cards;
  useEffect(() => {
    if (adviceScroll.current) adviceScroll.current.scrollTop = 0;
  }, [latest?.id, lastCaller?.id, opener]);
  useEffect(() => {
    const el = transcriptScroll.current;
    if (showTranscript && el && followTranscript.current) el.scrollTop = el.scrollHeight;
  }, [showTranscript, lines]);
  return <div className="flex h-full min-h-0 flex-col bg-[#F5F8F7]">
    <header className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b bg-white px-3" aria-label="Coach controls"><h2 className="whitespace-nowrap text-sm font-semibold">Live coach</h2><span role="status" className={`mr-auto whitespace-nowrap rounded-full px-2 py-1 text-[11px] ${offline ? 'bg-red-50 text-red-700' : connected && active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{offline ? 'Off' : !active ? 'Ready' : connected ? 'Live' : 'Reconnecting'}</span><CallTextSizeControls pane="coach" size={size} onChange={changeSize} /></header>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white" data-testid="hostunico-coach-focus">
        <div ref={adviceScroll} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-atomic="false">
          {offline ? <p style={secondaryText} className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">The AI coach is switched off. Use the script beside you.</p> : <section className="flex min-h-full flex-col border-l-4 border-emerald-500 p-5" data-testid="hostunico-current-answer">
            <p style={labelText} className="mb-3 text-[11px] font-bold uppercase tracking-wide text-emerald-800">{thinking ? 'Listening and preparing' : answer.say ? 'Say this' : 'When they pick up'}</p>
            <p style={{ fontSize: thinking ? Math.max(18, Math.round(size * 0.6)) : size }} className="whitespace-pre-line font-semibold leading-[1.4] tracking-tight text-slate-900" data-testid="hostunico-next-line">{thinking ? 'Give them a moment to finish. Your next line is coming.' : answer.say || opener}</p>
            {answer.ask && <div className="mt-5 border-t border-emerald-100 pt-4"><p style={labelText} className="mb-2 text-[11px] font-bold uppercase tracking-wide text-blue-700">Then ask</p><p style={{ fontSize: size }} className="font-semibold leading-[1.4] text-slate-800" data-testid="hostunico-next-question">{answer.ask}</p></div>}
            <p style={secondaryText} className="mt-auto pt-5 text-xs text-slate-500">{current && latest?.status === 'streaming' ? 'Updating as they speak' : 'Answer, pause, then listen.'}</p>
            {!active && <p style={secondaryText} className="mt-2 text-xs leading-relaxed text-slate-500">The coach listens during your call and shows words you can say. It never speaks to the lead or sends a message.</p>}
          </section>}
        </div>
        {!offline && (lastCaller || lastAgent || earlierCards.length > 0) && <footer className="max-h-[25%] shrink-0 space-y-2 overflow-y-auto border-t bg-slate-50 px-3 py-2" aria-label="Recent speech and earlier suggestions">
          <div className="grid grid-cols-2 gap-3">
            {lastAgent && <div className="min-w-0" data-testid="hostunico-recent-agent-speech"><p style={labelText} className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{agentName} just said</p><p style={secondaryText} className="line-clamp-2 text-xs leading-relaxed text-slate-500" title={lastAgent.body}>{lastAgent.body}</p></div>}
            {lastCaller && <div className="min-w-0"><p style={labelText} className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">They just said</p><p style={secondaryText} className="line-clamp-2 text-xs leading-relaxed text-slate-500" title={lastCaller.body}>{lastCaller.body}</p></div>}
          </div>
          {earlierCards.length > 0 && <details><summary style={secondaryText} className="cursor-pointer text-xs font-medium text-slate-500">Earlier suggestions ({earlierCards.length})</summary><div className="mt-2 space-y-2">{[...earlierCards].reverse().map((card) => <p style={secondaryText} className="border-t pt-2 text-xs leading-relaxed text-slate-500" key={card.id}>{splitHostunicoCoach(card.body).say}</p>)}</div></details>}
        </footer>}
      </div>
      <section className={`flex min-h-0 shrink-0 flex-col border-t bg-slate-50 ${showTranscript ? 'basis-1/2' : ''}`} aria-label="Call transcript" data-testid="hostunico-transcript-drawer">
        <button onClick={() => { followTranscript.current = true; setShowTranscript(!showTranscript); }} aria-expanded={showTranscript} aria-controls={transcriptId} className="flex h-9 w-full shrink-0 items-center justify-between bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"><span>{showTranscript ? 'Hide transcript' : 'Show live transcript'}</span><span>{lines.length} lines</span></button>
        {showTranscript && <div id={transcriptId} ref={transcriptScroll} onScroll={(e) => { const el = e.currentTarget; followTranscript.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }} className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t p-3">{lines.length ? lines.map((line) => <p key={line.id} style={secondaryText} className="text-xs leading-relaxed text-slate-600"><b>{line.speaker === 'agent' ? agentName : 'Lead'}: </b>{line.body}</p>) : <p style={secondaryText} className="text-xs text-slate-500">The transcript starts when the call connects.</p>}</div>}
      </section>
    </div>
  </div>;
}
