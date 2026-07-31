// The GraphDoc: the one durable object behind the canvas. The client owns its
// meaning; the server stores it opaquely (ugc_projects.graph jsonb) with
// updatedAt optimistic concurrency.
//
// Two load-bearing choices, made on purpose and pinned by tests:
// 1. An edge's targetHandle IS the slot binding. There is no separate binding
//    map, so deleting an edge cannot desync anything.
// 2. Staleness and the voice-approval gate are DERIVED, never stored.
//    gateOpen = approval.approvedAssetId === output.assetRef.assetId, so
//    re-generating a voice closes its gate with zero event plumbing.

export type MediaType = 'image' | 'audio' | 'video' | 'text';

// asset = an uploaded file holder (no generation, no credits).
// photo/voice/video = the three generator stages. text/note = static.
export type StageKind = 'asset' | 'photo' | 'voice' | 'video' | 'text' | 'note';

export type SlotId =
  | 'startImage'
  | 'endImage'
  | 'refImage1'
  | 'refImage2'
  | 'refImage3'
  | 'refImage4'
  | 'audio';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AssetRef {
  assetId: string;
  mime: string;
  url?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface OutputRecord {
  assetRef: AssetRef;
  category: MediaType;
  producedAt: string;
  jobId: string | null;
  creditsSpent: number;
  // Hash of (config + each bound upstream output assetId) at run time.
  // Staleness = this no longer matches the current hash.
  inputsHash: string;
}

export interface ApprovalRecord {
  approvedAt: string | null;
  // Ties approval to ONE specific take. A re-generated output has a new
  // assetId, so approval of the old take does not carry over.
  approvedAssetId: string | null;
}

export interface NodeDoc {
  id: string;
  kind: StageKind;
  label: string;
  position: { x: number; y: number };
  groupId: string | null;
  config: Record<string, JsonValue>;
  output: OutputRecord | null;
  approval: ApprovalRecord | null;
}

export interface EdgeDoc {
  id: string;
  source: string;
  sourceHandle: 'out';
  target: string;
  targetHandle: SlotId;
}

export type GroupTint = 'input' | 'generation' | 'output';

export interface GroupDoc {
  id: string;
  label: string;
  tint: GroupTint;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface ProductInfo {
  name: string;
  category: string;
  description: string;
  sellingPoints: string[];
  assetRefs: AssetRef[];
}

export interface GraphDoc {
  version: 1;
  projectId: string;
  updatedAt: string;
  product: ProductInfo | null;
  nodes: NodeDoc[];
  edges: EdgeDoc[];
  groups: GroupDoc[];
  settings: { snapToGrid: boolean; verticalHandles: boolean };
}

// Ephemeral per-node run state (store-only, never persisted in the doc).
export type RunState = 'idle' | 'queued' | 'running' | 'done' | 'failed';

export function nodeById(doc: GraphDoc, id: string): NodeDoc | undefined {
  return doc.nodes.find((n) => n.id === id);
}

export function incomingEdges(doc: GraphDoc, nodeId: string): EdgeDoc[] {
  return doc.edges.filter((e) => e.target === nodeId);
}

export function outgoingEdges(doc: GraphDoc, nodeId: string): EdgeDoc[] {
  return doc.edges.filter((e) => e.source === nodeId);
}
