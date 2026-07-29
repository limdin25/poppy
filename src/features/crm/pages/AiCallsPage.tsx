// Listen back to the AI caller's calls, and read what was said.
//
// Hugo, 2026-07-29: "can you please build on the CRM there on the history...
// where I can listen to all the calls recordings because I wanna listen to the
// calls as well."
//
// Before this, every call left a WAV and a transcript on the VPS and nowhere
// else, so the only way Hugo could hear one was to ask me to read it to him.
// That is the wrong owner for the single artefact that says whether the thing
// is working.
//
// Deliberately its own page, NOT bolted onto Call history. That page reads
// wk_calls, which is the human dialler on Twilio; this reads wk_ai_called,
// which is the outbound AI campaign. Same shape on screen, two different
// systems underneath, and merging them would mean one query that understands
// both.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import {
  Bot, PhoneOff, Voicemail, PhoneMissed, CheckCircle2, CalendarCheck,
  Clock, Loader2, Search,
} from 'lucide-react';

type Turn = { who?: string; text?: string; at?: number };

type AiCall = {
  e164: string;
  campaign: string;
  business: string | null;
  claimed_at: string;
  finished_at: string | null;
  outcome: string | null;
  duration_s: number | null;
  turns: number | null;
  final_stage: string | null;
  booked_slot: string | null;
  hangup_cause: string | null;
  error: string | null;
  recording_path: string | null;
  transcript: Turn[] | null;
};

