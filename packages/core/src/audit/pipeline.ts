import { auditRuns, courseVersions, courses, skills, type AuditStage, type Db } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { AuthError, type AuthUser } from '../auth/guard';
import { loadConfig } from '../config';
import { CourseError } from '../courses/errors';
import { canEdit, EDITABLE_STATUSES, loadVersion, type Tx } from '../courses/service';
import type { PoolMinimums } from '../questions/pools';
import { notify } from './notifications';
import { loadAuditMaterial } from './material';
import {
  CONFORMITY_SYSTEM,
  CONFORMITY_VERSION,
  SCORING_SYSTEM,
  SCORING_VERSION,
  SKILLS_SYSTEM,
  SKILLS_VERSION,
  conformityPrompt,
  scoringPrompt,
  skillsPrompt,
} from './prompts';
import { medianRun, rate, volumeCap, type RatingConfig, type ScoringRun } from './rating';
import { conformitySchema, scoringSchema, skillsSchema } from './schema';
import { structureIssues } from './structure';
import { moveVersion } from './transitions';

/** Queue name and payload shared by the web app (which sends the job) and the worker (which runs it). */
export const AUDIT_QUEUE = 'audit.run';

export interface AuditJob {
  versionId: string;
  /** The attempt this job was queued for; a job left over from an earlier attempt does nothing. */
  attemptNo: number;
}

export interface AuditSettings {
  maxAttempts: number;
  scoringRuns: number;
  rating: RatingConfig;
  pools: PoolMinimums;
}

export function auditSettings(config = loadConfig()): AuditSettings {
  return {
    maxAttempts: config.audit.maxAttempts,
    scoringRuns: config.audit.scoringRuns,
    rating: {
      bands: { junior: [1, 3], middle: [4, 6], senior: [7, 9] },
      volumeCaps: config.audit.volumeCaps,
    },
    pools: config.questions,
  };
}

export type AuditFailure = 'structure' | 'conformity' | 'skills' | 'technical';

/** What `course_versions.audit_summary` holds: the author's feedback. It never carries thresholds (F4-R7). */
export interface AuditSummary {
  attemptNo: number;
  outcome: 'changes_requested' | 'ready_to_publish' | 'expert_review';
  failedStage?: AuditFailure;
  issues?: { code: string; message: string }[];
  mismatches?: string[];
  conformityFeedback?: string;
  uncoveredSkills?: { skillId: string; name: string; note: string }[];
  feedback?: { theoryDepth: string; questionTrickiness: string; edgeCases: string };
  /** The course's size, not its depth, kept the score down. */
  limitedByVolume?: boolean;
}

/**
 * The author sends an editable version to the audit (F4). Problems that the deterministic stage would find are
 * reported now and cost no run. The status change and the run count are one guarded UPDATE: a double click or a
 * sixth run cannot get past it (D-09b).
 */
export async function submitForAudit(
  db: Db,
  user: AuthUser | null,
  versionId: string,
  settings: AuditSettings = auditSettings(),
): Promise<AuditJob> {
  const { version, course, user: actor } = await loadVersion(db, user, versionId);
  if (!canEdit(actor, course.authorId)) throw new AuthError('forbidden');
  if (!EDITABLE_STATUSES.includes(version.status)) throw new CourseError('invalid_version_state');
  if (version.auditAttempts >= settings.maxAttempts) throw new CourseError('audit_limit_reached');

  const { issues } = await structureIssues(db, versionId, settings.pools);
  if (issues.length > 0) throw new CourseError('invalid_course', issues);

  const [row] = await db
    .update(courseVersions)
    .set({
      status: 'auditing',
      auditAttempts: sql`${courseVersions.auditAttempts} + 1`,
      rating: null,
      aiLevel: null,
      aiHardness: null,
      volumeCap: null,
      auditSummary: null,
    })
    .where(
      and(
        eq(courseVersions.id, versionId),
        inArray(courseVersions.status, EDITABLE_STATUSES),
        lt(courseVersions.auditAttempts, settings.maxAttempts),
      ),
    )
    .returning({ attemptNo: courseVersions.auditAttempts });
  if (!row) {
    // Someone else got in first: say which door was closed.
    const [now] = await db
      .select({ status: courseVersions.status, attempts: courseVersions.auditAttempts })
      .from(courseVersions)
      .where(eq(courseVersions.id, versionId));
    throw new CourseError(
      now && EDITABLE_STATUSES.includes(now.status) && now.attempts >= settings.maxAttempts
        ? 'audit_limit_reached'
        : 'invalid_version_state',
    );
  }
  return { versionId, attemptNo: row.attemptNo };
}

