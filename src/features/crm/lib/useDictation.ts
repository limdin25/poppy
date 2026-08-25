// Press the button, talk, the words appear in the box.
//
// Hugo, 2026-08-25: "there's a button where he can press the audio and he can
// speak on the audio on the computer and he then can explain about that part of
// the property."
//
// This is the browser's own speech recognition, not a service we pay for and
// not an upload. Nothing leaves the machine except through the browser's own
// dictation, there is no audio file to store, and it costs nothing per press.
//
// WHY IT IS A HOOK WITH ONE OWNER. Only one microphone exists, so only one
// section can be recording at a time. Holding the recogniser here, with the id
// of whichever section owns it, means starting a second one automatically stops
// the first instead of two boxes fighting over the same audio.
//
// BROWSER SUPPORT IS REAL AND IT IS NOT UNIVERSAL. This is Chrome, Edge and
// Safari. Firefox does not implement it at all. `supported` is exported so the
// screen can say "type it instead" rather than showing a button that does
// nothing, which is the worst of the three outcomes.

import { useCallback, useEffect, useRef, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SpeechResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } };
}

function recogniser(): any | null {
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export const dictationSupported = (): boolean =>
  typeof window !== 'undefined'
  && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export interface Dictation {
  supported: boolean;
  /** The section currently recording, or null. */
  activeId: string | null;
  /** Words spoken but not yet finalised, shown live so he can see it hearing him. */
  interim: string;
  error: string | null;
  /** Start on this section, stopping whatever else was going. */
  start: (id: string, onFinal: (text: string) => void) => void;
  stop: () => void;
}

export function useDictation(): Dictation {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<any>(null);
  const supported = dictationSupported();

  const stop = useCallback(() => {
    try { ref.current?.stop(); } catch { /* already stopped */ }
    ref.current = null;
    setActiveId(null);
    setInterim('');
  }, []);

  // A recogniser left running when the page unmounts keeps the microphone
  // light on, which is alarming and looks like a bug in something else.
  useEffect(() => () => { try { ref.current?.stop(); } catch { /* noop */ } }, []);

  const start = useCallback((id: string, onFinal: (text: string) => void) => {
    if (!supported) { setError('This browser cannot do dictation. Use Chrome, or just type it.'); return; }
    try { ref.current?.stop(); } catch { /* noop */ }

    const rec = recogniser();
    if (!rec) { setError('This browser cannot do dictation. Use Chrome, or just type it.'); return; }
    rec.lang = 'en-GB';
    // continuous, because he is describing a whole room and pauses to look at
    // the next photograph. Without it the recogniser stops on the first breath.
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechResultEvent) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinal(r[0].transcript.trim());
        else live += r[0].transcript;
      }
      setInterim(live);
    };
    rec.onerror = (e: any) => {
      // 'aborted' is what a deliberate stop looks like, and 'no-speech' is just
      // a quiet moment. Neither is worth putting a red message on his screen.
      if (e?.error === 'aborted' || e?.error === 'no-speech') return;
      setError(
        e?.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it for this site in the address bar, then press the button again.'
          : `The microphone stopped: ${String(e?.error ?? 'unknown')}`,
      );
      setActiveId(null);
      setInterim('');
    };
    // Chrome ends the session on its own after a long silence. Restarting keeps
    // the button honest: if it says recording, it is recording.
    rec.onend = () => {
      if (ref.current === rec) {
        try { rec.start(); } catch { setActiveId(null); setInterim(''); }
      }
    };

    ref.current = rec;
    setError(null);
    setInterim('');
    setActiveId(id);
    try { rec.start(); }
    catch { setError('Could not start the microphone. Try again.'); setActiveId(null); }
  }, [supported]);

  return { supported, activeId, interim, error, start, stop };
}
