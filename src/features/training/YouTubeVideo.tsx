import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A YouTube video, embedded through the IFrame Player API, with the same watch
 * tracking as the self-hosted ones.
 *
 * EMBEDDED, NEVER RE-HOSTED. The course lessons were downloaded once into our
 * own private bucket because hotlinking a paid course's CDN breaks the day it
 * rotates. YouTube is the opposite case: embedding is how the platform is meant
 * to be used, and re-uploading somebody's video is not ours to do. So these
 * play from YouTube and only the watch data is ours.
 *
 * COVERAGE, NOT PLAYHEAD, same rule as the mp4s. A <video> element hands you
 * `played` ranges; the YouTube player does not, so we rebuild the equivalent:
 * poll four times a second while the state is PLAYING and mark the whole second
 * the head is currently in. Seconds you skip over are never marked, so dragging
 * the scrub bar to the end earns nothing, exactly like the other cards. The
 * server then clamps and only ever moves the stored figure up.
 */

interface YTPlayer {
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { PLAYING: number };
}

type YTWindow = Window & {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

/** One script tag for the whole page, however many videos are on it. */
let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  const w = window as YTWindow;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const existing = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      existing?.();
      if (w.YT) resolve(w.YT);
      else reject(new Error('YouTube API loaded without YT'));
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('Could not load the YouTube player'));
    document.head.appendChild(tag);
  });
  return apiPromise;
}

interface Props {
  videoId: string;
  title: string;
  /** Catalogue duration, used until the player reports its own. */
  durationSec: number;
  /** Omit to play without recording anything (Hugo's page). */
  track?: {
    videoKey: string;
    pin: string;
    onProgress: (key: string, pct: number) => void;
  };
  initialPct?: number;
  onPctChange?: (pct: number) => void;
}

export default function YouTubeVideo({
  videoId, title, durationSec, track, initialPct = 0, onPctChange,
}: Props) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const secondsRef = useRef<Set<number>>(new Set());
  const sentRef = useRef(initialPct);
  const savingRef = useRef(false);
  const [failed, setFailed] = useState(false);

  // Seed the counter with what the server already has, so an existing watch is
  // never reported backwards by a fresh session that starts from an empty set.
  useEffect(() => { sentRef.current = Math.max(sentRef.current, initialPct); }, [initialPct]);

  const save = useCallback(
    async (played: boolean, keepalive = false) => {
      if (!track) return;
      const duration = playerRef.current?.getDuration?.() || durationSec;
      if (!duration) return;
      const watched = secondsRef.current.size;
      const next = Math.min(100, Math.round((watched / duration) * 100));
      if (!played && next <= sentRef.current) return;
      if (savingRef.current && !keepalive) return;
      savingRef.current = true;
      sentRef.current = Math.max(sentRef.current, next);
      try {
        const res = await fetch('/api/pedro-training/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pin: track.pin,
            video_key: track.videoKey,
            watched_sec: watched,
            duration_sec: duration,
            played,
          }),
          keepalive,
        });
        if (res.ok) {
          const json = (await res.json()) as { pct?: number };
          if (typeof json.pct === 'number') {
            sentRef.current = json.pct;
            onPctChange?.(json.pct);
            track.onProgress(track.videoKey, json.pct);
          }
        }
      } catch {
        /* offline for a moment; the next tick sends it again */
      } finally {
        savingRef.current = false;
      }
    },
    [track, durationSec, onPctChange],
  );

  useEffect(() => {
    let cancelled = false;
    let poll = 0;
    let lastSaved = 0;
    let playSent = false;

    // The YouTube API REPLACES the element it is given with an iframe. Hand it
    // a plain div we made ourselves rather than a React-rendered one: if React
    // owns that node, unmounting after the swap throws "the node to be removed
    // is not a child of this node" and takes the whole page down with it. That
    // is not hypothetical, it blanked the page and broke four e2e tests before
    // this comment existed.
    const mount = document.createElement('div');
    mount.className = 'h-full w-full';
    holderRef.current?.appendChild(mount);

    void loadApi()
      .then((YT) => {
        if (cancelled || !holderRef.current) return;
        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            // Origin is set so the API can talk back to the page.
            origin: window.location.origin,
          },
          events: {
            onStateChange: (e: { data: number }) => {
              if (e.data === YT.PlayerState.PLAYING && !playSent) {
                playSent = true;
                void save(true);
              }
              if (e.data !== YT.PlayerState.PLAYING) void save(false);
            },
          },
        });

        poll = window.setInterval(() => {
          const p = playerRef.current;
          if (!p?.getCurrentTime) return;
          const t = p.getCurrentTime();
          if (!Number.isFinite(t)) return;
          // Mark only the second the head is actually in. Everything jumped
          // over stays unmarked, which is what makes scrubbing worthless.
          secondsRef.current.add(Math.floor(t));
          const duration = p.getDuration?.() || durationSec;
          if (duration) {
            const pct = Math.min(100, Math.round((secondsRef.current.size / duration) * 100));
            onPctChange?.(Math.max(pct, sentRef.current));
          }
          if (secondsRef.current.size - lastSaved >= 10) {
            lastSaved = secondsRef.current.size;
            void save(false);
          }
        }, 250);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    const flush = () => { void save(false, true); };
    window.addEventListener('pagehide', flush);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener('pagehide', flush);
      flush();
      try { playerRef.current?.destroy?.(); } catch { /* already gone */ }
      playerRef.current = null;
      // Ours to clean up, since React never knew about it.
      if (holderRef.current) holderRef.current.innerHTML = '';
    };
    // videoId is stable per card; save is stable via useCallback deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return (
    <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
      {/* The mount div is appended here by the effect, never by React. */}
      <div ref={holderRef} title={title} className="absolute inset-0 h-full w-full" />
      {failed && (
        <div
          data-testid="youtube-failed"
          className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-white/70"
        >
          The YouTube player could not load. Check your connection and refresh.
        </div>
      )}
    </div>
  );
}
