import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CourseError,
  getVersionGraph,
  hasRole,
  loadConfig,
  nodeLayers,
  placeholderNodeStates,
  poolIssues,
} from '@eduforge/core';
import { CourseGraph, type GraphNodeData } from '@/components/CourseGraph';
import { versionStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';
import type { Node } from '@xyflow/react';

export const dynamic = 'force-dynamic';

const NODE_GAP_X = 260;
const LAYER_GAP_Y = 150;

export default async function CourseVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const { id } = await params;
  const graph = await getVersionGraph(getDb(), user, id).catch((err) => {
    if (err instanceof CourseError) notFound();
    throw err;
  });

  // Question pool shortages (F3-R6) are for those who can fill the pools, not for students.
  const pools =
    graph.course.authorId === user.id || hasRole(user, 'admin', 'expert')
      ? await poolIssues(getDb(), id, loadConfig().questions)
      : [];

  const layers = nodeLayers(graph);
  const states = placeholderNodeStates({ nodes: graph.nodes, edges: graph.edges });
  const skillName = new Map(graph.skills.map((s) => [s.id, s.name]));
  const layerSize = new Map<number, number>();
  for (const layer of layers.values()) layerSize.set(layer, (layerSize.get(layer) ?? 0) + 1);
  const placed = new Map<number, number>();
  const flowNodes: Node<GraphNodeData>[] = graph.nodes.map((n) => {
    const layer = layers.get(n.id)!;
    const index = placed.get(layer) ?? 0;
    placed.set(layer, index + 1);
    // Layers run top to bottom; each one is centred on x = 0.
    const x = (index - (layerSize.get(layer)! - 1) / 2) * NODE_GAP_X;
    return {
      id: n.id,
      type: 'course',
      position: n.position ?? { x, y: layer * LAYER_GAP_Y },
      data: {
        title: n.title,
        href: `/courses/${id}/nodes/${n.id}`,
        summary: n.summary,
        skillNames: n.skillIds.map((s) => skillName.get(s)!),
        state: states.get(n.id)!,
      },
    };
  });

  return (
    <div className="card wide">
      <p>
        <Link href="/courses">← Усі курси</Link>
      </p>
      <h1>
        {graph.version.title} <span className="muted">v{graph.version.versionNo}</span>
      </h1>
      <p className="muted">
        {versionStatusLabels[graph.version.status]} · {graph.nodes.length} вузлів ·{' '}
        {graph.skills.length} навичок
      </p>
      {graph.version.description && <p>{graph.version.description}</p>}
      {graph.issues.length > 0 && (
        <ul className="error" data-testid="graph-issues">
          {graph.issues.map((i, k) => (
            <li key={k}>{i.message}</li>
          ))}
        </ul>
      )}
      {pools.length > 0 && (
        <details data-testid="pool-issues">
          <summary className="error">
            Недостатньо перевірених питань: {pools.length} (потрібно для публікації)
          </summary>
          <ul className="error">
            {pools.map((i, k) => (
              <li key={k}>{i.message}</li>
            ))}
          </ul>
        </details>
      )}
      <CourseGraph
        nodes={flowNodes}
        edges={graph.edges.map((e) => ({ id: `${e.from}-${e.to}`, source: e.from, target: e.to }))}
      />
      <p className="hint">
        Стани вузлів умовні: прогрес студента зʼявиться разом із рушієм навчання.
      </p>
    </div>
  );
}
