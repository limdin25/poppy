// The stress test, on screen.
//
// Blocks first, then warnings, then the passes collapsed behind a count, so
// the eye lands on what is wrong rather than on a wall of ticks.
//
// EVERY LINE IS PRINTED VERBATIM from the server. `detail` is written to be
// read by a person standing next to a disabled button, so nothing here
// reformats it, truncates it or turns it into a code.

import { useState } from 'react';
import { ShieldAlert, AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import type { StressCheck } from './types';

const ROW = {
  block: { icon: ShieldAlert, tone: 'text-[#DC2626]', bg: 'bg-[#FEF2F2] border-[#FECACA]' },
  warn: { icon: AlertTriangle, tone: 'text-[#C2410C]', bg: 'bg-[#FFF7ED] border-[#FED7AA]' },
  pass: { icon: Check, tone: 'text-[#166534]', bg: 'bg-white border-border' },
} as const;

function CheckRow({ check }: { check: StressCheck }) {
  const style = ROW[check.level];
  const Icon = style.icon;
  return (
    <li
      className={cn('flex items-start gap-2 rounded-md border px-2 py-1.5', style.bg)}
      data-testid="cockpit-check"
      data-status={check.level}
      data-check={check.id}
    >
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 flex-shrink-0', style.tone)} />
      <div className="min-w-0">
        <div className={cn('text-[11.5px] font-semibold', style.tone)}>{check.title}</div>
        <div className="text-[11px] leading-snug text-ink-muted">{check.detail}</div>
      </div>
    </li>
  );
}

export default function StressTestList({ checks, collapsePasses = true }: {
  checks: StressCheck[]; collapsePasses?: boolean;
}) {
  const [showPasses, setShowPasses] = useState(false);

  const blocks = checks.filter((c) => c.level === 'block');
  const warns = checks.filter((c) => c.level === 'warn');
  const passes = checks.filter((c) => c.level === 'pass');

  if (!checks.length) return null;

  return (
    <div data-testid="cockpit-stress-test">
      <ul className="space-y-1.5">
        {blocks.map((c) => <CheckRow key={c.id} check={c} />)}
        {warns.map((c) => <CheckRow key={c.id} check={c} />)}
        {(!collapsePasses || showPasses) && passes.map((c) => <CheckRow key={c.id} check={c} />)}
      </ul>

      {collapsePasses && passes.length > 0 && !showPasses && (
        <button
          type="button"
          onClick={() => setShowPasses(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
        >
          <ChevronDown className="w-3 h-3" />
          {passes.length} {passes.length === 1 ? 'check passed' : 'checks passed'}
        </button>
      )}
    </div>
  );
}
