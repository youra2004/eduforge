'use client';

import '@xyflow/react/dist/style.css';
import { useRouter } from 'next/navigation';
import {
  Handle,
  MarkerType,
  Position,
  ReactFlow,
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
}

function CourseNode({ data }: NodeProps<Node<GraphNodeData>>) {
  return (
    <div className={`graph-node ${data.state}`} data-testid="graph-node">
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <a href={data.href}>{data.title}</a>
      <span className="graph-node-skills">{data.skillNames.join(' · ')}</span>
      <span className="graph-node-state" data-testid="graph-node-state">
        {stateLabels[data.state]}
        {data.note ? ` · ${data.note}` : ''}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { course: CourseNode };

/** Read-only view of the knowledge graph; a click on a node opens it. The state is the student's progress, or a placeholder for viewers who are not enrolled. */
export function CourseGraph({
  nodes,
  edges,
}: {
  nodes: Node<GraphNodeData>[];
  edges: { id: string; source: string; target: string }[];
}) {
  const router = useRouter();
  const flowEdges: Edge[] = edges.map((e) => ({
    ...e,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
  return (
    <div className="graph-canvas" data-testid="course-graph">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // A node click opens the node page. Handling it also lets React Flow give nodes pointer events.
        onNodeClick={(event, node) => {
          event.preventDefault();
          router.push(node.data.href);
        }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      />
    </div>
  );
}
