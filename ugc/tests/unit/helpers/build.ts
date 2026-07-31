// Tiny factories shared by the graph-core tests. Everything defaults sane and
// overridable so each test states only what it cares about.

import type {
  AssetRef,
  EdgeDoc,
  GraphDoc,
  NodeDoc,
  OutputRecord,
  SlotId,
  StageKind,
} from '../../../src/core/graph/types';

let seq = 0;

export function asset(overrides: Partial<AssetRef> = {}): AssetRef {
  seq += 1;
  return { assetId: `asset-${seq}`, mime: 'image/png', ...overrides };
}

export function output(overrides: Partial<OutputRecord> = {}): OutputRecord {
  return {
    assetRef: asset(),
    category: 'image',
    producedAt: '2026-07-31T12:00:00Z',
    jobId: 'job-1',
    creditsSpent: 30,
    inputsHash: 'hash-unset',
    ...overrides,
  };
}

export function node(id: string, kind: StageKind, overrides: Partial<NodeDoc> = {}): NodeDoc {
  return {
    id,
    kind,
    label: id,
    position: { x: 0, y: 0 },
    groupId: null,
    config: {},
    output: null,
    approval: kind === 'voice' ? { approvedAt: null, approvedAssetId: null } : null,
    ...overrides,
  };
}

export function edge(source: string, target: string, targetHandle: SlotId): EdgeDoc {
  return { id: `e-${source}:${targetHandle}:${target}`, source, sourceHandle: 'out', target, targetHandle };
}

export function doc(overrides: Partial<GraphDoc> = {}): GraphDoc {
  return {
    version: 1,
    projectId: 'p-1',
    updatedAt: '2026-07-31T12:00:00Z',
    product: null,
    nodes: [],
    edges: [],
    groups: [],
    settings: { snapToGrid: true, verticalHandles: false },
    ...overrides,
  };
}
