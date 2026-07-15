// DtmfKeypad — touch-tone keypad shown during a connected call.
//
// IVR menus ("Press 1 for sales, 2 for lettings…") need DTMF digits
// sent on the active call leg. Twilio Voice SDK's Call.sendDigits
// handles this; we just provide the UI and forward each press.
//
// Keys: 0-9 + * + # in the standard 3x4 phone layout. Also supports
// the physical keyboard (digits, *, #) while focus is inside the
// dialer page so the agent can type rather than click.
//
// Shows a small read-only "Sent: …" history so the agent can verify
// what they entered. History clears on a new call.

import { useEffect, useState } from 'react';
import { cn } from '@/core/lib/cn';

interface Props {
  /** True while the active call is connected — only then will the
   *  SDK actually deliver tones. We still let the user click while
   *  ringing (no-op) to avoid a confusing disabled flash. */
  enabled: boolean;
  /** Called with the pressed digit. Should call into useDialerMachine's
   *  sendDigit which forwards to Twilio Call.sendDigits. */
  onDigit: (digit: string) => string | null;
  /** Optional id so the matching call's history resets when the call
   *  changes (we key the history clear on this). */
  callId?: string | null;
  /** Layout flag — 'compact' for the floating GHL card, 'inline' for
   *  the 4-column live-call surface. */
  size?: 'compact' | 'inline';
}

const ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

const SUBLABEL: Record<string, string> = {
  '1': '',
  '2': 'ABC',
  '3': 'DEF',
  '4': 'GHI',
  '5': 'JKL',
  '6': 'MNO',
  '7': 'PQRS',
  '8': 'TUV',
  '9': 'WXYZ',
  '*': '',
  '0': '+',
  '#': '',
};

const VALID = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#']);

export default function DtmfKeypad({ enabled, onDigit, callId, size = 'compact' }: Props) {
  const [history, setHistory] = useState('');

  // Reset the visible history each time the call changes so digits
  // from a previous call don't bleed into the next.
  useEffect(() => { setHistory(''); }, [callId]);

  // Keyboard support: 0-9, *, # while focus isn't in an input/textarea.
  // Otherwise typing into the notes/SMS box would also send tones.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (!VALID.has(e.key)) return;
      e.preventDefault();
      press(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const press = (digit: string) => {
    const sent = onDigit(digit);
    if (sent !== null) setHistory((prev) => (prev + digit).slice(-20));
  };

  const btnClass = size === 'inline'
    ? 'aspect-square flex flex-col items-center justify-center rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F3F3EE] active:bg-[#3C5A87]/10 text-[#1A1A1A] transition-colors'
    : 'aspect-square flex flex-col items-center justify-center rounded-lg bg-[#F3F3EE] hover:bg-[#E5E7EB] active:bg-[#3C5A87]/10 text-[#1A1A1A] transition-colors';

  const digitClass = size === 'inline' ? 'text-[16px] font-semibold' : 'text-[14px] font-semibold';
  const sublabelClass = size === 'inline' ? 'text-[8px] tracking-wider text-[#9CA3AF] mt-0.5' : 'text-[7px] tracking-wider text-[#9CA3AF]';

  return (
    <div className={cn('flex flex-col gap-2', !enabled && 'opacity-50 pointer-events-none')}>
      {/* History */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-white border border-[#E5E7EB] rounded-md min-h-[26px]">
        <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">Sent</span>
        <span className="text-[12px] font-mono text-[#1A1A1A] tabular-nums tracking-wider truncate flex-1">
          {history || '—'}
        </span>
        {history && (
          <button
            type="button"
            onClick={() => setHistory('')}
            className="text-[10px] text-[#6B7280] hover:text-[#1A1A1A]"
          >
            clear
          </button>
        )}
      </div>

      {/* 3x4 grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {ROWS.flat().map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={!enabled}
            className={btnClass}
            title={`Send ${d}`}
          >
            <span className={digitClass}>{d}</span>
            {SUBLABEL[d] && <span className={sublabelClass}>{SUBLABEL[d]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
