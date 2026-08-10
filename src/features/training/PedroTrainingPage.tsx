import { useCallback, useEffect, useState } from 'react';
import TrainingVideoCard, { type TrainingVideoData } from './TrainingVideoCard';
import TrainingQuiz from './TrainingQuiz';
import { TRAINING_PIN } from '../../../api/lib/training';

/**
 * /pedro-training, the PIN-gated training page for the property cold caller.
 *
 * Public route, no login, same gate as /script and /blueprint. Three videos he
 * has to watch, a bonus one he does not, then a timed test that stays locked
 * until the three are done.
 *
 * NOT INDEXED, AND NOT TO BE SHARED. The videos are three lessons out of a paid
 * course Hugo bought, re-hosted for one contractor. The robots meta below and
 * the Disallow in public/robots.txt are both deliberate, and the mp4s are served
 * as short-lived signed URLs from a PRIVATE bucket rather than public files.
 *
 * The PIN is imported from api/lib/training so the page and the API routes
 * cannot drift apart. It is not a secret: it is in the client bundle by design,
 * and nothing behind it can change anything that matters.
 */
/** Which round this page is. /pedro-training is round one and always will be:
 *  it is the record of what he was actually tested on. /pedro-training/v2 is
 *  the round after the script was rewritten on 2026-08-10, and it starts every
 *  video unwatched and the quiz locked again.
 *
 *  Read off the pathname rather than a router param because this page is
 *  mounted as a flat top-level route, outside every layout and guard. Two path
 *  segments also mean the apex VSL catch-all cannot swallow it: that rewrite
 *  only ever matches a single segment, the same reason /join/property works. */
const ROUND = typeof window !== 'undefined' && /\/pedro-training\/v2\/?$/.test(window.location.pathname) ? 2 : 1;

