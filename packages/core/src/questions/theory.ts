import { contentItems, courseVersions, nodes, nodeSkills, skills, type Db } from '@eduforge/db';
import { asc, eq } from 'drizzle-orm';
import { indexableText } from '../content/indexing';
import { CourseError } from '../courses/errors';
import { EDITABLE_STATUSES } from '../courses/service';
import type { SkillInfo } from './prompts';

/** The node's theory: its markdown and video transcripts in order. Empty text means nothing to ask about yet. */
export async function nodeTheory(db: Db, nodeId: string): Promise<string> {
  const items = await db
    .select()
    .from(contentItems)
    .where(eq(contentItems.nodeId, nodeId))
    .orderBy(asc(contentItems.ord), asc(contentItems.id));
  return items
    .map(indexableText)
    .filter((t) => t !== '')
    .join('\n\n');
}

export async function nodeSkillList(db: Db, nodeId: string): Promise<SkillInfo[]> {
  return db
    .select({ id: skills.id, name: skills.name, description: skills.description })
    .from(nodeSkills)
    .innerJoin(skills, eq(skills.id, nodeSkills.skillId))
    .where(eq(nodeSkills.nodeId, nodeId))
    .orderBy(asc(skills.name), asc(skills.id));
}

/** Whether the node's version may still change; generation and validation leave frozen versions alone (D-06). */
export async function nodeVersionEditable(db: Db, nodeId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ status: courseVersions.status })
    .from(nodes)
    .innerJoin(courseVersions, eq(courseVersions.id, nodes.courseVersionId))
    .where(eq(nodes.id, nodeId));
  return row ? EDITABLE_STATUSES.includes(row.status) : null;
}

export const noTheory = () =>
  new CourseError('invalid_question', [
    {
      code: 'schema',
      message: 'The node has no theory yet: add text or a video transcript first.',
    },
  ]);
