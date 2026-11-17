import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CourseError,
  EDITABLE_STATUSES,
  experimentContext,
  getAuditView,
  experimentSettings,
  getParticipation,
  getProgress,
  getVersionGraph,
  hasRole,
  loadConfig,
  nodeLayers,
  placeholderNodeStates,
  poolIssues,
} from '@eduforge/core';
import { CourseGraph, type GraphNodeData } from '@/components/CourseGraph';
import { AuditSection } from '@/components/AuditSection';
import { EnrollButton } from '@/components/EnrollButton';
import { GraphEditor } from '@/components/GraphEditor';
import { VersionDetailsForm } from '@/components/VersionDetailsForm';
import { levelLabels, nodeStateLabels, ratingBand, versionStatusLabels } from '@/lib/messages';
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

  // The owner (or an admin) edits the course and runs its audit; the audit details are not for anyone else (F4-R7).
  const owner = graph.course.authorId === user.id || hasRole(user, 'admin');
  const editable = owner && EDITABLE_STATUSES.includes(graph.version.status);
  const audit = owner ? await getAuditView(getDb(), user, id) : null;

  // Question pool shortages (F3-R6) are for those who can fill the pools, not for students.
  const pools =
    graph.course.authorId === user.id || hasRole(user, 'admin', 'expert')
      ? await poolIssues(getDb(), id, loadConfig().questions)
      : [];

  // A study module (M07): the control condition has free navigation; enrolling follows the pre-test.
  const study = await experimentContext(getDb(), user.id, id);
  const studyStep = study
    ? (await getParticipation(getDb(), user, experimentSettings()))?.modules.find(
        (m) => m.versionId === id,
      )?.step
    : undefined;
  // Issue messages name nodes by id; show their titles instead.
  const withTitles = (message: string) =>
    graph.nodes.reduce((m, n) => m.replaceAll(n.id, `«${n.title}»`), message);
  const layers = nodeLayers(graph);
  const progress =
    graph.version.status === 'published' ? await getProgress(getDb(), user, id) : null;
  const placeholder = placeholderNodeStates({ nodes: graph.nodes, edges: graph.edges });
  const mine = new Map(progress?.map((p) => [p.nodeId, p]));
  const now = Date.now();
  const stateOf = (nodeId: string): GraphNodeData['state'] =>
    mine.get(nodeId)?.state ?? placeholder.get(nodeId)!;
  const noteOf = (nodeId: string) => {
    const until = mine.get(nodeId)?.cooldownUntil;
    return until ? `ще ${Math.max(1, Math.ceil((until.getTime() - now) / 60000))} хв` : undefined;
  };
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
        state: stateOf(n.id),
        note: noteOf(n.id),
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
      {graph.version.rating !== null && (
        <p className="rating-line" data-testid="course-rating">
          <span className="rating-badge">{graph.version.rating}/10</span>{' '}
          {levelLabels[ratingBand(graph.version.rating)]}
        </p>
      )}
      {graph.version.description && <p>{graph.version.description}</p>}
      {graph.issues.length > 0 && (
        <ul className="error" data-testid="graph-issues">
          {graph.issues.map((i, k) => (
            <li key={k}>{withTitles(i.message)}</li>
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
      {graph.version.status === 'published' && !progress && study && studyStep !== 'learning' && (
        <p data-testid="study-module-note">
          Це модуль дослідження. Почніть з вхідного тесту на сторінці{' '}
          <Link href="/experiment">Дослідження</Link>.
        </p>
      )}
      {graph.version.status === 'published' &&
        !progress &&
        (!study || studyStep === 'learning') && <EnrollButton versionId={id} />}
      {progress && study?.condition === 'control' && (
        <p className="hint" data-testid="free-navigation-note">
          Вільний режим: усі вузли відкриті, порядок обираєте самі. Тестів вузлів і репетитора тут
          немає. Коли закінчите, завершіть навчання на сторінці{' '}
          <Link href="/experiment">Дослідження</Link>.
        </p>
      )}
      {progress && (
        <p className="hint graph-legend" data-testid="graph-legend">
          {(['available', 'in_progress', 'passed', 'cooldown', 'locked'] as const).map((s) => (
            <span key={s} className={`legend-chip ${s}`}>
              {nodeStateLabels[s]}
            </span>
          ))}
          · пройдено {progress.filter((p) => p.state === 'passed').length} з {progress.length}
        </p>
      )}
      {editable ? (
        <GraphEditor
          versionId={id}
          flowNodes={flowNodes}
          nodes={graph.nodes}
          edges={graph.edges}
          skills={graph.skills}
        />
      ) : (
        <CourseGraph
          nodes={flowNodes}
          edges={graph.edges.map((e) => ({
            id: `${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
          }))}
        />
      )}
      {editable && (
        <VersionDetailsForm
          versionId={id}
          title={graph.version.title}
          description={graph.version.description}
          declaredLevel={graph.version.declaredLevel}
        />
      )}
      {audit && <AuditSection view={audit} />}
      {!progress && (
        <p className="hint">
          Стани вузлів умовні: прогрес зʼявиться після запису на опублікований курс.
        </p>
      )}
    </div>
  );
}
