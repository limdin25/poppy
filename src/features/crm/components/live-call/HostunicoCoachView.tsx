import { useState } from 'react';
import { hostunicoInstantAnswer } from '../../../../../supabase/functions/_shared/hostunico-sales';
import { splitHostunicoCoach } from '../../../../../supabase/functions/_shared/hostunico-coach';

type Line = { id: string; body: string; speaker: string; ts: string };
type Card = { id: string; body: string; ts: string; status?: string | null };
export default function HostunicoCoachView({ lines, cards, active, offline, connected, opener, country }: { lines: Line[]; cards: Card[]; active: boolean; offline: boolean; connected: boolean; opener: string; country: string }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const lastCaller = [...lines].reverse().find((line) => line.speaker !== 'agent');
  const latest = cards.at(-1);
  const instant = lastCaller && (!latest || latest.ts < lastCaller.ts) ? hostunicoInstantAnswer(lastCaller.body, country) : null;
  const current = latest && (!lastCaller || latest.ts >= lastCaller.ts);
  const answer = instant ? { say: instant.say, ask: instant.nextQuestion } : current ? splitHostunicoCoach(latest.body) : { say: '', ask: '' };
  const thinking = !!lastCaller && !instant && (!current || (latest?.status === 'streaming' && (!answer.say || ['...', '\u2026'].includes(answer.say))));
  return <div className="flex h-full min-h-0 flex-col bg-[#F5F8F7]">
    <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-white px-4 py-3"><h2 className="font-semibold">Live coach</h2><span role="status" className={`rounded-full px-2 py-1 text-[11px] ${offline ? 'bg-red-50 text-red-700' : connected && active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{offline ? 'Coach switched off' : !active ? 'Ready for your call' : connected ? 'Live' : 'Reconnecting'}</span></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-atomic="false">
      {offline ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">The AI coach is switched off. Use the script beside you.</p> : <>
        {lastCaller && <div className="rounded-xl border bg-white p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">They just said</p><p className="text-sm leading-relaxed text-slate-600">{lastCaller.body}</p></div>}
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm" data-testid="hostunico-current-answer">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-emerald-800">{thinking ? 'Listening and preparing' : answer.say ? 'Say this' : 'When they pick up'}</p>
          <p className="whitespace-pre-line text-[22px] font-semibold leading-[1.5] tracking-tight text-slate-900">{thinking ? 'Give them a moment to finish. Your next line is coming.' : answer.say || opener}</p>
          {answer.ask && <div className="mt-5 border-t border-emerald-100 pt-4"><p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-blue-700">Then ask</p><p className="text-[19px] font-medium leading-relaxed text-slate-800">{answer.ask}</p></div>}
          <p className="mt-4 text-xs text-slate-500">{latest?.status === 'streaming' ? 'Updating as they speak' : 'Answer, pause, then listen.'}</p>
        </section>
        {!active && <p className="text-xs leading-relaxed text-slate-500">The coach listens during your call and shows words you can say. It never speaks to the lead or sends a message.</p>}
        {cards.length > 1 && <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-medium text-slate-500">Earlier suggestions ({cards.length - 1})</summary><div className="mt-3 space-y-3">{cards.slice(0, -1).reverse().map((card) => <p className="border-t pt-2 text-sm text-slate-500" key={card.id}>{splitHostunicoCoach(card.body).say}</p>)}</div></details>}
      </>}
      <section className="rounded-xl border bg-white"><button onClick={() => setShowTranscript(!showTranscript)} aria-expanded={showTranscript} className="flex w-full items-center justify-between p-3 text-xs font-medium text-slate-600"><span>{showTranscript ? 'Hide transcript' : 'Show live transcript'}</span><span>{lines.length} lines</span></button>{showTranscript && <div className="space-y-3 border-t p-3">{lines.length ? lines.map((line) => <p key={line.id} className="text-sm leading-relaxed"><b>{line.speaker === 'agent' ? 'You' : 'Lead'}: </b>{line.body}</p>) : <p className="text-xs text-slate-500">The transcript starts when the call connects.</p>}</div>}</section>
    </div>
  </div>;
}
