// One component renders every stage kind from its capability + doc state.
// White card, r16, CARD shadow; ink-black circular run button; ONE accent
// colour reserved for live activity; amber for gated/stale.

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ArrowUp, Camera, Clapperboard, Image as ImageIcon, Lock, Mic, RotateCcw, Type } from 'lucide-react';
import { capability, isGenerator } from '../../../core/graph/capabilities';
import { isRunnable, isStale } from '../../../core/graph/gating';
import { estimateNodeCredits } from '../../../core/graph/credits';
import { useCanvasStore } from '../state/store';
import { TID } from '../../../testids';
import type { StageKind } from '../../../core/graph/types';

const GLYPHS: Record<StageKind, typeof Camera> = {
  asset: ImageIcon,
  photo: Camera,
  voice: Mic,
  video: Clapperboard,
  text: Type,
  note: Type,
};

function StatusPill({ id }: { id: string }) {
  const doc = useCanvasStore((s) => s.doc);
  const runState = useCanvasStore((s) => s.runStates[id]);
  const detail = useCanvasStore((s) => s.runDetails[id]);
  if (!doc) return null;

  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return null;

  let label = '';
  let cls = '';
  if (runState === 'queued') {
    label = 'Queued';
    cls = 'bg-live/10 text-live';
  } else if (runState === 'running') {
    label = 'Running';
    cls = 'bg-live/10 text-live animate-pulse';
  } else if (runState === 'failed') {
    label = 'Failed';
    cls = 'bg-failed/10 text-failed';
  } else if (node.output && isStale(doc, id)) {
    label = 'Out of date';
    cls = 'bg-gated/10 text-gated';
  } else if (node.output) {
    label = 'Done';
    cls = 'bg-done/10 text-done';
  } else if (isGenerator(node.kind)) {
    const runnable = isRunnable(doc, id);
    if (!runnable.ok && runnable.code === 'unapproved-audio') {
      label = 'Awaiting approval';
      cls = 'bg-gated/10 text-gated';
    }
  }

  if (!label) return null;
  return (
    <span
      data-testid={TID.nodeStatus(id)}
      title={detail || undefined}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

export function StageNode({ id, selected }: NodeProps) {
  const doc = useCanvasStore((s) => s.doc);
  const running = useCanvasStore((s) => s.running);
  const run = useCanvasStore((s) => s.run);
  const showToast = useCanvasStore((s) => s.showToast);
  if (!doc) return null;

  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return null;

  const cap = capability(node.kind);
  const Glyph = GLYPHS[node.kind];
  const generator = isGenerator(node.kind);
  const fresh = node.output !== null && !isStale(doc, id);
  const runnable = generator ? isRunnable(doc, id) : null;
  const gated = runnable !== null && !runnable.ok && runnable.code === 'unapproved-audio';
  const cost = generator ? estimateNodeCredits(doc, id) : 0;

  const onRun = () => {
    if (running) return;
    if (gated) {
      showToast('Approve the voice track first');
      return;
    }
    void run({ mode: 'single', nodeId: id }, { force: fresh });
  };

  const preview = node.output?.assetRef.url;
  const promptLine =
    typeof node.config['prompt'] === 'string' && node.config['prompt']
      ? node.config['prompt']
      : typeof node.config['direction'] === 'string' && node.config['direction']
        ? node.config['direction']
        : typeof node.config['script'] === 'string'
          ? node.config['script']
          : '';

  return (
    <div
      data-testid={TID.node(id)}
      className={`w-[240px] rounded-node border bg-surface shadow-card transition-shadow duration-200 ease-apple ${
        selected ? 'border-live shadow-selected' : 'border-hairline'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        data-testid={TID.handleIn(id)}
        className="!h-2.5 !w-2.5 !border !border-hairline !bg-white"
      />
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-page">
          <Glyph size={13} className="text-ink-muted" />
        </span>
        <span className="flex-1 truncate text-[13px] font-semibold text-ink">{node.label}</span>
        <StatusPill id={id} />
      </div>

      <div className="px-3 py-2">
        {preview && node.output?.category !== 'audio' ? (
          <img src={preview} alt="" className="h-24 w-full rounded-lg object-cover" data-testid={TID.panelOutput + '-thumb-' + id} />
        ) : node.output?.category === 'audio' ? (
          <div className="flex h-10 items-center justify-center rounded-lg bg-page text-[11px] text-ink-muted">
            Voice take ready ({node.output.assetRef.durationSec ?? '?'}s)
          </div>
        ) : promptLine ? (
          <p className="line-clamp-2 text-[11px] leading-snug text-ink-muted">{promptLine}</p>
        ) : (
          <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-hairline text-[11px] text-ink-subtle">
            {node.kind === 'asset' ? 'Upload a photo' : cap.displayName}
          </div>
        )}
      </div>

      {generator && (
        <div className="flex items-center justify-between border-t border-hairline px-3 py-2">
          <span className="text-[10px] font-medium text-ink-subtle">{cost} cr</span>
          <button
            type="button"
            data-testid={TID.nodeRun(id)}
            onClick={onRun}
            disabled={running}
            aria-label={gated ? 'Locked: approve the voice track first' : fresh ? 'Run again' : 'Run'}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200 ease-apple ${
              gated
                ? 'bg-gated/10 text-gated'
                : 'bg-ink text-white hover:bg-black disabled:opacity-40'
            }`}
          >
            {gated ? <Lock size={13} /> : fresh ? <RotateCcw size={13} /> : <ArrowUp size={14} />}
          </button>
        </div>
      )}

      {cap.outputType && (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          data-testid={TID.handleOut(id)}
          className={`!h-2.5 !w-2.5 !border !bg-white ${fresh ? '!border-live' : '!border-hairline'}`}
        />
      )}
    </div>
  );
}
