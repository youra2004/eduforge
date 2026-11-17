import {
  skills,
  type Db,
  type ReviewChecklist,
  type ReviewStatus,
  type VersionStatus,
} from '@eduforge/db';
import { asc, eq } from 'drizzle-orm';
import { AuthError, type AuthUser } from '../auth/guard';
import { canEdit, EDITABLE_STATUSES, loadVersion } from '../courses/service';
import { auditSettings, type AuditSettings, type AuditSummary } from './pipeline';
import { rejectedReview, currentReview } from './review';

export interface AuditView {
  versionId: string;
  status: VersionStatus;
  attemptsUsed: number;
  attemptsMax: number;
  canSubmit: boolean;
  rating: number | null;
  level: string | null;
  hardness: number | null;
  summary: AuditSummary | null;
  skills: { id: string; name: string; verified: boolean | null; note: string | null }[];
  review: { status: ReviewStatus; checklist: ReviewChecklist | null } | null;
  /** The expert rejected rating 10: the author must choose between improving and publishing with 9. */
  awaitingChoice: boolean;
}

/**
 * What the author sees about the audit (F4-R7): rating, level, hardness, feedback per category and the skill check.
 * The volume cap and the formula's bands are left out on purpose; the summary only says whether size held the score down.
 */
export async function getAuditView(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  settings: AuditSettings = auditSettings(),
): Promise<AuditView> {
  const { version, course, user: actor } = await loadVersion(db, user, versionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  const skillRows = await db
    .select({
      id: skills.id,
      name: skills.name,
      verified: skills.verified,
      note: skills.verificationNote,
    })
    .from(skills)
    .where(eq(skills.courseVersionId, versionId))
    .orderBy(asc(skills.name));
  const review =
    version.status === 'expert_review'
      ? await currentReview(db, versionId, version.auditAttempts)
      : null;
  return {
    versionId,
    status: version.status,
    attemptsUsed: version.auditAttempts,
    attemptsMax: settings.maxAttempts,
    canSubmit:
      EDITABLE_STATUSES.includes(version.status) && version.auditAttempts < settings.maxAttempts,
    rating: version.rating,
    level: version.aiLevel,
    hardness: version.aiHardness,
    summary: (version.auditSummary as AuditSummary | null) ?? null,
    skills: skillRows,
    review: review ? { status: review.status, checklist: review.checklist } : null,
    awaitingChoice:
      version.status === 'expert_review' &&
      !!(await rejectedReview(db, versionId, version.auditAttempts)),
  };
}
