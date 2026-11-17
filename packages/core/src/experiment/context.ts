import {
  courses,
  courseVersions,
  experimentAssignments,
  experimentModules,
  type Db,
  type ExperimentCondition,
  type ExperimentModule,
} from '@eduforge/db';
import { and, desc, eq } from 'drizzle-orm';
import { loadConfig } from '../config';
import type { Tx } from '../courses/service';

export type CourseSlugs = Record<ExperimentModule, string>;
const configuredSlugs = (): CourseSlugs => loadConfig().experiment.courseSlugs;

/** Which topic (A or B) a course version is, or `null` for any other course. */
export async function moduleOfVersion(
  db: Db | Tx,
  versionId: string,
  slugs: CourseSlugs = configuredSlugs(),
): Promise<ExperimentModule | null> {
  const [row] = await db
    .select({ slug: courses.slug })
    .from(courseVersions)
    .innerJoin(courses, eq(courses.id, courseVersions.courseId))
    .where(eq(courseVersions.id, versionId));
  return experimentModules.find((m) => slugs[m] === row?.slug) ?? null;
}

export interface ExperimentContext {
  module: ExperimentModule;
  condition: ExperimentCondition;
  period: number;
}

/** The participant's module and condition for this course version; `null` outside the study. */
export async function experimentContext(
  db: Db | Tx,
  userId: string,
  versionId: string,
  slugs?: CourseSlugs,
): Promise<ExperimentContext | null> {
  const module = await moduleOfVersion(db, versionId, slugs);
  if (!module) return null;
  const [a] = await db
    .select()
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.userId, userId), eq(experimentAssignments.module, module)));
  return a ? { module, condition: a.condition, period: a.period } : null;
}

/** The newest published version of the topic's course. A running study must not publish a new one (ADR-0010). */
export async function moduleVersion(
  db: Db | Tx,
  module: ExperimentModule,
  slugs: CourseSlugs = configuredSlugs(),
) {
  const [row] = await db
    .select({ id: courseVersions.id, title: courseVersions.title })
    .from(courseVersions)
    .innerJoin(courses, eq(courses.id, courseVersions.courseId))
    .where(and(eq(courses.slug, slugs[module]), eq(courseVersions.status, 'published')))
    .orderBy(desc(courseVersions.versionNo))
    .limit(1);
  return row ?? null;
}
