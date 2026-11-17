import {
  auditRuns,
  courseVersions,
  courses,
  expertReviews,
  userRoles,
  users,
  type Db,
  type ExpertReview,
  type ReviewChecklist,
} from '@eduforge/db';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import type { Tx } from '../courses/service';
import { notify } from './notifications';
import { TOP_RATING } from './rating';
import { moveVersion } from './transitions';

/** What the simulated expert ticks (D-10). Approving needs every item; the keys are stored with the decision. */
export const CHECKLIST_ITEMS = [
  'theory_accuracy',
  'expert_depth',
  'questions_quality',
  'skills_coverage',
  'edge_cases',
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

const decisionInput = z.object({
  decision: z.enum(['approved', 'rejected']),
  items: z.record(z.string(), z.boolean()),
  comment: z.string().trim().max(5000).default(''),
});

export interface ReviewProblem {
  message: string;
  path?: string;
}

/** Pure rules of a decision: every item answered; approval needs all ticked; a rejection needs a reason for the author. */
export function validateDecision(input: unknown):
  | {
      ok: true;
      decision: 'approved' | 'rejected';
      checklist: ReviewChecklist;
    }
  | { ok: false; problems: ReviewProblem[] } {
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => ({ message: i.message, path: i.path.join('.') })),
    };
  }
  const { decision, items, comment } = parsed.data;
  const problems: ReviewProblem[] = [];
  const answers: Record<string, boolean> = {};
  for (const key of CHECKLIST_ITEMS) {
    if (typeof items[key] !== 'boolean') {
      problems.push({ message: `Checklist item "${key}" is not answered.`, path: `items.${key}` });
    } else answers[key] = items[key];
  }
  if (problems.length === 0) {
    if (decision === 'approved' && Object.values(answers).some((v) => !v)) {
      problems.push({ message: 'A course can only be approved when every item is ticked.' });
    }
    if (decision === 'rejected' && comment === '') {
      problems.push({ message: 'A rejection needs a comment for the author.', path: 'comment' });
    }
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, decision, checklist: { items: answers, comment } };
}

const invalid = (problems: ReviewProblem[]) =>
  new CourseError(
    'invalid_review',
    problems.map((p) => ({ code: 'schema' as const, message: p.message, path: p.path })),
  );

/**
 * The review of the version's current audit attempt: the newest review created after that attempt's scoring finished.
 * An older review (from an attempt the author improved after a rejection) does not count.
 */
export async function currentReview(
  db: Db | Tx,
  versionId: string,
  attemptNo: number,
): Promise<ExpertReview | null> {
  const [scoring] = await db
    .select({ at: auditRuns.createdAt })
    .from(auditRuns)
    .where(
      and(
        eq(auditRuns.courseVersionId, versionId),
        eq(auditRuns.attemptNo, attemptNo),
        eq(auditRuns.stage, 'scoring'),
      ),
    );
  if (!scoring) return null;
  const [review] = await db
    .select()
    .from(expertReviews)
    .where(
      and(eq(expertReviews.courseVersionId, versionId), gte(expertReviews.createdAt, scoring.at)),
    )
    .orderBy(desc(expertReviews.createdAt))
    .limit(1);
  return review ?? null;
}

/** The people an admin can pick from. */
export async function listExperts(db: Db, admin: AuthUser | null) {
  requireRole(admin, 'admin');
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(userRoles.role, 'expert'))
    .orderBy(asc(users.displayName));
}

/** F11: the course review queue. Every version waiting for (or holding) an expert decision, with its current review. */
export async function listReviewQueue(db: Db, admin: AuthUser | null) {
  requireRole(admin, 'admin');
  const versions = await db
    .select({
      versionId: courseVersions.id,
      title: courseVersions.title,
      versionNo: courseVersions.versionNo,
      attemptNo: courseVersions.auditAttempts,
      authorName: users.displayName,
    })
    .from(courseVersions)
    .innerJoin(courses, eq(courses.id, courseVersions.courseId))
    .innerJoin(users, eq(users.id, courses.authorId))
    .where(eq(courseVersions.status, 'expert_review'))
    .orderBy(asc(courseVersions.createdAt));
  return Promise.all(
    versions.map(async (v) => {
      const review = await currentReview(db, v.versionId, v.attemptNo);
      const [expert] = review
        ? await db
            .select({ displayName: users.displayName })
            .from(users)
            .where(eq(users.id, review.expertId))
        : [];
      return {
        ...v,
        review: review ? { id: review.id, status: review.status } : null,
        expertName: expert?.displayName ?? null,
      };
    }),
  );
}

