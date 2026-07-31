// The one store behind an open project. It holds the GraphDoc (truth) plus
// ephemeral run state; React Flow renders a projection and every mutation
// goes through the pure core functions. Autosave debounces putGraph with
// optimistic concurrency; a conflict reloads the server copy.

import { create } from 'zustand';
import { applyConnect, canConnect, removeEdge, type ConnectCandidate } from '../../../core/graph/connect';
import { buildDefaultFlow } from '../../../core/graph/scaffold';
import { validateDoc } from '../../../core/graph/validate';
import { applyPositions } from '../../../core/graph/docCodec';
import { resolveRun, type RunRequest } from '../../../core/graph/order';
import { hashInputs } from '../../../core/graph/gating';
import { executePlan } from '../../../core/run/runController';
import { backend } from '../../../core/persistence';
import type { GraphDoc, JsonValue, NodeDoc, OutputRecord, RunState, StageKind } from '../../../core/graph/types';
import { capability } from '../../../core/graph/capabilities';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export interface CanvasStore {
  doc: GraphDoc | null;
  savedUpdatedAt: string;
  selection: string | null;
  runStates: Record<string, RunState>;
  runDetails: Record<string, string>;
  balance: number | null;
  running: boolean;
  toast: string | null;

  load(projectId: string): Promise<void>;
  select(nodeId: string | null): void;
  mutateDoc(mutator: (doc: GraphDoc) => GraphDoc): void;
  connect(candidate: ConnectCandidate): void;
  deleteEdge(edgeId: string): void;
  addNode(kind: StageKind): void;
  updateConfig(nodeId: string, patch: Record<string, JsonValue>): void;
  moveNodes(moved: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>): void;
  uploadTo(nodeId: string, file: File): Promise<void>;
  approve(nodeId: string): Promise<void>;
  writeOutput(nodeId: string, output: OutputRecord): void;
  run(req: RunRequest, opts?: { force?: boolean }): Promise<void>;
  refreshCredits(): Promise<void>;
  showToast(message: string): void;
}

function scheduleSave(get: () => CanvasStore, set: (partial: Partial<CanvasStore>) => void): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { doc, savedUpdatedAt } = get();
    if (!doc) return;
    const result = await backend().putGraph(doc, savedUpdatedAt);
    if ('conflict' in result) {
      const fresh = await backend().getGraph(doc.projectId);
      if (fresh) {
        const { doc: repaired } = validateDoc(fresh);
        set({ doc: repaired, savedUpdatedAt: fresh.updatedAt });
      }
      return;
    }
    set({ savedUpdatedAt: result.updatedAt });
  }, 800);
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  doc: null,
  savedUpdatedAt: '',
  selection: null,
  runStates: {},
  runDetails: {},
  balance: null,
  running: false,
  toast: null,

  async load(projectId) {
    const existing = await backend().getGraph(projectId);
    if (existing) {
      const { doc } = validateDoc(existing);
      set({ doc, savedUpdatedAt: existing.updatedAt, selection: null, runStates: {}, runDetails: {} });
    } else {
      const fresh = buildDefaultFlow(projectId, new Date().toISOString());
      const saved = await backend().putGraph(fresh, '');
      set({
        doc: fresh,
        savedUpdatedAt: 'conflict' in saved ? fresh.updatedAt : saved.updatedAt,
        selection: null,
        runStates: {},
        runDetails: {},
      });
    }
    void get().refreshCredits();
  },

  select(nodeId) {
    set({ selection: nodeId });
  },

  mutateDoc(mutator) {
    const { doc } = get();
    if (!doc) return;
    set({ doc: mutator(doc) });
    scheduleSave(get, set);
  },

  connect(candidate) {
    const { doc } = get();
    if (!doc) return;
    const check = canConnect(doc, candidate);
    if (!check.ok) {
      if (check.reason === 'no-free-slot') get().showToast('All image inputs on this node are full');
      return;
    }
    get().mutateDoc((d) => applyConnect(d, candidate));
  },

  deleteEdge(edgeId) {
    get().mutateDoc((d) => removeEdge(d, edgeId));
  },

  addNode(kind) {
    const id = `n-${Math.random().toString(36).slice(2, 8)}`;
    const cap = capability(kind);
    get().mutateDoc((d) => ({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id,
          kind,
          label: cap.displayName,
          position: { x: 80 + d.nodes.length * 24, y: 620 },
          groupId: null,
          config: Object.fromEntries(cap.fields.map((f) => [f.id, ''])),
          output: null,
          approval: cap.approvalRequired ? { approvedAt: null, approvedAssetId: null } : null,
        } satisfies NodeDoc,
      ],
    }));
    set({ selection: id });
  },

  updateConfig(nodeId, patch) {
    get().mutateDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, ...patch } } : n)),
    }));
  },

  moveNodes(moved) {
    get().mutateDoc((d) => applyPositions(d, moved));
  },

  async uploadTo(nodeId, file) {
    const { doc } = get();
    if (!doc) return;
    // Which foundation slot does this node feed? refImage2 is the product by
    // scaffold convention; everything else uploads as the influencer photo.
    const feeds = doc.edges.find((e) => e.source === nodeId)?.targetHandle;
    const role = feeds === 'refImage2' || nodeId === 'product' ? 'product' : 'influencer';
    const ref = await backend().uploadAsset(doc.projectId, file, file.name, role);
    get().mutateDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              output: {
                assetRef: ref,
                category: 'image',
                producedAt: new Date().toISOString(),
                jobId: null,
                creditsSpent: 0,
                inputsHash: hashInputs(d, nodeId),
              },
            }
          : n,
      ),
    }));
  },

  async approve(nodeId) {
    const { doc } = get();
    const node = doc?.nodes.find((n) => n.id === nodeId);
    if (!node?.output) return;
    await backend().approveAsset(node.output.assetRef.assetId);
    get().mutateDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === nodeId && n.output
          ? { ...n, approval: { approvedAt: new Date().toISOString(), approvedAssetId: n.output.assetRef.assetId } }
          : n,
      ),
    }));
  },

  writeOutput(nodeId, output) {
    get().mutateDoc((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, output } : n)),
    }));
  },

  async run(req, opts = {}) {
    const { doc, running } = get();
    if (!doc || running) return;
    const plan = resolveRun(doc, req, opts);
    const blocked = plan.entries.filter((e) => e.action === 'blocked');
    for (const b of blocked) {
      set((s) => ({
        runDetails: { ...s.runDetails, [b.nodeId]: b.detail ?? 'Blocked' },
      }) as Partial<CanvasStore>);
    }
    if (!plan.entries.some((e) => e.action === 'run')) {
      if (blocked.length) get().showToast(blocked[0]!.detail ?? 'Nothing can run yet');
      return;
    }
    set({ running: true });
    try {
      await executePlan({
        doc: () => get().doc!,
        plan,
        backend: backend(),
        pollMs: 250,
        onNodeState: (nodeId, state, detail) =>
          set((s) => ({
            runStates: { ...s.runStates, [nodeId]: state },
            runDetails: { ...s.runDetails, [nodeId]: detail ?? '' },
          }) as Partial<CanvasStore>),
        onOutput: (nodeId, output) => get().writeOutput(nodeId, output),
      });
    } finally {
      set({ running: false });
      void get().refreshCredits();
    }
  },

  async refreshCredits() {
    const { balance } = await backend().getCredits();
    set({ balance });
  },

  showToast(message) {
    set({ toast: message });
    setTimeout(() => set({ toast: null }), 3200);
  },
}));
