import { notFound } from 'next/navigation';
import {
  AuthError,
  CourseError,
  experimentContext,
  experimentSettings,
  getProgress,
  getVersionGraph,
  learningSettings,
  listNodeContent,
  listNodeQuestions,
  loadConfig,
} from '@eduforge/core';
import { NodeLearning } from '@/components/NodeLearning';
import { NodeTracker } from '@/components/NodeTracker';
import { ContentEditor } from '@/components/ContentEditor';
import { Markdown } from '@/components/Markdown';
import { QuestionBank, type BankQuestion } from '@/components/QuestionBank';
import { VideoPlayer } from '@/components/VideoPlayer';
import { EmptyState, PageHeader } from '@/components/ui';
import { nodeStateLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

const sourceLabels = { author: 'від автора', whisper: 'створено автоматично (Whisper)' };

export default async function NodePage({
  params,
}: {
  params: Promise<{ id: string; nodeId: string }>;
}) {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const { id, nodeId } = await params;
  const db = getDb();
  const orNotFound = (err: unknown): never => {
    if (err instanceof CourseError) notFound();
    throw err;
  };
  const graph = await getVersionGraph(db, user, id).catch(orNotFound);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) notFound();
  const opened = await listNodeContent(db, user, nodeId).catch((err) => {
    // The server refuses a locked node; the student gets a reason, not a 404.
    if (
      err instanceof CourseError &&
      (err.code === 'node_locked' ||
        err.code === 'not_enrolled' ||
        err.code === 'experiment_step_not_allowed')
    ) {
      return err.code;
    }
    return orNotFound(err);
  });
  if (typeof opened === 'string') {
    return (
      <div className="page focus" data-testid="node-closed">
        <PageHeader
          back={{ href: `/courses/${id}`, label: graph.version.title }}
          title={node.title}
        />
        <EmptyState icon="lock" title="Вузол ще закритий">
          {opened === 'node_locked'
            ? 'Спочатку пройдіть усі вузли, від яких він залежить.'
            : opened === 'experiment_step_not_allowed'
              ? 'Матеріали модуля відкриті лише під час навчання: після його завершення вони закриваються до кінця дослідження.'
              : 'Щоб відкрити вузол, запишіться на курс.'}
        </EmptyState>
      </div>
    );
  }
  const { items, canEdit } = opened;
  const now = new Date();
  const mine = (await getProgress(db, user, id, now))?.find((p) => p.nodeId === nodeId);
  const study = await experimentContext(db, user.id, id);
  // Questions carry answer keys, so only the course's author, admins and experts get them.
  const bank = await listNodeQuestions(db, user, nodeId).catch((err) => {
    if (err instanceof AuthError) return null;
    return orNotFound(err);
  });
  const problems = graph.issues.filter(
    (i) => i.nodeIds?.includes(nodeId) && i.code === 'video_without_transcript',
  );

  return (
    <div className="page">
      <PageHeader
        back={{ href: `/courses/${id}`, label: graph.version.title }}
        title={node.title}
        lead={node.summary || undefined}
        actions={
          mine ? (
            <span
              className={`badge ${mine.state === 'passed' ? 'ok' : mine.state === 'cooldown' ? 'warn' : 'accent'}`}
            >
              {nodeStateLabels[mine.state]}
            </span>
          ) : undefined
        }
      />
      {canEdit && problems.length > 0 && (
        <p className="error" data-testid="content-issues">
          Є відео без транскрипту ({problems.length}): такий курс не можна опублікувати.
        </p>
      )}
      {items.length === 0 && (
        <EmptyState icon="file" title="Тут ще порожньо">
          У цьому вузлі ще немає матеріалів.
        </EmptyState>
      )}
      {items.map((item) => (
        <article key={item.id} className="content-item" data-testid="content-item">
          <h2>{item.title}</h2>
          {item.kind === 'markdown' ? (
            <Markdown>{item.bodyMd ?? ''}</Markdown>
          ) : (
            <div className="video-lesson">
              <VideoPlayer
                src={item.videoStorageKey ? `/api/media/${item.videoStorageKey}` : item.videoUrl!}
                title={item.title}
                track={mine ? { nodeId, contentItemId: item.id } : undefined}
              />
              <aside className="transcript" data-testid="transcript">
                <h3>Транскрипт</h3>
                {item.transcriptText ? (
                  <>
                    <p className="hint">
                      {item.transcriptSource && sourceLabels[item.transcriptSource]}
                    </p>
                    <p>{item.transcriptText}</p>
                  </>
                ) : (
                  <p className="muted">Транскрипту ще немає.</p>
                )}
              </aside>
            </div>
          )}
        </article>
      ))}
      {mine && (
        <NodeTracker nodeId={nodeId} heartbeatSeconds={experimentSettings().heartbeatSeconds} />
      )}
      {mine && (
        <NodeLearning
          control={study?.condition === 'control'}
          nodeId={nodeId}
          state={mine.state}
          roundNo={mine.roundNo}
          attemptsInRound={mine.attemptsInRound}
          attemptsPerRound={learningSettings().attemptsPerRound}
          cooldownUntil={mine.cooldownUntil?.toISOString() ?? null}
          serverNow={now.toISOString()}
        />
      )}
      {canEdit && <ContentEditor nodeId={nodeId} items={items} />}
      {bank && (
        <QuestionBank
          nodeId={nodeId}
          skills={bank.skills}
          questions={bank.questions as unknown as BankQuestion[]}
          canEdit={bank.canEdit}
          need={loadConfig().questions.nodeMinPerSkill}
        />
      )}
    </div>
  );
}
