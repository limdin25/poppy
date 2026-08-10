import { useCallback, useEffect, useState } from 'react';
import TrainingVideoCard, { type TrainingVideoData } from './TrainingVideoCard';
import TrainingQuiz from './TrainingQuiz';

/**
 * /hugo-training, the owner's copy of the caller training page.
 *
 * Same videos, none of the discipline: nothing is gated, nothing he watches is
 * recorded, and the whole question bank is readable with its answers. It is a
 * review tool, not a test.
 *
 * THE PIN IS NOT IN THIS FILE, AND MUST NEVER BE. Pedro's page compares 1176 in
 * the browser because that PIN is harmless and public. This one cannot: it
 * opens the answer key, and Pedro knows how to open devtools. So the PIN typed
 * here is posted to the server and the server decides. The browser is only ever
 * told yes or no. See api/lib/training-hugo.ts.
 */
export default function HugoTrainingPage() {
  const [pin, setPin] = useState('');
  const [unlockedPin, setUnlockedPin] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionData | null>(null);
  const [answers, setAnswers] = useState<AnswerKey | null>(null);
  const [tab, setTab] = useState<'videos' | 'answers' | 'practice'>('answers');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Training review, owner copy';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive, nosnippet';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  // The PIN survives a refresh within the tab, never longer, and never in
  // localStorage: it is the key to the answers.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(UNLOCK_KEY);
      if (saved) void attempt(saved, true);
    } catch { /* blocked, he re-enters it */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async (p: string) => {
    setLoadError(null);
    try {
      const [s, a] = await Promise.all([
        fetch('/api/hugo-training/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: p }),
        }).then((r) => r.json()),
        fetch('/api/hugo-training/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: p }),
        }).then((r) => r.json()),
      ]);
      if (!s.ok || !a.ok) throw new Error(s.error || a.error || 'Could not load');
      setSession(s);
      setAnswers(a);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the training');
    }
  }, []);

  async function attempt(candidate: string, silent = false) {
    setChecking(true);
    setPinError(null);
    try {
      const res = await fetch('/api/hugo-training/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: candidate }),
      });
      if (res.status === 401) {
        if (!silent) setPinError('Wrong PIN, try again.');
        try { sessionStorage.removeItem(UNLOCK_KEY); } catch { /* ignore */ }
        setPin('');
        return;
      }
      if (!res.ok) throw new Error(`Could not check the PIN (${res.status})`);
      setUnlockedPin(candidate);
      try { sessionStorage.setItem(UNLOCK_KEY, candidate); } catch { /* ignore */ }
      await load(candidate);
    } catch (e) {
      if (!silent) setPinError(e instanceof Error ? e.message : 'Could not check the PIN');
    } finally {
      setChecking(false);
    }
  }

  // ------------------------------------------------------------- the gate
  if (!unlockedPin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F4] px-4">
        <form
          onSubmit={(e) => { e.preventDefault(); void attempt(pin.trim()); }}
          className="w-full max-w-xs rounded-2xl border border-[#E5E7EB] bg-white p-7 text-center shadow-sm"
        >
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[#EEF2F8] text-lg text-[#3C5A87]">
            🔒
          </div>
          <h1 className="mb-1 text-[17px] font-bold text-[#1A1A1A]">Enter PIN</h1>
          <p className="mb-5 text-[13px] text-[#6B7280]">Owner copy. Different PIN to the caller page.</p>
          <input
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(null); }}
            inputMode="numeric"
            autoFocus
            placeholder="••••"
            className="mb-3 h-12 w-full rounded-xl border border-[#E5E7EB] bg-white text-center font-mono text-[20px] tracking-[8px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none focus:ring-2 focus:ring-[#3C5A87]/30"
          />
          {pinError && <p className="mb-3 text-[13px] text-[#B42318]">{pinError}</p>}
          <button
            type="submit"
            disabled={checking}
            className="h-11 w-full rounded-xl bg-[#3C5A87] text-[15px] font-semibold text-white hover:bg-[#33507a] disabled:opacity-60"
          >
            {checking ? 'Checking' : 'Unlock'}
          </button>
        </form>
      </div>
    );
  }

  const videos = session?.videos ?? [];
  const requiredCount = session?.counts.required ?? 0;
  const optionalCount = session?.counts.optional ?? 0;

  return (
    <div className="min-h-screen bg-[#F7F7F4] px-4 py-8 print:bg-white print:py-0 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="print:hidden">
          <p className="text-[11px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">
            Owner copy
          </p>
          <h1 className="mt-1 text-[26px] font-extrabold leading-tight text-[#1A1A1A] sm:text-[30px]">
            What Pedro is being taught, and tested on
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#4B5563]">
            Everything on his page, with nothing locked and every answer shown.
            Watch anything in any order, nothing here is recorded against him.
            {session && (
              <>
                {' '}
                <b>{requiredCount} required</b> videos, <b>{optionalCount} optional</b>,
                and <b>{session.counts.questionsInBank} questions</b> in the bank.
                He gets a random <b>{session.quiz.questionCount}</b> of them,{' '}
                <b>{session.quiz.secondsPerQuestion} seconds</b> each, pass mark{' '}
                <b>{session.quiz.passPct}%</b>.
              </>
            )}
          </p>
          <p className="mt-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] leading-relaxed text-[#92400E]">
            This page has a different PIN to Pedro's on purpose. If he could open
            it he would have every answer, and the timed test next door would
            stop meaning anything. Do not give him this PIN or this link.
          </p>
        </header>

        {loadError && (
          <div className="rounded-2xl border border-[#F0C9C9] bg-[#FDF5F5] p-5 text-[14px] text-[#B42318]">
            {loadError}
            <button onClick={() => void load(unlockedPin)} className="ml-2 font-semibold underline">
              Try again
            </button>
          </div>
        )}

        <nav className="flex gap-2 print:hidden">
          {([
            ['answers', 'Questions and answers'],
            ['videos', 'The videos'],
            ['practice', 'Try it yourself'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              data-testid={`hugo-tab-${key}`}
              onClick={() => setTab(key)}
              className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition ${
                tab === key
                  ? 'bg-[#3C5A87] text-white'
                  : 'border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#FAFAF8]'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* ------------------------------------------------ the answer key */}
        {tab === 'answers' && answers && (
          <section data-testid="hugo-answer-key" className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-[#E5E7EB] bg-white px-5 py-3 print:hidden">
              <span className="text-[13px] text-[#6B7280]">
                All {answers.total} questions, grouped by where they came from.
              </span>
              <button
                onClick={() => window.print()}
                className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-[12.5px] font-semibold text-[#374151] hover:bg-[#FAFAF8]"
              >
                Print
              </button>
            </div>

            {answers.groups.map((g) => (
              <div key={g.source} className="rounded-2xl border border-[#E5E7EB] bg-white p-5">
                <h2 className="text-[11px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">
                  {g.label} · {g.questions.length} question
                  {g.questions.length === 1 ? '' : 's'}
                </h2>
                <ol className="mt-3 space-y-4">
                  {g.questions.map((q, i) => (
                    <li key={q.id} className="border-t border-[#F1F2F4] pt-3 first:border-0 first:pt-0">
                      <p className="text-[14px] font-semibold leading-snug text-[#1A1A1A]">
                        {i + 1}. {q.prompt}
                        {q.kind === 'short' && (
                          <span className="ml-2 rounded bg-[#EEF2F8] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#3C5A87]">
                            typed answer
                          </span>
                        )}
                      </p>
                      <p className="mt-1.5 rounded-lg bg-[#F2FAF4] px-3 py-2 text-[13.5px] leading-snug text-[#1F6B36]">
                        <b>Answer:</b> {q.answer}
                      </p>
                      {q.distractors.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 pl-4">
                          {q.distractors.map((d, j) => (
                            <li key={j} className="list-disc text-[12.5px] leading-snug text-[#9CA3AF]">
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#6B7280]">
                        {q.explanation}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        )}

        {/* ---------------------------------------------------- the videos */}
        {tab === 'videos' && (
          <section data-testid="hugo-videos" className="space-y-4 print:hidden">
            {videos.map((v, i) => (
              <TrainingVideoCard
                key={v.key}
                index={i}
                video={{ ...v, pct: 0 }}
                pin={unlockedPin}
                watchedThreshold={100}
                onProgress={() => {}}
                tracked={false}
              />
            ))}
          </section>
        )}

        {/* ------------------------------------------------ practice round */}
        {tab === 'practice' && session && (
          <section data-testid="hugo-practice" className="print:hidden">
            <p className="mb-3 text-[13px] leading-relaxed text-[#6B7280]">
              The same questions Pedro gets, drawn at random, but with no timer
              and nothing to unlock first. Your attempts are filed separately and
              never show up as his.
            </p>
            <TrainingQuiz
              pin={unlockedPin}
              secondsPerQuestion={0}
              passPct={session.quiz.passPct}
              endpoint="/api/hugo-training/practice"
              onFinished={() => {}}
            />
          </section>
        )}
      </div>
    </div>
  );
}

const UNLOCK_KEY = 'hugo_training_pin';

interface SessionData {
  ok: boolean;
  videos: TrainingVideoData[];
  counts: { required: number; optional: number; questionsInBank: number };
  quiz: {
    questionCount: number;
    secondsPerQuestion: number;
    passPct: number;
    watchedThreshold: number;
  };
}

interface AnswerKey {
  ok: boolean;
  total: number;
  groups: Array<{
    source: string;
    label: string;
    questions: Array<{
      id: string;
      kind: 'mc' | 'short';
      prompt: string;
      answer: string;
      distractors: string[];
      explanation: string;
    }>;
  }>;
}
