import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseError, getVersionGraph, listNodeContent } from '@eduforge/core';
import { ContentEditor } from '@/components/ContentEditor';
import { Markdown } from '@/components/Markdown';
import { VideoPlayer } from '@/components/VideoPlayer';
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
  const { items, canEdit } = await listNodeContent(db, user, nodeId).catch(orNotFound);
  const problems = graph.issues.filter(
    (i) => i.nodeIds?.includes(nodeId) && i.code === 'video_without_transcript',
  );

  return (
    <div className="card wide">
      <p>
        <Link href={`/courses/${id}`}>← {graph.version.title}</Link>
      </p>
      <h1>{node.title}</h1>
      {node.summary && <p className="muted">{node.summary}</p>}
      {canEdit && problems.length > 0 && (
        <p className="error" data-testid="content-issues">
          Є відео без транскрипту ({problems.length}): такий курс не можна опублікувати.
        </p>
      )}
      {items.length === 0 && <p className="muted">У цьому вузлі ще немає матеріалів.</p>}
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
      {canEdit && <ContentEditor nodeId={nodeId} items={items} />}
    </div>
  );
}
