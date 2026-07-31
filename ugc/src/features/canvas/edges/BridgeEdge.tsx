// The bridge edge: bezier, slot label chip at the target end, dashed amber
// while its audio is unapproved (the gate made visible), animated accent
// while the downstream node runs.

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import { capability } from '../../../core/graph/capabilities';
import { useCanvasStore } from '../state/store';
import { TOKENS } from '../../../theme/tokens';
import type { SlotId } from '../../../core/graph/types';

export function BridgeEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, target } = props;
  const doc = useCanvasStore((s) => s.doc);
  const targetRunState = useCanvasStore((s) => s.runStates[target]);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const edge = doc?.edges.find((e) => e.id === id);
  const targetNode = doc?.nodes.find((n) => n.id === target);
  const slot =
    edge && targetNode
      ? capability(targetNode.kind).slots.find((s) => s.id === (edge.targetHandle as SlotId))
      : undefined;

  // The gate, visible: an audio edge whose upstream take is unapproved.
  let gated = false;
  if (doc && edge && slot?.requiresApprovedUpstream) {
    const upstream = doc.nodes.find((n) => n.id === edge.source);
    gated =
      !upstream?.output ||
      upstream.approval?.approvedAssetId !== upstream.output.assetRef.assetId;
  }

  const active = targetRunState === 'running' || targetRunState === 'queued';
  const stroke = gated ? TOKENS.gated : active ? TOKENS.live : TOKENS.edge;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke,
          strokeWidth: 1.75,
          strokeDasharray: gated ? '6 4' : active ? '8 4' : undefined,
          animation: active ? 'ugc-edge-flow 0.6s linear infinite' : undefined,
        }}
      />
      {slot && (
        <EdgeLabelRenderer>
          <span
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className="pointer-events-none absolute rounded-full border border-hairline bg-white px-1.5 py-0.5 text-[9px] font-medium text-ink-muted"
          >
            {slot.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
