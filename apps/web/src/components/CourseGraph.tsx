'use client';

import '@xyflow/react/dist/style.css';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { nodeStateLabels as stateLabels } from '@/lib/messages';

export interface GraphNodeData extends Record<string, unknown> {
  title: string;
  href: string;
  summary: string;
  skillNames: string[];
  state: 'locked' | 'available' | 'in_progress' | 'passed' | 'cooldown';
  /** Shown under the state, e.g. how long a pause lasts. */
  note?: string;
  /** In the editor a node can be dragged, selected and connected; its title still opens the node. */
  editing?: boolean;
}

function CourseNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className={`graph-node ${data.state}`} data-testid="graph-node">
      <Handle type="target" position={Position.Top} isConnectable={!!data.editing} />
      <a href={data.href}>{data.title}</a>
      <span className="graph-node-skills">{data.skillNames.join(' · ')}</span>
      {!data.editing && (
        <span className="graph-node-state" data-testid="graph-node-state">
          {stateLabels[data.state]}
          {data.note ? ` · ${data.note}` : ''}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={!!data.editing} />
    </div>
  );
}

const nodeTypes = { course: CourseNode };

export interface GraphEditing {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode(id: string): void;
  onSelectEdge(id: string): void;
  onConnect(from: string, to: string): void;
  onMove(id: string, position: { x: number; y: number }): void;
}

/**
 * The knowledge graph. Read-only by default: a click on a node opens it, and the state is the student's progress or a
 * placeholder for viewers who are not enrolled. With `editing` (the author of an editable version) nodes can be
 * dragged, selected and connected; every change is sent to the server by the caller.
 */
export function CourseGraph({
  nodes,
  edges,
  editing,
}: {
  nodes: Node<GraphNodeData>[];
  edges: { id: string; source: string; target: string }[];
  editing?: GraphEditing;
}) {
  const router = useRouter();
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(nodes);
  useEffect(() => setFlowNodes(nodes), [nodes, setFlowNodes]);

  const flowEdges: Edge[] = edges.map((e) => ({
    ...e,
    markerEnd: { type: MarkerType.ArrowClosed },
    selected: e.id === editing?.selectedEdgeId,
  }));
  const shown = editing
    ? flowNodes.map((n) => ({
        ...n,
        selected: n.id === editing.selectedNodeId,
        data: { ...n.data, editing: true },
      }))
    : flowNodes;

  return (
    <div className="graph-canvas" data-testid="course-graph">
      <ReactFlow
        // The view fits the graph once, so a graph that grows in the editor is fitted again.
        key={nodes.length}
        nodes={shown}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesDraggable={!!editing}
        nodesConnectable={!!editing}
        elementsSelectable={!!editing}
        deleteKeyCode={null}
        onConnect={(c: Connection) =>
          c.source && c.target && editing?.onConnect(c.source, c.target)
        }
        onNodeDragStop={(_e, node) => editing?.onMove(node.id, node.position)}
        onEdgeClick={(_e, edge) => editing?.onSelectEdge(edge.id)}
        // A node click opens the node page, or selects the node in the editor. Handling it also lets React Flow give nodes pointer events.
        onNodeClick={(event, node) => {
          // The title is a link: in the editor it opens the node, a click elsewhere on the node selects it.
          if (editing && (event.target as HTMLElement).closest('a')) return;
          event.preventDefault();
          if (editing) editing.onSelectNode(node.id);
          else router.push(node.data.href);
        }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      />
    </div>
  );
}
