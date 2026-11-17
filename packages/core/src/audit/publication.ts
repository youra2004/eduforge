import { courseVersions, type Db } from '@eduforge/db';
import { lt } from 'drizzle-orm';
import { z } from 'zod';
import { AuthError, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { canEdit, loadVersion } from '../courses/service';
import { rejectedReview } from './review';
import { TOP_RATING } from './rating';
import { auditSettings } from './pipeline';
import { moveVersion } from './transitions';

/** What the author gets when an expert rejects a candidate for 10: the cap, one step below the top (F4-R6). */
export const FALLBACK_RATING = TOP_RATING - 1;

/** The result of an audit that no longer describes the course. */
const clearedAudit = {
  rating: null,
  aiLevel: null,
  aiHardness: null,
  volumeCap: null,
  auditSummary: null,
};

async function ownVersion(db: Db, user: AuthUser | null, versionId: string) {
  const { version, course, user: actor } = await loadVersion(db, user, versionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  return version;
}

/**
 * Publishes a `ready_to_publish` version (F4, D-06). From here the version is immutable; students see its rating.
 * The status check is part of the UPDATE, so a double click or a concurrent reopen cannot publish twice.
 */
export async function publishVersion(db: Db, user: AuthUser | null, versionId: string) {
  await ownVersion(db, user, versionId);
  const row = await moveVersion(db, versionId, 'ready_to_publish', 'published', {
    publishedAt: new Date(),
  });
  if (!row?.rating) throw new CourseError('invalid_version_state');
  return row;
}

/**
 * The author takes a version that is ready to publish back to editing, to change its score before the final
 * publication (D-09). The old result is dropped, because it no longer describes the course.
 */
export async function reopenVersion(db: Db, user: AuthUser | null, versionId: string) {
  await ownVersion(db, user, versionId);
  // With no audit run left a draft could never be audited again, so the finished rating must not be thrown away.
  const row = await moveVersion(
    db,
    versionId,
    'ready_to_publish',
    'draft',
    clearedAudit,
    lt(courseVersions.auditAttempts, auditSettings().maxAttempts),
  );
  if (!row) throw new CourseError('invalid_version_state');
  return row;
}

/**
 * After an expert rejects rating 10 the author chooses (F4-R6): `improve` reopens the version for editing (a new audit
 * follows), `publish_9` publishes it now with the cap of 9. Only the rejection of the current audit attempt counts.
 */
export async function resolveRejection(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  input: unknown,
) {
  const choice = z
    .enum(['improve', 'publish_9'])
    .safeParse((input as { choice?: unknown })?.choice);
  if (!choice.success) {
    throw new CourseError('invalid_review', [
      { code: 'schema', message: 'Choose "improve" or "publish_9".', path: 'choice' },
    ]);
  }
  const version = await ownVersion(db, user, versionId);
  if (
    version.status !== 'expert_review' ||
    !(await rejectedReview(db, versionId, version.auditAttempts))
  ) {
    throw new CourseError('invalid_version_state');
  }
  const row =
    choice.data === 'improve'
      ? await moveVersion(
          db,
          versionId,
          'expert_review',
          'changes_requested',
          clearedAudit,
          lt(courseVersions.auditAttempts, auditSettings().maxAttempts),
        )
      : await moveVersion(db, versionId, 'expert_review', 'published', {
          rating: FALLBACK_RATING,
          publishedAt: new Date(),
        });
  if (!row) throw new CourseError('invalid_version_state');
  return row;
}
