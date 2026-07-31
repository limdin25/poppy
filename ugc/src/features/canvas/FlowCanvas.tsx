// The ReactFlow instance: handlers only, no business logic. Truth lives in
// the store's GraphDoc; nodes/edges here are a projection rebuilt on every
// doc change. isValidConnection runs the pure canConnect live during drags so
// an invalid edge can never materialise.

import { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { canConnect } from '../../core/graph/connect';
import { toReactFlow } from '../../core/graph/docCodec';
import { useCanvasStore } from './state/store';
import { StageNode } from './nodes/StageNode';
import { BandNode } from './nodes/BandNode';
import { BridgeEdge } from './edges/BridgeEdge';
import { TOKENS } from '../../theme/tokens';
import { TID } from '../../testids';
import type { SlotId } from '../../core/graph/types';

const nodeTypes = { stage: StageNode, note: StageNode, band: BandNode };
const edgeTypes = { bridge: BridgeEdge };

export function FlowCanvas() {
  const doc = useCanvasStore((s) => s.doc);
  const select = useCanvasStore((s) => s.select);
  const connect = useCanvasStore((s) => s.connect);
  const moveNodes = useCanvasStore((s) => s.moveNodes);
  const deleteEdge = useCanvasStore((s) => s.deleteEdge);

  const projection = useMemo(() => (doc ? toReactFlow(doc) : { nodes: [], edges: [] }), [doc]);

  const nodes: Node[] = useMemo(
    () =>
      projection.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        ...(n.type === 'band'
          ? { draggable: false, selectable: false, zIndex: -1 }
          : {}),
      })),
    [projection],
  );

  const edges: Edge[] = useMemo(
    () =>
      projection.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: 'in',
        type: 'bridge',
      })),
    [projection],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (candidate) => {
      if (!doc || !candidate.source || !candidate.target) return false;
      return canConnect(doc, { source: candidate.source, target: candidate.target }).ok;
    },
    [doc],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const targetHandle =
        connection.targetHandle && connection.targetHandle !== 'in'
          ? (connection.targetHandle as SlotId)
          : undefined;
      connect({
        source: connection.source,
        target: connection.target,
        ...(targetHandle ? { targetHandle } : {}),
      });
    },
    [connect],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const moved = changes
        .filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && !c.dragging)
        .map((c) => {
          const rf = nodes.find((n) => n.id === c.id);
          return rf && c.position
            ? { id: c.id, position: c.position, ...(rf.parentId ? { parentId: rf.parentId } : {}) }
            : null;
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (moved.length) moveNodes(moved);
    },
    [nodes, moveNodes],
  );

  return (
    <div data-testid={TID.canvas} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={(_, node) => node.type !== 'band' && select(node.id)}
        onPaneClick={() => select(null)}
        onEdgesDelete={(deleted) => deleted.forEach((e) => deleteEdge(e.id))}
        snapToGrid={doc?.settings.snapToGrid ?? true}
        snapGrid={[20, 20]}
        fitView
        proOptions={{ hideAttribution: true }}
        style={{ background: TOKENS.canvas }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={TOKENS.grid} />
        <Controls position="bottom-right" showInteractive={false} />
        <div className="hidden lg:block">
          <MiniMap
            position="bottom-left"
            pannable
            nodeColor={() => TOKENS.hairline}
            maskColor="rgba(250, 250, 248, 0.7)"
          />
        </div>
      </ReactFlow>
    </div>
  );
}
