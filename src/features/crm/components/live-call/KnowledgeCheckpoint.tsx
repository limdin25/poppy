// The knowledge checkpoint. Every seven calls the room locks and asks one
// question, and it does not unlock until the answer is right.
//
// Hugo 2026-08-12: "bake in an agent knowledge checkpoint every N dials,
// locking the workflow until they answer correctly. Amazing, to make him more
// knowledgeable."
//
// It is deliberately unskippable: no close button, no Escape, no click-outside.
// A wrong answer shows the right one with the reason and asks another. That is
// the whole point, and it is why the questions are multiple choice and short.
//
// The questions and the marking live on the server (api/crm/knowledge-check),
// which reads the same bank the training test is graded against. Nothing about
// the right answer is in this file or in the bundle.

import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Check, X, Loader2, RotateCcw } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

interface Question {
  id: string;
  prompt: string;
  options: string[];
  source?: string;
  /** True when this is one he got wrong before and it has come back round
   *  (Hugo 2026-08-12: wrong answers return after 10 rounds until he gets them
   *  right). Saying so on screen is most of what makes it stick. */
  repeat?: boolean;
}

interface Props {
  /** Ids already asked this shift, so the same question does not repeat. */
  asked: string[];
  /** Called once, with the question id, when the answer is right. */
  onPassed: (questionId: string) => void;
}

export default function KnowledgeCheckpoint({ asked, onPassed }: Props) {
  // Who is answering, so a wrong answer follows the person rather than the
  // browser. Falls back to a fixed key rather than dropping the history.
  const { user } = useAuth();
  const agentKey = user?.id ?? 'unknown';
  const [q, setQ] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<
    { correct: boolean; explanation: string; right: string; repeatAfter: number | null } | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(async (exclude: string[]) => {
    setLoading(true);
    setError(null);
    setPicked(null);
    setResult(null);
    try {
      const res = await fetch('/api/crm/knowledge-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draw', exclude, agentKey }),
      });
      const data = (await res.json()) as Question & { error?: string };
      if (!res.ok || !data.options) {
        setError(data.error ?? 'Could not load the question.');
        return;
      }
      setQ({
        id: data.id,
        prompt: data.prompt,
        options: data.options,
        source: data.source,
        repeat: data.repeat,
      });
    } catch {
      setError('Could not load the question.');
    } finally {
      setLoading(false);
    }
  }, [agentKey]);

  // Deferred by a tick on purpose: draw() sets loading/error state, and doing
  // that synchronously inside an effect body cascades a render (and the lint
  // rule that says so is right).
  useEffect(() => {
    const t = setTimeout(() => void draw(asked), 0);
    return () => clearTimeout(t);
  }, [draw, asked]);

  const submit = async () => {
    if (!q || !picked || checking) return;
    setChecking(true);
    try {
      const res = await fetch('/api/crm/knowledge-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'grade', id: q.id, answer: picked, agentKey }),
      });
      const data = (await res.json()) as {
        correct?: boolean; explanation?: string; right?: string;
        repeatAfter?: number | null; error?: string;
      };
      if (!res.ok) { setError(data.error ?? 'Could not mark that.'); return; }
      setResult({
        correct: !!data.correct,
        explanation: data.explanation ?? '',
        right: data.right ?? '',
        repeatAfter: data.repeatAfter ?? null,
      });
    } catch {
      setError('Could not mark that.');
    } finally {
      setChecking(false);
    }
  };

  // No Escape, no click-outside, no close button. It locks (Hugo 2026-08-12).
  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4"
      data-testid="knowledge-checkpoint"
      role="dialog"
      aria-modal="true"
      aria-label="Knowledge checkpoint"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.3)] overflow-hidden">
        <div className="flex items-center gap-2 bg-[#3C5A87] px-4 py-3 text-white">
          <GraduationCap className="h-4 w-4" />
          <span className="text-[13px] font-bold">Quick check before the next call</span>
        </div>

        <div className="px-5 py-4">
          {loading && (
            <div className="flex items-center gap-2 py-6 text-[13px] text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding a question…
            </div>
          )}

          {error && !loading && (
            <div className="py-4 text-[13px] text-[#B45309]">
              {error}
              <button
                onClick={() => void draw(asked)}
                className="ml-2 font-semibold text-[#3C5A87] hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {q && !loading && (
            <>
              {q.repeat && (
                <p className="mb-2 inline-flex items-center gap-1 rounded bg-[#FFF7ED] px-2 py-1 text-[11px] font-semibold text-[#B45309]">
                  <RotateCcw className="h-3 w-3" />
                  You got this one wrong before. Here it is again.
                </p>
              )}
              <p className="text-[15px] font-semibold leading-snug text-[#1A1A1A]">{q.prompt}</p>

              <div className="mt-3 space-y-2">
                {q.options.map((opt) => {
                  const isPicked = picked === opt;
                  const isRight = result && opt === result.right;
                  const isWrongPick = result && isPicked && !result.correct;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={!!result}
                      onClick={() => setPicked(opt)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-2 text-left text-[13px] leading-snug transition-colors',
                        isRight && 'border-[#2E7D43] bg-[#E8F5EC] text-[#1A1A1A]',
                        isWrongPick && 'border-[#DC2626] bg-[#FEF2F2] text-[#1A1A1A]',
                        !result && isPicked && 'border-[#3C5A87] bg-[#EEF2F8]',
                        !result && !isPicked && 'border-[#E5E7EB] hover:bg-[#F9FAFB]',
                        result && !isRight && !isWrongPick && 'border-[#E5E7EB] text-[#9CA3AF]',
                      )}
                    >
                      <span className="flex items-start gap-2">
                        {isRight && <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#2E7D43]" />}
                        {isWrongPick && <X className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#DC2626]" />}
                        <span>{opt}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {result && (
                <div
                  className={cn(
                    'mt-3 rounded-xl px-3 py-2 text-[12px] leading-snug',
                    result.correct ? 'bg-[#E8F5EC] text-[#1F5C33]' : 'bg-[#FEF2F2] text-[#991B1B]',
                  )}
                  data-testid="knowledge-checkpoint-result"
                >
                  <p className="font-bold">{result.correct ? 'Right.' : 'Not that one.'}</p>
                  <p className="mt-0.5">{result.explanation}</p>
                  {!result.correct && result.repeatAfter && (
                    <p className="mt-1 font-semibold">
                      This one comes back in {result.repeatAfter} checkpoints, and it keeps coming
                      back until you get it right.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                {!result && (
                  <button
                    onClick={() => void submit()}
                    disabled={!picked || checking}
                    data-testid="knowledge-checkpoint-answer"
                    className={cn(
                      'flex-1 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-white transition-colors',
                      !picked || checking ? 'bg-[#9CA3AF]' : 'bg-[#3C5A87] hover:bg-[#31486D]',
                    )}
                  >
                    {checking ? 'Checking…' : 'Answer'}
                  </button>
                )}

                {result?.correct && (
                  <button
                    onClick={() => onPassed(q.id)}
                    data-testid="knowledge-checkpoint-continue"
                    className="flex-1 rounded-xl bg-[#2E7D43] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#276A39]"
                  >
                    Back to the dialer
                  </button>
                )}

                {result && !result.correct && (
                  <button
                    onClick={() => void draw([...asked, q.id])}
                    data-testid="knowledge-checkpoint-retry"
                    className="flex-1 rounded-xl bg-[#3C5A87] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#31486D]"
                  >
                    Another question
                  </button>
                )}
              </div>

              <p className="mt-2 text-[11px] text-[#9CA3AF]">
                One question every few calls. Get it right and you are straight back to dialling.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
