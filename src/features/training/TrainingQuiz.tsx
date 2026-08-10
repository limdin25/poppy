import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The timed test.
 *
 * Rules Hugo set, and why each one is here:
 *   - A warning screen first. He should know the clock starts when he presses
 *     the button, not discover it on question one.
 *   - 30 seconds a question, counting down where he can see it.
 *   - Time up means the question is gone, marked unanswered, next one up.
 *   - One question at a time, no back button, no review until the end.
 *   - Only the CURRENT question is in the DOM. The rest are in memory, not on
 *     the page, so there is nothing to read ahead.
 *   - The order is randomised by the server, and so is the order of the answers
 *     inside each question, so two attempts never look the same.
 *
 * That combination is the defence against looking an answer up mid-test. It is
 * meant to be proportionate, not airtight: 30 seconds is simply not long enough
 * to ask somebody else, and that is the whole idea.
 */

interface Question {
  kind: 'mc' | 'short';
  prompt: string;
  options?: string[];
}

interface ResultRow {
  prompt: string;
  kind: string;
  given: string;
  answered: boolean;
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

interface Props {
  pin: string;
  /** 0 turns the clock off entirely: no countdown, no auto-advance. Used by
   *  Hugo's practice run, never by Pedro's real one. */
  secondsPerQuestion: number;
  passPct: number;
  onFinished: () => void;
  /** Which route grades it. Defaults to Pedro's, which is the gated one. */
  endpoint?: string;
  /** Which training round this sitting belongs to. The server gates on it, so
   *  round two cannot be unlocked by round one's watched videos. */
  round?: number;
}

type Phase = 'warning' | 'running' | 'grading' | 'done';

/** What the real, timed test gives you. Quoted on Hugo's untimed practice run
 *  so he knows what Pedro is actually up against. */
const QUIZ_REAL_SECONDS = 30;

export default function TrainingQuiz({
  pin, secondsPerQuestion, passPct, onFinished, round = 1,
  endpoint = '/api/pedro-training/quiz',
}: Props) {
  const timed = secondsPerQuestion > 0;
  const [phase, setPhase] = useState<Phase>('warning');
  const [error, setError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(secondsPerQuestion);
  const [typed, setTyped] = useState('');
  const [score, setScore] = useState<{ score: number; total: number; pct: number; passed: boolean } | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);

  const answersRef = useRef<Array<number | string | null>>([]);
  const startedAtRef = useRef(0);
  // Seconds spent on each question, and when the current one appeared. Hugo,
  // 2026-08-10, wants to see where he hesitated, not just what he got wrong: a
  // question answered correctly in 28 of its 30 seconds is a different thing
  // from one answered in four. Timed here because the whole test is two POSTs
  // and per-question round trips would add twenty network waits to a clock
  // somebody is racing.
  const secondsRef = useRef<Array<number | null>>([]);
  const questionShownAtRef = useRef(0);
  const submittingRef = useRef(false);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase('grading');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin,
          action: 'submit',
          attempt_id: attemptId,
          answers: answersRef.current,
          seconds: secondsRef.current,
          duration_sec: Math.round((Date.now() - startedAtRef.current) / 1000),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not submit');
      setScore({ score: json.score, total: json.total, pct: json.pct, passed: json.passed });
      setResults(json.results ?? []);
      setPhase('done');
      onFinished();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
      setPhase('running');
      submittingRef.current = false;
    }
  }, [pin, attemptId, onFinished, endpoint]);

  /** Record an answer and move on. `null` = ran out of time or left blank. */
  const advance = useCallback(
    (answer: number | string | null) => {
      answersRef.current[current] = answer;
      secondsRef.current[current] = questionShownAtRef.current
        ? Math.round((Date.now() - questionShownAtRef.current) / 1000)
        : null;
      questionShownAtRef.current = Date.now();
      setTyped('');
      if (current + 1 >= questions.length) {
        void submit();
      } else {
        setCurrent((c) => c + 1);
        setRemaining(secondsPerQuestion);
      }
    },
    [current, questions.length, secondsPerQuestion, submit],
  );

  // The countdown. One interval, restarted whenever the question changes.
  //
  // It works off a wall-clock deadline rather than by subtracting one each
  // tick, so a busy tab or a throttled background timer cannot buy him extra
  // seconds. The advance is fired from the interval callback, never from inside
  // a setState updater: doing that skipped the hand-off entirely and the timer
  // just sat on 1s (caught by the e2e, 2026-08-10).
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    if (phase !== 'running' || !timed) return;
    setRemaining(secondsPerQuestion);
    const deadline = Date.now() + secondsPerQuestion * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        // Time up: whatever is typed does not count, the question is gone.
        advanceRef.current(null);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, current, secondsPerQuestion, timed]);

  async function begin() {
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, action: 'start', round }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not start');
      setAttemptId(json.attempt_id);
      setQuestions(json.questions ?? []);
      answersRef.current = new Array((json.questions ?? []).length).fill(null);
      secondsRef.current = new Array((json.questions ?? []).length).fill(null);
      startedAtRef.current = Date.now();
      questionShownAtRef.current = Date.now();
      setCurrent(0);
      setPhase('running');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    }
  }

  // ------------------------------------------------------------- warning
  if (phase === 'warning') {
    return (
      <div data-testid="quiz-warning" className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7">
        <h2 className="text-[19px] font-bold text-[#1A1A1A]">
          {timed ? 'Before you start, read this' : 'Practice run, no clock'}
        </h2>
        <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-[#374151]">
          {timed ? (
            <>
              <li>
                <b>The clock starts when you press the button.</b> There is no pausing it and
                no coming back to it later.
              </li>
              <li>
                <b>You get {secondsPerQuestion} seconds per question.</b> You will see the
                countdown on screen.
              </li>
              <li>
                <b>When the time runs out the question goes.</b> It moves straight on to the
                next one and that one counts as wrong.
              </li>
              <li>
                <b>Answer fast, off the top of your head.</b> That is the point. If you have
                watched the videos you already know these.
              </li>
            </>
          ) : (
            <>
              <li>
                <b>No timer on this one.</b> This is your copy, so take as long as you like.
                Pedro gets {QUIZ_REAL_SECONDS} seconds a question.
              </li>
              <li>
                <b>Same questions, drawn at random</b> from the same bank, in a different
                order each time.
              </li>
            </>
          )}
          <li>
            <b>One question at a time, and you cannot go back.</b> You will not see your
            answers until the end.
          </li>
          <li>
            You need <b>{passPct}%</b> to pass. You can take it again if you do not.
          </li>
        </ul>
        {error && <p className="mt-3 text-[13px] text-[#B42318]">{error}</p>}
        <button
          data-testid="quiz-begin"
          onClick={() => void begin()}
          className="mt-5 h-12 w-full rounded-xl bg-[#3C5A87] text-[15px] font-semibold text-white hover:bg-[#33507a]"
        >
          {timed ? 'I am ready, start the test' : 'Start the practice run'}
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- grading
  if (phase === 'grading') {
    return (
      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center text-[14px] text-[#6B7280]">
        Marking your answers.
      </div>
    );
  }

  // ---------------------------------------------------------------- done
  if (phase === 'done' && score) {
    return (
      <div data-testid="quiz-result" className="space-y-4">
        <div
          className={`rounded-2xl border p-5 sm:p-7 text-center ${
            score.passed ? 'border-[#B6DCC2] bg-[#F2FAF4]' : 'border-[#F0C9C9] bg-[#FDF5F5]'
          }`}
        >
          <div className="text-[13px] font-bold uppercase tracking-widest text-[#9CA3AF]">
            Your score
          </div>
          <div
            className={`mt-1 text-[44px] font-extrabold leading-none ${
              score.passed ? 'text-[#2E7D43]' : 'text-[#B42318]'
            }`}
          >
            {score.pct}%
          </div>
          <div className="mt-1 text-[14px] text-[#374151]">
            {score.score} out of {score.total} right.{' '}
            {score.passed ? 'Passed.' : `You need ${passPct}% to pass. Have another go.`}
          </div>
        </div>

        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:p-5">
          <h3 className="text-[15px] font-bold text-[#1A1A1A]">Every answer, and why</h3>
          <ol className="mt-3 space-y-4">
            {results.map((r, i) => (
              <li key={i} className="border-t border-[#F1F2F4] pt-3 first:border-0 first:pt-0">
                <p className="text-[13.5px] font-semibold text-[#1A1A1A]">
                  {i + 1}. {r.prompt}
                </p>
                <p className={`mt-1 text-[13px] ${r.correct ? 'text-[#2E7D43]' : 'text-[#B42318]'}`}>
                  {r.correct
                    ? 'Right.'
                    : r.answered
                      ? `You said: ${r.given}`
                      : 'You ran out of time.'}
                </p>
                {!r.correct && (
                  <p className="mt-0.5 text-[13px] text-[#374151]">
                    <b>Right answer:</b> {r.correctAnswer}
                  </p>
                )}
                <p className="mt-1 text-[12.5px] leading-relaxed text-[#6B7280]">{r.explanation}</p>
              </li>
            ))}
          </ol>
        </div>

        <button
          onClick={() => {
            submittingRef.current = false;
            setScore(null);
            setResults([]);
            setPhase('warning');
          }}
          className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white text-[14px] font-semibold text-[#374151] hover:bg-[#FAFAF8]"
        >
          Take it again
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------- running
  const q = questions[current];
  if (!q) return null;
  const low = remaining <= 10;

  return (
    <div data-testid="quiz-running" className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-widest text-[#9CA3AF]">
          Question {current + 1} of {questions.length}
        </span>
        {timed ? (
          <span
            data-testid="quiz-timer"
            className={`rounded-lg px-3 py-1 text-[15px] font-extrabold tabular-nums ${
              low ? 'bg-[#FDECEC] text-[#B42318]' : 'bg-[#EEF2F8] text-[#3C5A87]'
            }`}
          >
            {remaining}s
          </span>
        ) : (
          <span
            data-testid="quiz-untimed"
            className="rounded-lg bg-[#F3F4F6] px-3 py-1 text-[12px] font-bold text-[#6B7280]"
          >
            No timer
          </span>
        )}
      </div>

      {timed && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#EEF0F4]">
          <div
            className={`h-full rounded-full ${low ? 'bg-[#B42318]' : 'bg-[#3C5A87]'}`}
            style={{ width: `${(remaining / secondsPerQuestion) * 100}%`, transition: 'width 1s linear' }}
          />
        </div>
      )}

      <p data-testid="quiz-prompt" className="mt-4 text-[16px] font-semibold leading-snug text-[#1A1A1A]">
        {q.prompt}
      </p>

      {q.kind === 'mc' ? (
        <div className="mt-4 space-y-2">
          {(q.options ?? []).map((opt, i) => (
            <button
              key={i}
              data-testid="quiz-option"
              onClick={() => advance(i)}
              className="block w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-left text-[14px] leading-snug text-[#1A1A1A] hover:border-[#3C5A87] hover:bg-[#F7F9FC]"
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            advance(typed);
          }}
        >
          <input
            data-testid="quiz-short"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            placeholder="Type your answer"
            className="h-12 flex-1 rounded-xl border border-[#E5E7EB] px-3 text-[15px] text-[#1A1A1A] focus:border-[#3C5A87] focus:outline-none"
          />
          <button
            type="submit"
            className="h-12 rounded-xl bg-[#3C5A87] px-5 text-[14px] font-semibold text-white hover:bg-[#33507a]"
          >
            Next
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-[13px] text-[#B42318]">{error}</p>}
      <p className="mt-4 text-[11.5px] text-[#9CA3AF]">
        No going back. Pick the one you think is right and move on.
      </p>
    </div>
  );
}