// How each ending should read at a glance. The wording matters: "answerphone"
// is the honest word for what half of these calls actually were, and calling
// them anything softer would flatter the numbers.
const OUTCOMES: Record<string, { label: string; icon: typeof Bot; tone: string }> = {
  completed: { label: 'Ran to the end', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  answering_machine: { label: 'Answerphone', icon: Voicemail, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  far_end_hungup: { label: 'They hung up', icon: PhoneOff, tone: 'text-rose-700 bg-rose-50 border-rose-200' },
  no_answer: { label: 'No answer', icon: PhoneMissed, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
  went_quiet: { label: 'Silence / hold music', icon: Clock, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
  dial_failed: { label: 'Never connected', icon: PhoneMissed, tone: 'text-slate-600 bg-slate-50 border-slate-200' },
  crashed: { label: 'Crashed', icon: PhoneOff, tone: 'text-rose-700 bg-rose-50 border-rose-200' },
  error: { label: 'Error', icon: PhoneOff, tone: 'text-rose-700 bg-rose-50 border-rose-200' },
};

function outcomeOf(o: string | null) {
  return OUTCOMES[o ?? ''] ?? {
    label: o ?? 'Unknown', icon: Bot,
    tone: 'text-slate-600 bg-slate-50 border-slate-200',
  };
}

function secs(n: number | null) {
  if (!n && n !== 0) return '-';
  return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`;
}

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AiCallsPage() {
  const [calls, setCalls] = useState<AiCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [audio, setAudio] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('');
  const [only, setOnly] = useState<'all' | 'talked'>('all');

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await (supabase.from('wk_ai_called' as any) as any)
        .select('e164,campaign,business,claimed_at,finished_at,outcome,duration_s,turns,'
          + 'final_stage,booked_slot,hangup_cause,error,recording_path,transcript')
        .order('claimed_at', { ascending: false })
        .limit(500);
      if (!alive) return;
      if (error) console.error('AI calls load failed', error);
      setCalls((data ?? []) as AiCall[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // The bucket is private, because these are recordings of people who did not
  // ask to be recorded. So the URL is minted on demand and expires, rather than
  // the audio sitting on a guessable public path.
  const play = useCallback(async (call: AiCall) => {
    if (!call.recording_path || audio[call.e164]) return;
    const { data, error } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(call.recording_path, 60 * 60);
    if (error || !data?.signedUrl) {
      console.error('signed url failed', error);
      return;
    }
    setAudio((a) => ({ ...a, [call.e164]: data.signedUrl }));
  }, [audio]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return calls.filter((c) => {
      // "Someone actually spoke" is the view worth having: two thirds of any
      // batch are answerphones and no-answers, and scrolling past them to find
      // the three real conversations is the whole job.
      if (only === 'talked' && (c.outcome === 'answering_machine'
        || c.outcome === 'no_answer' || (c.turns ?? 0) < 2)) return false;
      if (!q) return true;
      return (c.business ?? '').toLowerCase().includes(q)
        || c.e164.includes(q)
        || (c.outcome ?? '').toLowerCase().includes(q);
    });
  }, [calls, filter, only]);

  const talked = calls.filter((c) => c.outcome !== 'answering_machine'
    && c.outcome !== 'no_answer' && (c.turns ?? 0) >= 2).length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Bot className="h-6 w-6 text-slate-700" />
        <h1 className="text-2xl font-black tracking-tight text-slate-900">AI calls</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Every outbound call Maria has made. Press play to listen, or open one to read it.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Business, number or outcome"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm
                       focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <button
          onClick={() => setOnly(only === 'all' ? 'talked' : 'all')}
          className={`px-3 py-2 rounded-lg border text-sm font-medium transition ${
            only === 'talked'
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          Someone spoke ({talked})
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading calls
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          No calls match that.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((c) => {
            const o = outcomeOf(c.outcome);
            const Icon = o.icon;
            const isOpen = open === c.e164;
            return (
              <div key={c.e164} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button
                  onClick={() => { setOpen(isOpen ? null : c.e164); if (!isOpen) play(c); }}
                  className="w-full flex items-center gap-3 p-3 sm:p-4 text-left hover:bg-slate-50 transition"
                >
                  <span className={`shrink-0 h-9 w-9 rounded-lg border grid place-items-center ${o.tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900 truncate">
                      {c.business || c.e164}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {c.e164} · {when(c.claimed_at)} · {secs(c.duration_s)}
                      {c.turns ? ` · ${c.turns} turns` : ''}
                      {c.final_stage ? ` · got to "${c.final_stage}"` : ''}
                    </span>
                  </span>
                  {c.booked_slot && (
                    <span className="shrink-0 hidden sm:flex items-center gap-1 text-xs font-semibold
                                     text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1">
                      <CalendarCheck className="h-3 w-3" /> {c.booked_slot}
                    </span>
                  )}
                  <span className={`shrink-0 text-xs font-medium rounded-md border px-2 py-1 ${o.tone}`}>
                    {o.label}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 p-3 sm:p-4 bg-slate-50/60">
                    {c.recording_path ? (
                      audio[c.e164] ? (
                        <audio controls src={audio[c.e164]} className="w-full mb-3" preload="none" />
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
                          <Loader2 className="h-3 w-3 animate-spin" /> Fetching audio
                        </div>
                      )
                    ) : (
                      <p className="text-sm text-slate-500 mb-3">
                        No recording. The call never connected, so there was nothing to record.
                      </p>
                    )}

                    {/* The recording is only the FAR END. Our own voice is not
                        captured, so the transcript is the only place her side
                        exists, and saying so stops it reading like a fault. */}
                    <p className="text-xs text-slate-400 mb-3">
                      The audio is their side of the line. Maria's words are in the transcript below.
                    </p>

                    {c.transcript && c.transcript.length > 0 ? (
                      <div className="space-y-1.5">
                        {c.transcript.map((t, i) => {
                          const mine = (t.who ?? '').startsWith('ai');
                          return (
                            <div key={i} className={`flex gap-2 text-sm ${mine ? '' : 'flex-row-reverse'}`}>
                              <span className={`rounded-lg px-3 py-2 max-w-[80%] ${
                                mine ? 'bg-white border border-slate-200 text-slate-800'
                                     : 'bg-slate-900 text-white'}`}>
                                {t.text}
                                {t.who === 'ai_truncated' && (
                                  <span className="block text-[11px] mt-1 text-amber-600">
                                    cut off here, they spoke over her
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Nothing was said.</p>
                    )}

                    {(c.hangup_cause || c.error) && (
                      <p className="mt-3 text-xs text-slate-400">
                        {c.hangup_cause && <>Ended: {c.hangup_cause}. </>}
                        {c.error && <>Error: {c.error}</>}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
