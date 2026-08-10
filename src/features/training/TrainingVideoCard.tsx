import { useCallback, useEffect, useRef, useState } from 'react';
import YouTubeVideo from './YouTubeVideo';

/**
 * One training video, with watch tracking that seeking cannot fake.
 *
 * Two sources, one card. A 'storage' video is an mp4 out of our private bucket
 * and plays in a plain <video>; a 'youtube' one is embedded through the player
 * API by YouTubeVideo, which applies the same rules by a different route. The
 * rest of the card, the gate and the server are identical either way.
 *
 * COVERAGE, NOT PLAYHEAD. `video.played` is the set of ranges the browser has
 * actually decoded. Summing those ranges gives unique seconds watched, and
 * dragging the scrub bar to the end adds nothing to it. Reading
 * `video.currentTime` instead would let a 13 minute video be "finished" in one
 * drag, which is exactly the bug the VSL funnel shipped and had to fix in July
 * (see the cov() note in api/vsl/page.ts).
 *
 * The server clamps whatever this sends to the real duration and only ever
 * lets the stored figure go up, so a hand-crafted POST cannot rewind a real
 * watch and cannot claim more than the file is long.
 */

export interface TrainingVideoData {
  key: string;
  title: string;
  why: string;
  /** 'storage' plays a signed mp4; 'youtube' embeds the player. */
  source: 'storage' | 'youtube';
  durationLabel: string;
  durationSec: number;
  required: boolean;
  credit?: string | null;
  url: string | null;
  youtubeId?: string | null;
  pct: number;
}

interface Props {
  index: number;
  video: TrainingVideoData;
  pin: string;
  watchedThreshold: number;
  onProgress: (key: string, pct: number) => void;
  /** Hugo's page plays everything with nothing recorded and nothing locked. */
  tracked?: boolean;
}

/** Sum the decoded ranges. This is the whole anti-cheat, in six lines. */
function coverageSec(el: HTMLVideoElement): number {
  const played = el.played;
  let total = 0;
  for (let i = 0; i < played.length; i++) total += played.end(i) - played.start(i);
  return total;
}

export default function TrainingVideoCard({
  index, video, pin, watchedThreshold, onProgress, tracked = true,
}: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [pct, setPct] = useState(video.pct);
  const sentRef = useRef(video.pct);
  const savingRef = useRef(false);

  const save = useCallback(
    async (played: boolean, keepalive = false) => {
      if (!tracked) return;
      const el = ref.current;
      if (!el || !el.duration || !isFinite(el.duration)) return;
      const watched = coverageSec(el);
      const next = Math.min(100, Math.round((watched / el.duration) * 100));
      // Only talk to the server when the number has actually moved, or on a
      // play event (which is counted separately).
      if (!played && next <= sentRef.current) return;
      if (savingRef.current && !keepalive) return;
      savingRef.current = true;
      sentRef.current = Math.max(sentRef.current, next);
      try {
        const res = await fetch('/api/pedro-training/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin,
            video_key: video.key,
            watched_sec: watched,
            duration_sec: el.duration,
            played,
          }),
          keepalive,
        });
        if (res.ok) {
          const json = (await res.json()) as { pct?: number };
          if (typeof json.pct === 'number') {
            sentRef.current = json.pct;
            setPct(json.pct);
            onProgress(video.key, json.pct);
          }
        }
      } catch {
        /* offline for a moment; the next tick sends it again */
      } finally {
        savingRef.current = false;
      }
    },
    [pin, video.key, onProgress, tracked],
  );

  // Flush on the way out, so closing the tab mid-video does not lose the watch.
  useEffect(() => {
    const flush = () => { void save(false, true); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const lastTickRef = useRef(0);
  const onTimeUpdate = () => {
    const el = ref.current;
    if (!el) return;
    const watched = coverageSec(el);
    if (el.duration && isFinite(el.duration)) {
      setPct(Math.min(100, Math.round((watched / el.duration) * 100)));
    }
    // Persist about every ten seconds of real playback rather than on every
    // timeupdate, which fires four times a second.
    if (watched - lastTickRef.current >= 10) {
      lastTickRef.current = watched;
      void save(false);
    }
  };

  const done = pct >= watchedThreshold;

  return (
    <div
      data-testid={`training-video-${video.key}`}
      className={`rounded-2xl border bg-white p-4 sm:p-5 ${
        done ? 'border-[#B6DCC2]' : 'border-[#E5E7EB]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[13px] font-bold ${
            done ? 'bg-[#2E7D43] text-white' : 'bg-[#EEF2F8] text-[#3C5A87]'
          }`}
        >
          {done && tracked ? '✓' : !video.required ? '★' : index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-[16px] font-bold text-[#1A1A1A]">{video.title}</h2>
            <span className="text-[12px] text-[#9CA3AF]">{video.durationLabel}</span>
            {video.credit && (
              <span className="text-[12px] text-[#9CA3AF]">{video.credit}</span>
            )}
            {!video.required && (
              <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#92400E]">
                Extra, not required
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6B7280]">{video.why}</p>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl bg-black">
        {video.source === 'youtube' && video.youtubeId ? (
          <YouTubeVideo
            videoId={video.youtubeId}
            title={video.title}
            durationSec={video.durationSec}
            initialPct={video.pct}
            onPctChange={setPct}
            track={tracked ? { videoKey: video.key, pin, onProgress } : undefined}
          />
        ) : video.url ? (
          <video
            ref={ref}
            src={video.url}
            controls
            preload="metadata"
            playsInline
            className="block h-auto w-full"
            onPlay={() => void save(true)}
            onTimeUpdate={onTimeUpdate}
            onPause={() => void save(false)}
            onEnded={() => void save(false)}
          />
        ) : (
          <div className="p-8 text-center text-[13px] text-white/70">
            This video could not be loaded. Refresh the page and try again.
          </div>
        )}
      </div>

      {tracked && (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#EEF0F4]">
              <div
                className={`h-full rounded-full transition-all ${done ? 'bg-[#2E7D43]' : 'bg-[#3C5A87]'}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <span
              data-testid={`training-pct-${video.key}`}
              className={`w-24 text-right text-[12px] font-semibold ${done ? 'text-[#2E7D43]' : 'text-[#6B7280]'}`}
            >
              {done ? 'Watched' : `${pct}% watched`}
            </span>
          </div>
          {!done && pct > 0 && (
            <p className="mt-1 text-[11.5px] text-[#9CA3AF]">
              Skipping ahead does not count. Only the parts you actually play do.
            </p>
          )}
        </>
      )}
    </div>
  );
}