async function record(
  db: Db,
  versionId: string,
  attemptNo: number,
  stage: AuditStage,
  status: 'passed' | 'failed',
  result: Record<string, unknown>,
) {
  await db
    .insert(auditRuns)
    .values({ courseVersionId: versionId, attemptNo, stage, status, result })
    .onConflictDoUpdate({
      target: [auditRuns.courseVersionId, auditRuns.attemptNo, auditRuns.stage],
      // The database's clock, like the review's `created_at`: a review is tied to its attempt by comparing the two.
      set: { status, result, createdAt: sql`now()` },
    });
}

type Finished = Pick<AuditSummary, 'outcome'> & {
  set: Partial<typeof courseVersions.$inferInsert>;
  summary: AuditSummary;
};

/** Ends the attempt: moves the version out of `auditing` and tells the author, in one transaction. A stale job changes nothing. */
async function finish(db: Db, versionId: string, attemptNo: number, done: Finished) {
  return db.transaction(async (tx: Tx) => {
    const row = await moveVersion(
      tx,
      versionId,
      'auditing',
      done.outcome,
      { ...done.set, auditSummary: done.summary },
      eq(courseVersions.auditAttempts, attemptNo),
    );
    if (!row) return false;
    const [course] = await tx
      .select({ authorId: courses.authorId })
      .from(courses)
      .where(eq(courses.id, row.courseId));
    const payload = {
      versionId,
      title: row.title,
      outcome: done.outcome,
      failedStage: done.summary.failedStage,
    };
    await notify(
      tx,
      course!.authorId,
      done.outcome === 'expert_review'
        ? 'expert_review_started'
        : done.summary.failedStage === 'technical'
          ? 'audit_failed'
          : 'audit_finished',
      { ...payload, rating: done.set.rating ?? null },
    );
    return true;
  });
}

export type AuditOutcome =
  | { status: 'skipped' }
  | { status: AuditSummary['outcome']; failedStage?: AuditFailure; rating?: number | null };

/**
 * The audit pipeline (F4): structure and volume cap (stage 0) → conformity gate (1) → skill verification (2) → scoring
 * with N runs and the median (3). Every LLM call goes through `LLMClient` and lands in `llm_runs`. A stage that fails ends
 * the attempt with `changes_requested`; rating 10 goes to an expert instead of being published (F4-R6). Safe to run
 * again for the same attempt (the worker retries): stage rows are overwritten and a finished attempt is skipped.
 */
