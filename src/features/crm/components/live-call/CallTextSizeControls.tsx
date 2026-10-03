import { useState } from 'react';

export const CALL_TEXT_SIZES = {
  script: { initial: 24, min: 18, max: 36 },
  // Pedro, 3 Oct 2026: the coach was not big enough. Raised from 36 (max 48).
  coach: { initial: 44, min: 24, max: 64 },
} as const;
type Pane = keyof typeof CALL_TEXT_SIZES;
type TextStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): TextStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

// The coach moved to a new key when its sizes grew, so a size saved under the
// old, smaller range is lifted to the new default instead of shrinking it.
const storageKey = (pane: Pane) => pane === 'coach' ? 'hostunico:coach-font-size-v2' : `hostunico:${pane}-font-size`;

export function readCallTextSize(pane: Pane, storage = browserStorage()): number {
  const bounds = CALL_TEXT_SIZES[pane];
  try {
    const raw = storage?.getItem(storageKey(pane));
    if (raw == null && pane === 'coach') {
      const old = Number(storage?.getItem('hostunico:coach-font-size'));
      return Number.isFinite(old) && old > bounds.initial && old <= bounds.max ? old : bounds.initial;
    }
    const saved = Number(raw);
    return raw != null && Number.isFinite(saved) && saved >= bounds.min && saved <= bounds.max
      ? saved : bounds.initial;
  } catch { return bounds.initial; }
}

export function saveCallTextSize(pane: Pane, value: number, storage = browserStorage()): number {
  const bounds = CALL_TEXT_SIZES[pane];
  const next = Number.isFinite(value) ? Math.max(bounds.min, Math.min(bounds.max, value)) : bounds.initial;
  try { storage?.setItem(storageKey(pane), String(next)); }
  catch { /* Text controls still work when local storage is unavailable. */ }
  return next;
}

export function useCallTextSize(pane: Pane) {
  const [size, setSize] = useState(() => readCallTextSize(pane));
  return { size, changeSize: (value: number) => setSize(saveCallTextSize(pane, value)) };
}

export default function CallTextSizeControls({ pane, size, onChange }: { pane: Pane; size: number; onChange: (value: number) => void }) {
  const bounds = CALL_TEXT_SIZES[pane];
  return <div role="group" aria-label={`${pane} text size`} className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
    <button type="button" onClick={() => onChange(size - 2)} disabled={size <= bounds.min} aria-label={`Decrease ${pane} text size`} title={`Smaller ${pane} text (${size}px)`} className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-xl font-semibold hover:bg-slate-100 disabled:opacity-40">-</button>
    <output aria-label={`${pane} font size`} className="sr-only">{size}px</output>
    <button type="button" onClick={() => onChange(size + 2)} disabled={size >= bounds.max} aria-label={`Increase ${pane} text size`} title={`Larger ${pane} text (${size}px)`} className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-xl font-semibold hover:bg-slate-100 disabled:opacity-40">+</button>
  </div>;
}
