import { createHash } from 'node:crypto';
import type { Db } from '@eduforge/db';
import { sql } from 'drizzle-orm';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = 3;

export interface WindowMetrics {
  days: number;
  /** Average net change of P(known) over the skills practiced in the window; null when none were. */
  masteryTrend: number | null;
  skillsPracticed: number;
  testsPassed: number;
  testsFailed: number;
}

export interface Metrics {
  w7: WindowMetrics;
  w30: WindowMetrics;
  /** Practiced skills still below the pass threshold, weakest first. */
  weakSkills: { skill: string; course: string; pKnown: number }[];
  /** Active courses with no finished test in the last 7 days (F7-R1 "missed activities"). */
  missed: { course: string }[];
  /** Nodes (or the exam) failed in the last 30 days and not passed since, most failures first. */
  failures: { node: string; course: string; failed: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString();

async function windowMetrics(db: Db, userId: string, now: Date, days: number) {
  const since = iso(new Date(now.getTime() - days * DAY_MS));
  const upTo = iso(now);
  const trend = await db.execute<{ trend: number | null; n: number }>(sql`
    SELECT avg(delta)::float AS trend, count(*)::int AS n FROM (
      SELECT sum(p_after - p_before) AS delta FROM mastery_history
      WHERE user_id = ${userId} AND at >= ${since}::timestamptz AND at <= ${upTo}::timestamptz
      GROUP BY skill_id
    ) per_skill`);
  const tests = await db.execute<{ passed: number; failed: number }>(sql`
    SELECT count(*) FILTER (WHERE status = 'passed')::int AS passed,
           count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM assessments
    WHERE user_id = ${userId} AND kind IN ('node_test', 'exam')
      AND started_at >= ${since}::timestamptz AND started_at <= ${upTo}::timestamptz`);
  const t = trend.rows[0]!;
  return {
    days,
    masteryTrend: t.trend === null ? null : round2(t.trend),
    skillsPracticed: t.n,
    testsPassed: tests.rows[0]!.passed,
    testsFailed: tests.rows[0]!.failed,
  } satisfies WindowMetrics;
}

/**
 * F7-R1: the 7- and 30-day metrics of one user, computed in SQL (D-16). Everything is rounded so that the same
 * situation gives the same numbers, which is what `metricsHash` relies on. No answers, no keys, no personal data.
 */
export async function computeMetrics(
  db: Db,
  userId: string,
  now: Date,
  weakBelow: number,
): Promise<Metrics> {
  const since7 = iso(new Date(now.getTime() - 7 * DAY_MS));
  const since30 = iso(new Date(now.getTime() - 30 * DAY_MS));
  const weak = await db.execute<{ skill: string; course: string; p_known: number }>(sql`
    SELECT s.name AS skill, cv.title AS course, sm.p_known
    FROM skill_mastery sm
    JOIN skills s ON s.id = sm.skill_id
    JOIN course_versions cv ON cv.id = s.course_version_id
    JOIN enrollments e ON e.course_version_id = cv.id AND e.user_id = sm.user_id AND e.status = 'active'
    WHERE sm.user_id = ${userId} AND sm.n_obs > 0 AND sm.p_known < ${weakBelow}
    ORDER BY sm.p_known, s.name
    LIMIT ${MAX_LISTED}`);
  const missed = await db.execute<{ course: string }>(sql`
    SELECT cv.title AS course
    FROM enrollments e JOIN course_versions cv ON cv.id = e.course_version_id
    WHERE e.user_id = ${userId} AND e.status = 'active' AND e.started_at < ${since7}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM assessments a
        WHERE a.user_id = e.user_id AND a.course_version_id = e.course_version_id
          AND a.kind IN ('node_test', 'exam') AND a.status IN ('passed', 'failed')
          AND a.started_at >= ${since7}::timestamptz)
    ORDER BY cv.title`);
  const failures = await db.execute<{ node: string; course: string; failed: number }>(sql`
    SELECT coalesce(n.title, 'Підсумковий іспит') AS node, cv.title AS course, count(*)::int AS failed
    FROM assessments a
    JOIN course_versions cv ON cv.id = a.course_version_id
    LEFT JOIN nodes n ON n.id = a.node_id
    LEFT JOIN node_progress np ON np.user_id = a.user_id AND np.node_id = a.node_id
    WHERE coalesce(np.state::text, '') <> 'passed' AND a.user_id = ${userId} AND a.kind IN ('node_test', 'exam') AND a.status = 'failed'
      AND a.started_at >= ${since30}::timestamptz AND a.started_at <= ${iso(now)}::timestamptz
    GROUP BY 1, 2
    ORDER BY failed DESC, node
    LIMIT ${MAX_LISTED}`);
  return {
    w7: await windowMetrics(db, userId, now, 7),
    w30: await windowMetrics(db, userId, now, 30),
    weakSkills: weak.rows.map((r) => ({
      skill: r.skill,
      course: r.course,
      pKnown: round2(r.p_known),
    })),
    missed: missed.rows,
    failures: failures.rows,
  };
}

/** Nothing to base a tip on: no recent work, no weak skill, no missed course, no failure. */
export function hasSignal(m: Metrics): boolean {
  return (
    m.w30.skillsPracticed + m.w30.testsPassed + m.w30.testsFailed > 0 ||
    m.weakSkills.length > 0 ||
    m.missed.length > 0 ||
    m.failures.length > 0
  );
}

/** F7-R2: the same hash as last time means nothing changed, so there is nothing new to say. */
export function metricsHash(m: Metrics): string {
  return createHash('sha256').update(JSON.stringify(m)).digest('hex');
}
