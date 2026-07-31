// The dynamic side panel, derived from (capability schema x incoming edges x
// node state). The hard requirement this file exists for: a node with NO
// incoming edge has NO Input Assignment section at all. The panel component
// is a dumb renderer of the PanelModel returned here, which is why the whole
// behaviour is unit-testable without a browser.

import { capability, type FieldSpec } from './capabilities';
import { isStale } from './gating';
import type { GraphDoc, OutputRecord, SlotId } from './types';
import { incomingEdges, nodeById } from './types';

export interface SlotRowModel {
  slot: SlotId;
  label: string;
  bound: { edgeId: string; sourceNodeId: string; sourceLabel: string } | null;
}

export type PanelSection =
  | { type: 'inputs'; rows: SlotRowModel[] }
  | { type: 'fields'; fields: FieldSpec[] }
  | { type: 'approval'; state: 'unapproved' | 'approved'; takeAssetId: string }
  | { type: 'output'; output: OutputRecord; stale: boolean };

export function derivePanel(doc: GraphDoc, nodeId: string): PanelSection[] {
  const node = nodeById(doc, nodeId);
  if (!node) return [];
  const cap = capability(node.kind);
  const sections: PanelSection[] = [];

  const edges = incomingEdges(doc, nodeId);
  if (edges.length > 0) {
    const bySlot = new Map(edges.map((e) => [e.targetHandle, e] as const));
    const rows: SlotRowModel[] = [];
    let emptyGroupRowShown = false;
    for (const slot of cap.slots) {
      const edge = bySlot.get(slot.id);
      if (edge) {
        const source = nodeById(doc, edge.source);
        rows.push({
          slot: slot.id,
          label: slot.label,
          bound: {
            edgeId: edge.id,
            sourceNodeId: edge.source,
            sourceLabel: source?.label ?? edge.source,
          },
        });
        continue;
      }
      // The numbered reference-image family windows: bound rows plus exactly
      // one empty next row, never four rows of "Skip" noise.
      if (slot.group === 'refImages') {
        if (emptyGroupRowShown) continue;
        emptyGroupRowShown = true;
      }
      rows.push({ slot: slot.id, label: slot.label, bound: null });
    }
    sections.push({ type: 'inputs', rows });
  }

  if (cap.fields.length > 0) {
    sections.push({ type: 'fields', fields: cap.fields });
  }

  if (cap.approvalRequired && node.output) {
    const approvedNow = node.approval?.approvedAssetId === node.output.assetRef.assetId;
    sections.push({
      type: 'approval',
      state: approvedNow ? 'approved' : 'unapproved',
      takeAssetId: node.output.assetRef.assetId,
    });
  }

  if (node.output) {
    sections.push({ type: 'output', output: node.output, stale: isStale(doc, nodeId) });
  }

  return sections;
}
