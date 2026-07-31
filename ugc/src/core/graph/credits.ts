// Credit estimates and the per-flow meter. Estimates key off the stage kind
// and the pricing canon, never a provider name.

import { creditsFor } from '../pricing';
import { capability, isGenerator } from './capabilities';
import type { GraphDoc, MediaType } from './types';
import { incomingEdges, nodeById } from './types';

const DEFAULT_VIDEO_SECONDS = 30;

// What a run of this node would cost right now. Video nodes bill by the bound
// voice track's real duration when it exists, else the configured duration,
// else the 30s default.
export function estimateNodeCredits(doc: GraphDoc, nodeId: string): number {
  const node = nodeById(doc, nodeId);
  if (!node || !isGenerator(node.kind)) return 0;
  switch (node.kind) {
    case 'photo':
      return creditsFor('image_final', 1);
    case 'voice':
      return creditsFor('voice_take', 1);
    case 'video': {
      const audioEdge = incomingEdges(doc, nodeId).find((e) => e.targetHandle === 'audio');
      const upstream = audioEdge ? nodeById(doc, audioEdge.source) : undefined;
      const configured = node.config['durationSec'];
      const seconds =
        upstream?.output?.assetRef.durationSec ??
        (typeof configured === 'number' ? configured : DEFAULT_VIDEO_SECONDS);
      return creditsFor('lipsync_second', seconds);
    }
    default:
      return 0;
  }
}

export interface MeterTotals {
  text: number;
  image: number;
  video: number;
  audio: number;
  total: number;
}

// What this flow has actually spent (sums recorded creditsSpent by category).
export function meterTotals(doc: GraphDoc): MeterTotals {
  const totals: MeterTotals = { text: 0, image: 0, video: 0, audio: 0, total: 0 };
  for (const node of doc.nodes) {
    if (!node.output) continue;
    const category: MediaType | null = capability(node.kind).creditCategory;
    if (!category) continue;
    totals[category] += node.output.creditsSpent;
    totals.total += node.output.creditsSpent;
  }
  return totals;
}
