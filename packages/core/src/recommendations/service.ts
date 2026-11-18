import { recommendations, users, type Db, type RecommendationTip } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';
import { desc, eq, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { loadConfig } from '../config';
import { recommendationDayIndex } from '../time';
import { computeMetrics, hasSignal, metricsHash } from './metrics';
import { RECOMMENDATION_PROMPT_VERSION, recommendationPrompt, tipsSchema } from './prompt';

export type RecommendationOutcome =
  'created' | 'unchanged' | 'already_today' | 'no_data' | 'failed';

export interface RecommendationRun {
  at: string;
  users: { userId: string; email: string; displayName: string; outcome: RecommendationOutcome }[];
  counts: Record<RecommendationOutcome, number>;
}

export interface RecommendationSettings {
  timeScale: number;
  /** A skill below this P(known) is "weak" (the node pass threshold, D-11). */
  weakBelow: number;
}

export function recommendationSettings(config = loadConfig()): RecommendationSettings {
  return { timeScale: config.timeScale, weakBelow: config.node.passThreshold };
}

const dayOf = (idx: number) => sql`DATE '1970-01-01' + ${idx}::int`;

/** F7-R1: students with an active course or a test in the last 30 days. */
async function activeStudents(db: Db, now: Date) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.execute<{ id: string; email: string; display_name: string }>(sql`
    SELECT u.id, u.email, u.display_name FROM users u
    WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'student')
      AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.status = 'active')
        OR EXISTS (SELECT 1 FROM assessments a WHERE a.user_id = u.id AND a.started_at >= ${since}::timestamptz))
    ORDER BY u.created_at, u.email`);
  return rows.rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name }));
}

async function recommendFor(
  db: Db,
  llm: LLMClient,
  userId: string,
  now: Date,
  settings: RecommendationSettings,
): Promise<RecommendationOutcome> {
  const day = dayOf(recommendationDayIndex(now, settings.timeScale));
  const [today] = await db
    .select({ id: recommendations.id })
    .from(recommendations)
    .where(sql`${recommendations.userId} = ${userId} AND ${recommendations.day} = ${day}`);
  if (today) return 'already_today';

  const metrics = await computeMetrics(db, userId, now, settings.weakBelow);
  if (!hasSignal(metrics)) return 'no_data';
  const hash = metricsHash(metrics);
  const [last] = await db
    .select({ hash: recommendations.metricsHash })
    .from(recommendations)
    .where(eq(recommendations.userId, userId))
    .orderBy(desc(recommendations.createdAt))
    .limit(1);
  if (last?.hash === hash) return 'unchanged';

  // One logged LLM call; a failure stores nothing, so the next run tries again.
  const { data, runId } = await llm.generate({
    purpose: 'recommendation',
    promptVersion: RECOMMENDATION_PROMPT_VERSION,
    prompt: recommendationPrompt(metrics),
    schema: tipsSchema,
    subject: { type: 'user', id: userId },
  });
  const [row] = await db
    .insert(recommendations)
    .values({
      userId,
      day,
      items: data.tips,
      metricsHash: hash,
      llmRunId: runId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: recommendations.id });
  return row ? 'created' : 'already_today';
}

/**
 * The daily job (F7-R1, F7-R2): for every active student, compute the metrics, skip when nothing changed since the
 * last tips or when today's tips exist, otherwise make one LLM call and store up to three tips. One user's failure
 * does not stop the others.
 */
export async function runRecommendations(
  db: Db,
  llm: LLMClient,
  now = new Date(),
  settings = recommendationSettings(),
): Promise<RecommendationRun> {
  const result: RecommendationRun['users'] = [];
  for (const u of await activeStudents(db, now)) {
    let outcome: RecommendationOutcome;
    try {
      outcome = await recommendFor(db, llm, u.id, now, settings);
    } catch (err) {
      console.error(`[recommendations] user ${u.id} failed`, err);
      outcome = 'failed';
    }
    result.push({ userId: u.id, email: u.email, displayName: u.displayName, outcome });
  }
  const counts = { created: 0, unchanged: 0, already_today: 0, no_data: 0, failed: 0 };
  for (const r of result) counts[r.outcome]++;
  return { at: now.toISOString(), users: result, counts };
}

/** The admin's "run now" button (D-16, D-32): the same job, started by hand. */
export async function runRecommendationsNow(db: Db, actor: AuthUser | null, llm: LLMClient) {
  requireRole(actor, 'admin');
  return runRecommendations(db, llm);
}

export interface OwnRecommendations {
  createdAt: Date;
  items: RecommendationTip[];
}

/** F7-R3: the newest tips of the student, for the dashboard. */
export async function getOwnRecommendations(
  db: Db,
  user: AuthUser,
): Promise<OwnRecommendations | null> {
  const [row] = await db
    .select({ createdAt: recommendations.createdAt, items: recommendations.items })
    .from(recommendations)
    .where(eq(recommendations.userId, user.id))
    .orderBy(desc(recommendations.createdAt))
    .limit(1);
  return row ?? null;
}

/** Whether the account is seed data of the demo environment (shown as such in the UI). */
export async function isDemoUser(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ isDemo: users.isDemo }).from(users).where(eq(users.id, userId));
  return row?.isDemo ?? false;
}