export default function PedroTrainingPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pctByKey, setPctByKey] = useState<Record<string, number>>({});

  // Keep this page out of search results even if the URL ever leaks. React
  // owns the head here (there is no SSR), so the tag is added on mount and
  // removed on unmount so it cannot leak onto the rest of the app.
  useEffect(() => {
    document.title = 'Property calls, training';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive, nosnippet';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(UNLOCK_KEY) === '1') {
        setUnlocked(true);
        void load();
      }
    } catch { /* sessionStorage blocked, he just re-enters the PIN */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/pedro-training/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: TRAINING_PIN, round: ROUND }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Could not load (${res.status})`);
      setSession(json);
      const next: Record<string, number> = {};
      for (const v of json.videos as SessionVideo[]) next[v.key] = v.pct;
      setPctByKey(next);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the training');
    } finally {
      setLoading(false);
    }
  }, []);

  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim() !== TRAINING_PIN) {
      setPinError('Wrong PIN, try again.');
      setPin('');
      return;
    }
    setUnlocked(true);
    try { sessionStorage.setItem(UNLOCK_KEY, '1'); } catch { /* ignore */ }
    void load();
  };

  const onProgress = useCallback((key: string, pct: number) => {
    setPctByKey((prev) => (prev[key] === pct ? prev : { ...prev, [key]: pct }));
  }, []);

  // ------------------------------------------------------------- the gate
  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F7F4] px-4">
        <form
          onSubmit={submitPin}
          className="w-full max-w-xs rounded-2xl border border-[#E5E7EB] bg-white p-7 text-center shadow-sm"
        >
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl bg-[#EEF2F8] text-lg text-[#3C5A87]">
            🔒
          </div>
          <h1 className="mb-1 text-[17px] font-bold text-[#1A1A1A]">Enter PIN</h1>
          <p className="mb-5 text-[13px] text-[#6B7280]">This page is protected.</p>
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
            className="h-11 w-full rounded-xl bg-[#3C5A87] text-[15px] font-semibold text-white hover:bg-[#33507a]"
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  // --------------------------------------------------------------- loaded
  const videos = session?.videos ?? [];
  const required = videos.filter((v) => v.required);
  const threshold = session?.quiz.watchedThreshold ?? 95;
  const doneCount = required.filter((v) => (pctByKey[v.key] ?? v.pct) >= threshold).length;
  const allWatched = required.length > 0 && doneCount === required.length;

  return (
    <div className="min-h-screen bg-[#F7F7F4] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header>
          <p className="text-[11px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">
            Internal training
          </p>
          <h1 className="mt-1 text-[26px] font-extrabold leading-tight text-[#1A1A1A] sm:text-[30px]">
            Ringing estate agents about houses
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#4B5563]">
            Watch the required videos, then take the test. Everything in here is
            what your call script is built on, so if you know this, the script
            reads itself. Do not share this page or these videos with anyone.
          </p>
        </header>

        {loading && (
          <div className="rounded-2xl border border-[#E5E7EB] bg-white p-8 text-center text-[14px] text-[#6B7280]">
            Loading your training.
          </div>
        )}
        {loadError && (
          <div className="rounded-2xl border border-[#F0C9C9] bg-[#FDF5F5] p-5 text-[14px] text-[#B42318]">
            {loadError}
            <button onClick={() => void load()} className="ml-2 font-semibold underline">
              Try again
            </button>
          </div>
        )}

        {session && (
          <>
            <div
              data-testid="training-progress"
              className="flex items-center gap-3 rounded-2xl border border-[#E5E7EB] bg-white px-5 py-4"
            >
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-[#1A1A1A]">
                  {doneCount} of {required.length} videos complete
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#EEF0F4]">
                  <div
                    className="h-full rounded-full bg-[#2E7D43] transition-all"
                    style={{ width: `${required.length ? (doneCount / required.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-[11.5px] font-bold ${
                  allWatched ? 'bg-[#E7F5EC] text-[#2E7D43]' : 'bg-[#F3F4F6] text-[#6B7280]'
                }`}
              >
                {allWatched ? 'Test unlocked' : 'Test locked'}
              </span>
            </div>

            {videos.map((v, i) => (
              <TrainingVideoCard
                key={v.key}
                index={i}
                video={v}
                pin={TRAINING_PIN}
                watchedThreshold={threshold}
                onProgress={onProgress}
              />
            ))}

            <section className="pt-2">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">
                The test
              </h2>
              {allWatched ? (
                <TrainingQuiz
                  pin={TRAINING_PIN}
                  round={ROUND}
                  secondsPerQuestion={session.quiz.secondsPerQuestion}
                  passPct={session.quiz.passPct}
                  onFinished={() => void load()}
                />
              ) : (
                <div
                  data-testid="quiz-locked"
                  className="rounded-2xl border border-dashed border-[#D8DBE0] bg-white p-6 text-center"
                >
                  <div className="text-[24px]">🔒</div>
                  <p className="mt-2 text-[15px] font-semibold text-[#1A1A1A]">
                    The test unlocks when all {required.length} required videos are watched
                  </p>
                  <p className="mt-1 text-[13px] text-[#6B7280]">
                    {doneCount} of {required.length} done. Skipping through does not
                    count, only the parts you actually play.
                  </p>
                </div>
              )}
              {session.quiz.lastAttempt && (
                <p className="mt-3 text-center text-[12px] text-[#9CA3AF]">
                  Last attempt: {session.quiz.lastAttempt.pct}% (
                  {session.quiz.lastAttempt.score} of {session.quiz.lastAttempt.total})
                </p>
              )}
            </section>

            <footer className="pt-4 text-center text-[11.5px] leading-relaxed text-[#9CA3AF]">
              These lessons are licensed course material, kept here for one person.
              Not to be downloaded, forwarded, posted or shared.
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

const UNLOCK_KEY = 'pedro_training_unlocked';

interface SessionVideo extends TrainingVideoData {
  watchedSec: number;
  completed: boolean;
}

interface SessionData {
  ok: boolean;
  videos: SessionVideo[];
  quiz: {
    unlocked: boolean;
    watchedThreshold: number;
    questionCount: number;
    secondsPerQuestion: number;
    passPct: number;
    lastAttempt: { pct: number; score: number; total: number; submitted_at: string } | null;
  };
}
