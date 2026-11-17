import { readFileSync } from 'node:fs';
import { courseVersions, contentItems, createDb, questions, users } from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config';
import { createEmbeddingClient } from '../src/content/providers';
import { indexNode } from '../src/content/indexing';
import { getVersionGraph, importCourse } from '../src/courses';

// Usage: pnpm seed-experiment <author email>
// Imports and publishes the two study topics (slugs from EXPERIMENT_COURSE_A/B) with demo content and questions.
// Publishing here stands in for M08 (audit and publication), which does not exist yet.
const [email] = process.argv.slice(2);
if (!email) {
  console.error('Usage: pnpm seed-experiment <author email>');
  process.exit(1);
}

interface Q {
  q: string;
  options: string[];
  correct: number;
}
interface Topic {
  course: { nodes: { key: string; title: string }[] } & Record<string, unknown>;
  content: Record<string, string>;
  questions: Record<'node' | 'assessment', Record<string, Q[]>>;
}

const seed = JSON.parse(
  readFileSync(new URL('../seed/experiment-modules.json', import.meta.url), 'utf8'),
) as Record<'A' | 'B', Topic>;
const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
try {
  const [author] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()));
  if (!author) throw new Error(`No user with email ${email}`);
  const embedder = createEmbeddingClient(db, config);
  const admin = { id: author.id, email, displayName: 'seed', roles: ['author' as const] };

  for (const module of ['A', 'B'] as const) {
    const topic = seed[module];
    const slug = config.experiment.courseSlugs[module];
    const { versionId } = await importCourse(db, { ...topic.course, slug }, author.id);
    const graph = await getVersionGraph(db, admin, versionId);
    for (const node of topic.course.nodes) {
      const row = graph.nodes.find((g) => g.title === node.title)!;
      await db.insert(contentItems).values({
        nodeId: row.id,
        kind: 'markdown',
        title: node.title,
        ord: 0,
        bodyMd: topic.content[node.key],
      });
      await indexNode(db, embedder, row.id);
      for (const pool of ['node', 'assessment'] as const) {
        await db.insert(questions).values(
          topic.questions[pool][node.key]!.map((q) => ({
            nodeId: row.id,
            skillId: row.skillIds[0]!,
            pool,
            kind: 'mcq' as const,
            promptMd: q.q,
            options: q.options,
            answerKey: { optionIndex: q.correct },
            guess: 1 / q.options.length,
            status: 'validated' as const,
          })),
        );
      }
    }
    await db
      .update(courseVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(courseVersions.id, versionId));
    console.log(`Topic ${module}: published ${slug} (version ${versionId})`);
  }
} catch (err) {
  console.error(err instanceof Error ? `Failed: ${err.message}` : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
