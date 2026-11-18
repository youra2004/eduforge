import { readFileSync } from 'node:fs';
import {
  assessments,
  courseVersions,
  createDb,
  llmRuns,
  nodeProgress,
  recommendations,
  users,
} from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider } from '@eduforge/llm';
import { and, count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { seedDemo } from '../demo/seed';
import { computeMetrics } from './metrics';
import { recommendationMockResponders } from './prompt';
import {
  getOwnRecommendations,
  recommendationSettings,
  runRecommendations,
  runRecommendationsNow,
  type RecommendationRun,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const mock = new MockLLMProvider(recommendationMockResponders);
const llm = new LLMClient(mock, new DrizzleLLMRunStore(db));
const SUFFIX = '-rec';
const settings = { ...recommendationSettings(), timeScale: 1 };
const DAY = 24 * 60 * 60 * 1000;

let seeded: Awaited<ReturnType<typeof seedDemo>>;
const ids: Record<string, string> = {};
const outcomeOf = (run: RecommendationRun, key: string) =>
  run.users.find((u) => u.email === `demo-${key}${SUFFIX}@demo.eduforge.local`)?.outcome;

beforeAll(async () => {
  seeded = await seedDemo(db, { password: 'correct horse battery', suffix: SUFFIX });
  for (const key of ['olena', 'taras', 'iryna', 'maksym']) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, `demo-${key}${SUFFIX}@demo.eduforge.local`));
    ids[key] = u!.id;
  }
});

describe('seed script (NFR-6)', () => {
  it('builds a working demo environment on a clean database, all of it marked as demo data', async () => {
    expect(seeded.created).toBe(true);
    const marked = await db
      .select()
      .from(users)
      .where(inArray(users.id, Object.values(ids)));
    expect(marked.every((u) => u.isDemo && u.displayName.endsWith('(демо)'))).toBe(true);
    const [version] = await db
      .select()
      .from(courseVersions)
      .where(eq(courseVersions.id, seeded.versionId!));
    expect(version).toMatchObject({ status: 'published', rating: 3 });
    expect(version!.title).toMatch(/^\[ДЕМО\]/);
    const passed = await db
      .select({ n: count() })
      .from(nodeProgress)
      .where(and(eq(nodeProgress.userId, ids.olena!), eq(nodeProgress.state, 'passed')));
    expect(passed[0]!.n).toBeGreaterThan(0);
  });

  it('does nothing when the demo data already exists', async () => {
    const again = await seedDemo(db, { password: 'correct horse battery', suffix: SUFFIX });
    expect(again.created).toBe(false);
  });
});

describe('metrics on the seeded histories (F7-R1)', () => {
  const now = () => new Date();

  it('an improving student: mastery up, tests passed, nothing weak, nothing missed', async () => {
    const m = await computeMetrics(db, ids.olena!, now(), 0.8);
    expect(m.w7.masteryTrend).toBeGreaterThan(0);
    expect(m.w7.testsPassed).toBeGreaterThanOrEqual(2);
    expect(m.w7.testsFailed).toBe(0);
    expect(m.weakSkills).toEqual([]);
    expect(m.missed).toEqual([]);
    // Her one failed attempt was on a node she passed later, so it is not a standing failure.
    expect(m.failures).toEqual([]);
    expect(m.w30.testsFailed).toBe(1);
  });

  it('a struggling student: weak skills and repeated failures, weakest first', async () => {
    const m = await computeMetrics(db, ids.taras!, now(), 0.8);
    expect(m.weakSkills.length).toBeGreaterThan(0);
    expect(m.weakSkills.map((s) => s.pKnown)).toEqual(
      [...m.weakSkills.map((s) => s.pKnown)].sort((a, b) => a - b),
    );
    expect(m.failures[0]).toMatchObject({ node: 'Типи даних і оператори', failed: 2 });
    expect(m.w30.testsFailed).toBe(4);
  });

  it('an idle student: the course is missed, the 7-day window is empty but the 30-day one is not', async () => {
    const m = await computeMetrics(db, ids.iryna!, now(), 0.8);
    expect(m.missed).toEqual([{ course: '[ДЕМО] Основи Python' }]);
    expect(m.w7).toMatchObject({ masteryTrend: null, testsPassed: 0, testsFailed: 0 });
    expect(m.w30.testsPassed).toBe(1);
  });

  it('a new student has no metrics at all', async () => {
    const m = await computeMetrics(db, ids.maksym!, now(), 0.8);
    expect(m.w30).toMatchObject({ masteryTrend: null, skillsPracticed: 0 });
    expect(m.missed).toEqual([]);
  });
});