export async function runAudit(
  db: Db,
  llm: LLMClient,
  job: AuditJob,
  settings: AuditSettings = auditSettings(),
): Promise<AuditOutcome> {
  const { versionId, attemptNo } = job;
  const [version] = await db
    .select({ status: courseVersions.status, attempts: courseVersions.auditAttempts })
    .from(courseVersions)
    .where(eq(courseVersions.id, versionId));
  if (version?.status !== 'auditing' || version.attempts !== attemptNo)
    return { status: 'skipped' };

  const stop = async (failedStage: AuditFailure, extra: Partial<AuditSummary>) => {
    const summary: AuditSummary = {
      attemptNo,
      outcome: 'changes_requested',
      failedStage,
      ...extra,
    };
    await finish(db, versionId, attemptNo, { outcome: 'changes_requested', set: {}, summary });
    return { status: 'changes_requested', failedStage } as const;
  };
  const subject = { type: 'course_version', id: versionId };

  // Stage 0: structure, then the volume cap.
  const { issues, nodeCount } = await structureIssues(db, versionId, settings.pools);
  await record(db, versionId, attemptNo, 'structure', issues.length > 0 ? 'failed' : 'passed', {
    issues: issues.map((i) => ({ code: i.code, message: i.message })),
  });
  const cap = volumeCap(nodeCount, settings.rating.volumeCaps);
  await record(db, versionId, attemptNo, 'volume', 'passed', { nodes: nodeCount, cap });
  if (issues.length > 0) {
    return stop('structure', { issues: issues.map((i) => ({ code: i.code, message: i.message })) });
  }

  const material = await loadAuditMaterial(db, versionId);

  // Stage 1: does the course deliver what it declares? (F4-R2)
  const conformity = (
    await llm.generate({
      purpose: 'audit_conformity',
      promptVersion: CONFORMITY_VERSION,
      system: CONFORMITY_SYSTEM,
      prompt: conformityPrompt(material),
      schema: conformitySchema,
      cache: false,
      subject,
    })
  ).data;
  const mismatches =
    conformity.matches || conformity.mismatches.length > 0
      ? conformity.mismatches
      : ['Матеріали не відповідають заявленому опису курсу.'];
  await record(db, versionId, attemptNo, 'conformity', conformity.matches ? 'passed' : 'failed', {
    matches: conformity.matches,
    mismatches,
    feedback: conformity.feedback,
  });
  if (!conformity.matches) {
    return stop('conformity', { mismatches, conformityFeedback: conformity.feedback });
  }

  // Stage 2: is every declared skill taught? (F4-R3)
  const verdicts = (
    await llm.generate({
      purpose: 'audit_skills',
      promptVersion: SKILLS_VERSION,
      system: SKILLS_SYSTEM,
      prompt: skillsPrompt(material),
      schema: skillsSchema,
      cache: false,
      subject,
    })
  ).data;
  const verdictOf = new Map(verdicts.skills.map((v) => [v.skillId, v]));
  const checked = material.skills.map((s) => {
    const v = verdictOf.get(s.id);
    return {
      skillId: s.id,
      name: s.name,
      covered: v?.covered === true,
      note: v?.note || (v ? '' : 'Аудитор не дав відповіді щодо цієї навички.'),
    };
  });
  const uncovered = checked.filter((s) => !s.covered);
  await db.transaction(async (tx) => {
    for (const s of checked) {
      await tx
        .update(skills)
        .set({ verified: s.covered, verificationNote: s.note })
        .where(eq(skills.id, s.skillId));
    }
  });
  await record(db, versionId, attemptNo, 'skills', uncovered.length > 0 ? 'failed' : 'passed', {
    skills: checked,
  });
  if (uncovered.length > 0) {
    return stop('skills', {
      uncoveredSkills: uncovered.map(({ skillId, name, note }) => ({ skillId, name, note })),
    });
  }

  // Stage 3: N independent runs, the median of them (F4-R4), then the formula (F4-R5).
  const prompt = scoringPrompt(material);
  const scored = await Promise.all(
    Array.from({ length: settings.scoringRuns }, (_, i) =>
      llm
        .generate({
          purpose: 'audit_scoring',
          promptVersion: SCORING_VERSION,
          system: SCORING_SYSTEM,
          prompt,
          schema: scoringSchema,
          params: { run: i + 1, runs: settings.scoringRuns },
          cache: false,
          subject,
        })
        .then((r) => ({ ...r.data, runId: r.runId })),
    ),
  );
  const runs: ScoringRun[] = scored.map(({ level, hardness }) => ({ level, hardness }));
  const median = medianRun(runs);
  const result = rate(median.level, median.hardness, nodeCount, settings.rating);
  // The feedback comes from the run that agrees with the median level and is closest to its hardness.
  const closest =
    scored
      .filter((s) => s.level === median.level)
      .sort(
        (a, b) => Math.abs(a.hardness - median.hardness) - Math.abs(b.hardness - median.hardness),
      )[0] ?? scored[0]!;
  await record(db, versionId, attemptNo, 'scoring', 'passed', {
    runs: scored.map(({ level, hardness, runId }) => ({ level, hardness, llmRunId: runId })),
    median,
    ...result,
  });

  const outcome = result.needsExpert ? 'expert_review' : 'ready_to_publish';
  const rating = result.needsExpert ? null : result.final;
  await finish(db, versionId, attemptNo, {
    outcome,
    set: {
      rating,
      aiLevel: median.level,
      aiHardness: median.hardness,
      volumeCap: result.volumeCap,
    },
    summary: {
      attemptNo,
      outcome,
      feedback: closest.feedback,
      limitedByVolume: result.limitedByVolume,
    },
  });
  return { status: outcome, rating };
}

/**
 * The audit could not finish (the provider kept failing). The author did nothing wrong, so the run is given back and
 * the version returns to `changes_requested`, where it can be sent again.
 */
export async function failAudit(db: Db, job: AuditJob) {
  return db.transaction(async (tx: Tx) => {
    const row = await moveVersion(
      tx,
      job.versionId,
      'auditing',
      'changes_requested',
      {
        auditAttempts: sql`${courseVersions.auditAttempts} - 1`,
        auditSummary: {
          attemptNo: job.attemptNo,
          outcome: 'changes_requested',
          failedStage: 'technical',
        } satisfies AuditSummary,
      },
      eq(courseVersions.auditAttempts, job.attemptNo),
    );
    if (!row) return false;
    const [course] = await tx
      .select({ authorId: courses.authorId })
      .from(courses)
      .where(eq(courses.id, row.courseId));
    await notify(tx, course!.authorId, 'audit_failed', {
      versionId: job.versionId,
      title: row.title,
      outcome: 'changes_requested',
      failedStage: 'technical',
    });
    return true;
  });
}

/** Audits that were started but never finished (for example the worker was down): the worker queues them again at start. */
export async function findAuditingJobs(db: Db): Promise<AuditJob[]> {
  const rows = await db
    .select({ versionId: courseVersions.id, attemptNo: courseVersions.auditAttempts })
    .from(courseVersions)
    .where(eq(courseVersions.status, 'auditing'));
  return rows;
}
