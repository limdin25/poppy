import { GraduationCap, RefreshCw } from 'lucide-react'
import { AdminError } from '../components/AdminError'
import { useAdminApi } from '../hooks/useAdminApi'

/**
 * Admin view of the PIN-gated /pedro-training page.
 *
 * Answers the questions Hugo will actually ask: has he watched them, how much
 * of each, is the test open yet, did he pass, and when. Read only. The trainee
 * side writes through api/pedro-training/*, which is PIN-gated and cannot be reached
 * from here.
 */

interface VideoRow {
  key: string
  title: string
  durationLabel: string
  source: string
  required: boolean
  pct: number
  watchedSec: number
  durationSec: number
  playCount: number
  completedAt: string | null
  lastSeenAt: string | null
}

interface AttemptRow {
  id: string
  status: string
  score: number | null
  total: number | null
  pct: number | null
  passed: boolean | null
  started_at: string
  submitted_at: string | null
  duration_sec: number | null
  round?: number | null
  results: Array<{ prompt: string; correct: boolean; given: string; correctAnswer: string; seconds?: number | null; position?: number | null }> | null
}

interface Payload {
  trainee: string
  watchedThreshold: number
  passPct: number
  quizUnlocked: boolean
  videos: VideoRow[]
  attempts: AttemptRow[]
}

function when(iso: string | null | undefined): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function TrainingPage() {
  const { data, loading, error, refetch } = useAdminApi<Payload>('training', {
    trainee: 'pedro',
    watchedThreshold: 95,
    passPct: 70,
    quizUnlocked: false,
    videos: [],
    attempts: [],
  })

  const required = data.videos.filter((v) => v.required)
  const done = required.filter((v) => v.pct >= data.watchedThreshold).length
  const submitted = data.attempts.filter((a) => a.status === 'submitted')
  const best = submitted.reduce<AttemptRow | null>(
    (acc, a) => (acc == null || (a.pct ?? 0) > (acc.pct ?? 0) ? a : acc),
    null,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <GraduationCap size={20} /> Pedro training
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Live progress on <span className="font-mono">/pedro-training</span>. Watch
            percentages are real playback, not the scrub bar, so skipping ahead earns
            nothing.
          </p>
        </div>
        <button
          onClick={refetch}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink-muted hover:text-ink"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <AdminError error={error} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Videos watched" value={loading ? '...' : `${done} of ${required.length}`} />
        <Stat
          label="Test"
          value={loading ? '...' : data.quizUnlocked ? 'Unlocked' : 'Locked'}
        />
        <Stat
          label="Best score"
          value={
            loading
              ? '...'
              : best?.pct != null
                ? `${best.pct}%${best.passed ? ' (pass)' : ''}`
                : 'not taken'
          }
        />
      </div>

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
          Per video
        </h2>
        <div className="divide-y divide-line">
          {data.videos.map((v) => {
            const complete = v.pct >= data.watchedThreshold
            return (
              <div key={v.key} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    {v.title}
                    {!v.required && (
                      <span className="ml-2 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">
                        optional
                      </span>
                    )}
                    {v.source === 'youtube' && (
                      <span className="ml-2 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-muted">
                        youtube
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-sm font-semibold ${complete ? 'text-success' : 'text-ink-muted'}`}
                  >
                    {v.pct}% watched
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div
                    className={`h-full rounded-full ${complete ? 'bg-success' : 'bg-brand'}`}
                    style={{ width: `${Math.min(100, v.pct)}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">
                  {mmss(v.watchedSec)} of {v.durationLabel} · {v.playCount} play
                  {v.playCount === 1 ? '' : 's'} · finished {when(v.completedAt)} · last opened{' '}
                  {when(v.lastSeenAt)}
                </p>
              </div>
            )
          })}
          {!loading && data.videos.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-muted">Nothing watched yet.</p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
          Test attempts
        </h2>
        <div className="divide-y divide-line">
          {data.attempts.map((a) => (
            <details key={a.id} className="px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="text-sm font-medium text-ink">
                    {a.status === 'submitted'
                      ? `${a.score} of ${a.total} (${a.pct}%)`
                      : 'Started, not finished'}
                  </span>
                  {a.status === 'submitted' && (
                    <span
                      className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        a.passed ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                      }`}
                    >
                      {a.passed ? 'pass' : 'fail'}
                    </span>
                  )}
                  {a.round ? (
                    <span className="ml-2 rounded-md bg-elevated px-2 py-0.5 text-[11px] text-ink-muted">
                      round {a.round}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-muted">
                  {when(a.submitted_at ?? a.started_at)}
                  {a.duration_sec != null ? ` · took ${mmss(a.duration_sec)}` : ''}
                </span>
              </summary>
              {/* Every question, what he answered, and how long he sat on it.
                  Hugo 2026-08-10: "time spent on each answer etc". The blob was
                  already being stored and had never been rendered, so the only
                  thing visible was a final score. A question answered correctly
                  in 28 of its 30 seconds is a different thing from one answered
                  in four, and neither shows up in a percentage. */}
              {a.results && a.results.length > 0 ? (
                <ol className="mt-3 space-y-2">
                  {a.results.map((r, i) => (
                    <li
                      key={i}
                      className={`rounded-lg border p-2.5 text-[12px] ${
                        r.correct ? 'border-line bg-elevated' : 'border-danger/30 bg-danger/5'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">
                          {r.position ?? i + 1}. {r.prompt}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-muted">
                          {r.seconds != null ? `${r.seconds}s` : 'no timing'}
                        </span>
                      </div>
                      <div className="mt-1 text-ink-muted">
                        {r.correct ? 'Right' : 'Wrong'}: {r.given || 'left blank'}
                        {!r.correct && r.correctAnswer ? ` · answer: ${r.correctAnswer}` : ''}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-xs text-ink-muted">
                  No per-question detail on this attempt. Sittings before 2026-08-10 recorded only a score.
                </p>
              )}
            </details>
          ))}
          {!loading && data.attempts.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-muted">
              No attempts yet. The test stays locked until every required video is
              watched.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
    </div>
  )
}