describe('the daily job on the Mock LLM (F7-R2)', () => {
  const t0 = new Date(); // "today"
  let first: RecommendationRun;

  it('creates tips for students with something to say: at most 3 each, and logs one llm_run each', async () => {
    const before = mock.calls.length;
    first = await runRecommendations(db, llm, t0, settings);
    expect(outcomeOf(first, 'olena')).toBe('created');
    expect(outcomeOf(first, 'taras')).toBe('created');
    expect(outcomeOf(first, 'iryna')).toBe('created');
    expect(outcomeOf(first, 'maksym')).toBe('no_data');
    expect(mock.calls.length - before).toBe(first.counts.created);

    for (const key of ['olena', 'taras', 'iryna']) {
      const rows = await db
        .select()
        .from(recommendations)
        .where(eq(recommendations.userId, ids[key]!));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.items.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.items.length).toBeLessThanOrEqual(3);
      const [run] = await db.select().from(llmRuns).where(eq(llmRuns.id, rows[0]!.llmRunId));
      expect(run).toMatchObject({ purpose: 'recommendation', subjectId: ids[key] });
    }
    const [none] = await db
      .select({ n: count() })
      .from(recommendations)
      .where(eq(recommendations.userId, ids.maksym!));
    expect(none!.n).toBe(0);
  });

  it('the tips are phrased from the metrics of that student (the struggling one gets the failure and the weak skill)', async () => {
    const rows = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.userId, ids.taras!));
    expect(rows[0]!.items.map((t) => t.kind).slice(0, 2)).toEqual(['failures', 'weak_skill']);
    expect(rows[0]!.items[0]!.title).toContain('Типи даних і оператори');
  });

  it('the LLM prompt carries metrics only: no names, no emails', async () => {
    const prompts = mock.calls.map((c) => c.prompt).join('\n');
    expect(prompts).not.toMatch(/Тарас|Мельник|demo\.eduforge\.local/);
  });

  it('a second run in the same day creates nothing and makes no LLM call', async () => {
    const before = mock.calls.length;
    const second = await runRecommendations(db, llm, new Date(t0.getTime() + 1000), settings);
    expect(second.counts.created).toBe(0);
    expect(outcomeOf(second, 'taras')).toBe('already_today');
    expect(mock.calls.length).toBe(before);
  });

  it('the next day with nothing changed: no new tip', async () => {
    const before = mock.calls.length;
    const next = await runRecommendations(db, llm, new Date(t0.getTime() + DAY), settings);
    for (const key of ['olena', 'taras', 'iryna']) expect(outcomeOf(next, key)).toBe('unchanged');
    expect(mock.calls.length).toBe(before);
    const [total] = await db
      .select({ n: count() })
      .from(recommendations)
      .where(eq(recommendations.userId, ids.taras!));
    expect(total!.n).toBe(1);
  });

  it('the next day after the metrics changed: one new row', async () => {
    // 17 days on, the one test of the student who stopped has left the 30-day window, so her numbers differ.
    const later = new Date(t0.getTime() + 17 * DAY);
    const run = await runRecommendations(db, llm, later, settings);
    expect(outcomeOf(run, 'iryna')).toBe('created');
    const rows = await db
      .select()
      .from(recommendations)
      .where(eq(recommendations.userId, ids.iryna!));
    expect(rows).toHaveLength(2);
  });

  it('in demo mode a "day" is short: TIME_SCALE=1440 allows another run after a minute', async () => {
    const demoSettings = { ...settings, timeScale: 1440 };
    // Start of a demo "day" (a minute), so five seconds later is still the same one.
    const at = new Date(Math.floor((t0.getTime() + 20 * DAY) / 60_000) * 60_000);
    const a = await runRecommendations(db, llm, at, demoSettings);
    expect(outcomeOf(a, 'olena')).toBe('created');
    const b = await runRecommendations(db, llm, new Date(at.getTime() + 5_000), demoSettings);
    expect(outcomeOf(b, 'olena')).toBe('already_today');
    // A minute later it is a new "day": the limit no longer blocks, and only "nothing changed" does.
    const c = await runRecommendations(db, llm, new Date(at.getTime() + 61_000), demoSettings);
    expect(outcomeOf(c, 'olena')).toBe('unchanged');
  });

  it('shows the newest tips to the student on the dashboard', async () => {
    const own = await getOwnRecommendations(db, {
      id: ids.taras!,
      email: 't',
      displayName: 'Т',
      roles: ['student'],
    });
    expect(own!.items.length).toBeLessThanOrEqual(3);
    expect(own!.items[0]!.kind).toBe('failures');
  });

  it('one failing LLM call does not stop the job and stores nothing for that student', async () => {
    const failing = new LLMClient(
      new MockLLMProvider({
        recommendation: () => {
          throw new Error('provider down');
        },
      }),
      new DrizzleLLMRunStore(db),
    );
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, `demo-olena${SUFFIX}@demo.eduforge.local`));
    await db.delete(recommendations).where(eq(recommendations.userId, u!.id));
    const run = await runRecommendations(db, failing, new Date(t0.getTime() + 40 * DAY), settings);
    expect(outcomeOf(run, 'olena')).toBe('failed');
    expect(run.counts.failed).toBeGreaterThan(0);
    const rows = await db.select().from(recommendations).where(eq(recommendations.userId, u!.id));
    expect(rows).toHaveLength(0);
  });
});

