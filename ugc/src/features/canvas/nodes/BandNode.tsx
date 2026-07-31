// A stage band: a very pale tinted rounded rectangle with an uppercase label.
// Bands are React Flow parent nodes; stages inside carry parentId.

import type { NodeProps } from '@xyflow/react';
import { TID } from '../../../testids';

const TINTS: Record<string, string> = {
  input: 'var(--ugc-band-input)',
  generation: 'var(--ugc-band-generation)',
  output: 'var(--ugc-band-output)',
};

export function BandNode({ id, data }: NodeProps) {
  const d = data as { label: string; tint: string; size: { width: number; height: number } };
  return (
    <div
      data-testid={TID.band(id)}
      style={{ width: d.size.width, height: d.size.height, background: TINTS[d.tint] ?? TINTS['input'] }}
      className="rounded-2xl border border-hairline/60"
    >
      <span className="ml-4 mt-3 inline-block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {d.label}
      </span>
    </div>
  );
}