/** An admin assigns (or re-assigns, until a decision is made) the expert for a version in `expert_review` (D-03, F4-R6). */
export async function assignExpert(
  db: Db,
  admin: AuthUser | null,
  input: { versionId: unknown; expertId: unknown },
) {
  const actor = requireRole(admin, 'admin');
  const parsed = z.object({ versionId: z.uuid(), expertId: z.uuid() }).safeParse(input);
  if (!parsed.success) throw new CourseError('review_not_found');
  const { versionId, expertId } = parsed.data;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ version: courseVersions, authorId: courses.authorId })
      .from(courseVersions)
      .innerJoin(courses, eq(courses.id, courseVersions.courseId))
      .where(eq(courseVersions.id, versionId))
      .for('update', { of: courseVersions });
    if (!row) throw new CourseError('course_not_found');
    if (row.version.status !== 'expert_review') throw new CourseError('invalid_version_state');

    const [expert] = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(users.id, expertId), eq(userRoles.role, 'expert')));
    if (!expert)
      throw invalid([{ message: 'The chosen user is not an expert.', path: 'expertId' }]);
    if (expert.id === row.authorId) {
      throw invalid([{ message: 'An expert cannot review their own course.', path: 'expertId' }]);
    }

    const current = await currentReview(tx, versionId, row.version.auditAttempts);
    if (current && current.status !== 'assigned') throw new CourseError('review_conflict');
    let reviewId: string;
    if (current) {
      await tx
        .update(expertReviews)
        .set({ expertId, assignedBy: actor.id })
        .where(eq(expertReviews.id, current.id));
      reviewId = current.id;
    } else {
      const [created] = await tx
        .insert(expertReviews)
        .values({ courseVersionId: versionId, expertId, assignedBy: actor.id })
        .returning({ id: expertReviews.id });
      reviewId = created!.id;
    }
    await notify(tx, expertId, 'review_assigned', {
      versionId,
      reviewId,
      title: row.version.title,
    });
    return { reviewId };
  });
}

async function reviewRow(db: Db, reviewId: string) {
  const [row] = z.uuid().safeParse(reviewId).success
    ? await db
        .select({ review: expertReviews, version: courseVersions, authorId: courses.authorId })
        .from(expertReviews)
        .innerJoin(courseVersions, eq(courseVersions.id, expertReviews.courseVersionId))
        .innerJoin(courses, eq(courses.id, courseVersions.courseId))
        .where(eq(expertReviews.id, reviewId))
    : [];
  return row;
}

/** An expert's own reviews, newest first. */
export async function listMyReviews(db: Db, user: AuthUser | null) {
  const expert = requireRole(user, 'expert');
  return db
    .select({
      reviewId: expertReviews.id,
      status: expertReviews.status,
      versionId: courseVersions.id,
      title: courseVersions.title,
      versionNo: courseVersions.versionNo,
      declaredLevel: courseVersions.declaredLevel,
      createdAt: expertReviews.createdAt,
    })
    .from(expertReviews)
    .innerJoin(courseVersions, eq(courseVersions.id, expertReviews.courseVersionId))
    .where(eq(expertReviews.expertId, expert.id))
    .orderBy(desc(expertReviews.createdAt));
}

/** One review for its expert (or an admin): the course, the audit's findings and the checklist so far. */
export async function getReview(db: Db, user: AuthUser | null, reviewId: string) {
  const actor = requireRole(user, 'expert', 'admin');
  const row = await reviewRow(db, reviewId);
  if (!row || (row.review.expertId !== actor.id && !actor.roles.includes('admin'))) {
    throw new CourseError('review_not_found');
  }
  const { review, version } = row;
  return {
    review: {
      id: review.id,
      status: review.status,
      checklist: review.checklist,
      decidedAt: review.decidedAt,
    },
    version: {
      id: version.id,
      title: version.title,
      description: version.description,
      versionNo: version.versionNo,
      declaredLevel: version.declaredLevel,
      aiLevel: version.aiLevel,
      aiHardness: version.aiHardness,
      volumeCap: version.volumeCap,
      auditSummary: version.auditSummary,
    },
    canDecide: review.status === 'assigned' && review.expertId === actor.id,
  };
}

/**
 * The assigned expert decides (D-10). `approved` confirms rating 10: the version becomes `ready_to_publish` for its
 * author. `rejected` keeps the version in `expert_review` with the checklist, and the author chooses what to do next
 * (`resolveRejection`). Either way the author is notified.
 */
export async function decideReview(
  db: Db,
  user: AuthUser | null,
  reviewId: string,
  input: unknown,
) {
  const expert = requireRole(user, 'expert');
  const row = await reviewRow(db, reviewId);
  if (!row || row.review.expertId !== expert.id) throw new CourseError('review_not_found');
  const checked = validateDecision(input);
  if (!checked.ok) throw invalid(checked.problems);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: expertReviews.status, expertId: expertReviews.expertId })
      .from(expertReviews)
      .where(eq(expertReviews.id, reviewId))
      .for('update');
    // Re-checked under the lock: an admin may have moved the review to another expert since it was read.
    if (locked?.expertId !== expert.id) throw new CourseError('review_not_found');
    if (locked.status !== 'assigned') throw new CourseError('review_conflict');

    if (checked.decision === 'approved') {
      const moved = await moveVersion(tx, row.version.id, 'expert_review', 'ready_to_publish', {
        rating: TOP_RATING,
      });
      if (!moved) throw new CourseError('invalid_version_state');
    }
    await tx
      .update(expertReviews)
      .set({ status: checked.decision, checklist: checked.checklist, decidedAt: new Date() })
      .where(eq(expertReviews.id, reviewId));
    await notify(tx, row.authorId, 'review_decided', {
      versionId: row.version.id,
      title: row.version.title,
      decision: checked.decision,
    });
    return { decision: checked.decision };
  });
}

/** Used by the publication step: the author's pending choice exists only after a rejection of the current attempt. */
export async function rejectedReview(db: Db | Tx, versionId: string, attemptNo: number) {
  const review = await currentReview(db, versionId, attemptNo);
  return review?.status === 'rejected' ? review : null;
}