describe('review fixes', () => {
  it('a failed exam that was passed afterwards is not a standing failure', async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `exam-${Date.now()}@test.local`, passwordHash: 'x', displayName: 'Е' })
      .returning({ id: users.id });
    const base = {
      userId: u!.id,
      kind: 'exam' as const,
      courseVersionId: seeded.versionId!,
      questionSetSeed: 1,
    };
    await db
      .insert(assessments)
      .values({ ...base, status: 'failed', startedAt: new Date(Date.now() - 3 * DAY) });
    let m = await computeMetrics(db, u!.id, new Date(), 0.8);
    expect(m.failures).toEqual([expect.objectContaining({ node: 'Підсумковий іспит', failed: 1 })]);
    await db
      .insert(assessments)
      .values({ ...base, status: 'passed', startedAt: new Date(Date.now() - 1 * DAY) });
    m = await computeMetrics(db, u!.id, new Date(), 0.8);
    expect(m.failures).toEqual([]);
  });

  it('two runs at the same moment make one LLM call per student', async () => {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, `demo-iryna${SUFFIX}@demo.eduforge.local`));
    await db.delete(recommendations).where(eq(recommendations.userId, u!.id));
    const runsOf = async () =>
      (await db.select().from(llmRuns).where(eq(llmRuns.subjectId, u!.id))).length;
    const before = await runsOf();
    const at = new Date(Date.now() + 60 * DAY);
    const [a, b] = await Promise.all([
      runRecommendations(db, llm, at, settings),
      runRecommendations(db, llm, at, settings),
    ]);
    const created = [a, b].filter((r) => outcomeOf(r, 'iryna') === 'created');
    expect(created).toHaveLength(1);
    expect((await runsOf()) - before).toBe(1);
    const rows = await db.select().from(recommendations).where(eq(recommendations.userId, u!.id));
    expect(rows).toHaveLength(1);
  });

  it('a failed seed leaves nothing behind, so it can be run again', async () => {
    await db.insert(users).values({
      email: 'demo-maksym-half@demo.eduforge.local',
      passwordHash: 'x',
      displayName: 'Зайнятий email',
    });
    await expect(
      seedDemo(db, { password: 'correct horse battery', suffix: '-half' }),
    ).rejects.toThrow();
    const left = await db
      .select()
      .from(users)
      .where(eq(users.email, 'demo-admin-half@demo.eduforge.local'));
    expect(left).toEqual([]);
  });
});

describe('"run now" (D-32)', () => {
  const user = (roles: AuthUser['roles']): AuthUser => ({
    id: ids.olena!,
    email: 'x',
    displayName: 'X',
    roles,
  });

  it('is for admins only', async () => {
    await expect(runRecommendationsNow(db, null, llm)).rejects.toThrow(AuthError);
    await expect(runRecommendationsNow(db, user(['student']), llm)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('runs the job and returns the per-student result', async () => {
    const run = await runRecommendationsNow(db, user(['admin']), llm);
    expect(run.users.length).toBeGreaterThanOrEqual(4);
    expect(Object.values(run.counts).reduce((a, b) => a + b, 0)).toBe(run.users.length);
  });
});

// The demo course file is read by the seed; this guards the placeholder it relies on.
it('the seeded course comes from the demo course file', () => {
  const file = JSON.parse(
    readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
  );
  expect(file.title).toBe('Основи Python');
});
