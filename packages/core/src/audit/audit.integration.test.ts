import { readFileSync } from 'node:fs';
import {
  auditRuns,
  contentItems,
  courseVersions,
  createDb,
  llmRuns,
  nodes,
  notifications,
  questions,
  skills,
  userRoles,
  users,
} from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider } from '@eduforge/llm';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { editGraph } from '../courses/editor';
import {
  createNewVersion,
  getVersionGraph,
  importCourse,
  listCourseVersions,
  updateVersion,
} from '../courses/service';
import { auditMockResponders } from './mock';
import { listNotifications, markAllRead, unreadCount } from './notifications';
import {
  failAudit,
  findAuditingJobs,
  runAudit,
  submitForAudit,
  type AuditSettings,
} from './pipeline';
import { publishVersion, reopenVersion, resolveRejection } from './publication';
import { DEFAULT_RATING_CONFIG } from './rating';
import {
  assignExpert,
  CHECKLIST_ITEMS,
  decideReview,
  listMyReviews,
  listReviewQueue,
} from './review';
import { getAuditView } from './view';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

type Fixture = {
  course: Record<string, unknown> & { nodes: { key: string; title: string }[] };
  content: Record<string, string>;
  difficulty: number;
};
const fixtures = JSON.parse(
  readFileSync(new URL('../../seed/audit-fixtures.json', import.meta.url), 'utf8'),
) as Record<'good' | 'weak' | 'offTopic' | 'uncoveredSkill', Fixture>;

/** Few nodes are enough here: the size cap is lifted so the rating shows what the content earned. */
const settings: AuditSettings = {
  maxAttempts: 5,
  scoringRuns: 5,
  rating: { ...DEFAULT_RATING_CONFIG, volumeCaps: [{ below: 2, cap: 3 }] },
  pools: { nodeMinPerSkill: 4, examMinPerSkill: 3 },
};

let n = 0;
const uniq = () => `${Date.now()}-${n++}`;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `audit-test-${uniq()}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: `Тест ${roles.join('+')}` })
    .returning();
  await db.insert(userRoles).values(roles.map((role) => ({ userId: row!.id, role })));
  return { id: row!.id, email, displayName: row!.displayName, roles };
}

const mock = new MockLLMProvider(auditMockResponders);
const llm = new LLMClient(mock, new DrizzleLLMRunStore(db));

/** A draft course with the fixture's content and full question pools, ready for the audit. */
async function draft(which: keyof typeof fixtures, author: AuthUser, extraText = '') {
  const f = fixtures[which];
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(f.course), slug: `audit-${uniq()}` },
    author.id,
  );
  const graph = await getVersionGraph(db, author, versionId);
  for (const node of f.course.nodes) {
    const row = graph.nodes.find((g) => g.title === node.title)!;
    await db.insert(contentItems).values({
      nodeId: row.id,
      kind: 'markdown',
      title: node.title,
      bodyMd: (f.content[node.key] ?? '') + extraText,
    });
  }
  await fillPools(versionId, f.difficulty);
  return versionId;
}

/** Stands in for the question generator: 4 validated node questions per node skill, 3 exam questions per skill. */
async function fillPools(versionId: string, difficulty: number) {
  const graph = await getVersionGraph(
    db,
    { id: 'x', email: '', displayName: '', roles: ['admin'] },
    versionId,
  );
  const rows = graph.nodes.flatMap((node) =>
    node.skillIds.flatMap((skillId) => [
      ...Array.from({ length: 4 }, () => ({ node, skillId, pool: 'node' as const })),
      ...Array.from({ length: 3 }, () => ({ node, skillId, pool: 'exam' as const })),
    ]),
  );
  await db.insert(questions).values(
    rows.map((r) => ({
      nodeId: r.node.id,
      skillId: r.skillId,
      pool: r.pool,
      kind: 'mcq' as const,
      promptMd: 'Питання?',
      options: ['а', 'б'],
      answerKey: { optionIndex: 0 },
      difficulty,
      guess: 0.5,
      status: 'validated' as const,
    })),
  );
}

async function auditOnce(versionId: string, author: AuthUser, s = settings, client = llm) {
  const job = await submitForAudit(db, author, versionId, s);
  return { job, outcome: await runAudit(db, client, job, s) };
}

const statusOf = async (versionId: string) =>
  (await db.select().from(courseVersions).where(eq(courseVersions.id, versionId)))[0]!;

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError || err instanceof AuthError) return err.code;
    return `other:${String(err)}`;
  }
  return 'none';
}

describe('the audit pipeline on the Mock', () => {
  it('a good course gets a rating, a level and feedback, and is ready to publish', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const { outcome } = await auditOnce(versionId, author);
    expect(outcome).toMatchObject({ status: 'ready_to_publish', rating: 5 });

    const v = await statusOf(versionId);
    expect(v).toMatchObject({
      status: 'ready_to_publish',
      rating: 5,
      aiLevel: 'middle',
      auditAttempts: 1,
    });
    expect(v.aiHardness).toBeCloseTo(0.4, 1);

    // every stage left a row, and all N scoring runs are in llm_runs
    const stages = await db
      .select()
      .from(auditRuns)
      .where(eq(auditRuns.courseVersionId, versionId));
    expect(stages.map((s) => s.stage).sort()).toEqual([
      'conformity',
      'scoring',
      'skills',
      'structure',
      'volume',
    ]);
    const runs = await db
      .select()
      .from(llmRuns)
      .where(and(eq(llmRuns.subjectId, versionId), eq(llmRuns.purpose, 'audit_scoring')));
    expect(runs).toHaveLength(5);
    const hardness = runs.map((r) => (r.response as { hardness: number }).hardness);
    expect(new Set(hardness).size).toBeGreaterThan(1);

    // the author's view has feedback per category and the skill check, but no thresholds
    const view = await getAuditView(db, author, versionId, settings);
    expect(view.summary?.feedback).toMatchObject({
      theoryDepth: expect.any(String),
      questionTrickiness: expect.any(String),
      edgeCases: expect.any(String),
    });
    expect(view.skills.every((s) => s.verified === true)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/volumeCap|"cap"/);
    expect(view.attemptsUsed).toBe(1);

    expect(await unreadCount(db, author)).toBe(1);
  });

  it('a weak course gets a low rating', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('weak', author);
    const { outcome } = await auditOnce(versionId, author);
    expect(outcome).toMatchObject({ status: 'ready_to_publish' });
    const v = await statusOf(versionId);
    expect(v.aiLevel).toBe('junior');
    expect(v.rating).toBeLessThanOrEqual(2);
  });

  it('the volume cap lowers the score of a small course', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const capped = { ...settings, rating: DEFAULT_RATING_CONFIG };
    await auditOnce(versionId, author, capped);
    const v = await statusOf(versionId);
    expect(v).toMatchObject({ rating: 3, volumeCap: 3, status: 'ready_to_publish' });
    const view = await getAuditView(db, author, versionId, capped);
    expect(view.summary?.limitedByVolume).toBe(true);
  });

  it('a course that does not match its description goes back with the list of mismatches', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('offTopic', author);
    const { outcome } = await auditOnce(versionId, author);
    expect(outcome).toMatchObject({ status: 'changes_requested', failedStage: 'conformity' });

    const v = await statusOf(versionId);
    expect(v.status).toBe('changes_requested');
    expect(v.rating).toBeNull();
    const view = await getAuditView(db, author, versionId, settings);
    expect(view.summary?.failedStage).toBe('conformity');
    expect(view.summary?.mismatches?.length).toBeGreaterThan(0);
    expect(view.summary?.mismatches?.[0]).toMatch(/Опис обіцяє/);
    // no scoring was paid for
    const scoring = await db
      .select()
      .from(llmRuns)
      .where(and(eq(llmRuns.subjectId, versionId), eq(llmRuns.purpose, 'audit_scoring')));
    expect(scoring).toHaveLength(0);
  });

  it('flags a declared skill that the content does not cover', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('uncoveredSkill', author);
    const { outcome } = await auditOnce(versionId, author);
    expect(outcome).toMatchObject({ status: 'changes_requested', failedStage: 'skills' });

    const view = await getAuditView(db, author, versionId, settings);
    expect(view.summary?.uncoveredSkills?.map((s) => s.name)).toEqual(['Асинхронність']);
    expect(view.skills.find((s) => s.name === 'Асинхронність')).toMatchObject({ verified: false });
    expect(view.skills.find((s) => s.name === 'Цикли')).toMatchObject({ verified: true });
  });

  it('refuses to start while the course is incomplete, and that costs no run', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const [node] = await db
      .select()
      .from(nodes)
      .where(eq(nodes.courseVersionId, versionId))
      .orderBy(asc(nodes.title))
      .limit(1);
    await db.delete(contentItems).where(eq(contentItems.nodeId, node!.id));
    const err = await submitForAudit(db, author, versionId, settings).catch((e) => e);
    expect(err).toBeInstanceOf(CourseError);
    expect(err.code).toBe('invalid_course');
    expect(err.issues.map((i: { code: string }) => i.code)).toContain('node_without_content');
    expect((await statusOf(versionId)).auditAttempts).toBe(0);
  });

  it('stage 0 also fails the attempt for a version that was broken after the submit', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const job = await submitForAudit(db, author, versionId, settings);
    await db.delete(questions).where(
      inArray(
        questions.nodeId,
        (
          await db.select({ id: nodes.id }).from(nodes).where(eq(nodes.courseVersionId, versionId))
        ).map((r) => r.id),
      ),
    );
    const outcome = await runAudit(db, llm, job, settings);
    expect(outcome).toMatchObject({ status: 'changes_requested', failedStage: 'structure' });
    const view = await getAuditView(db, author, versionId, settings);
    expect(view.summary?.issues?.some((i) => i.code === 'pool_too_small')).toBe(true);
  });

  it('only the owner or an admin can submit', async () => {
    const author = await makeUser(['author']);
    const other = await makeUser(['author']);
    const versionId = await draft('good', author);
    expect(await codeOf(submitForAudit(db, other, versionId, settings))).toBe('course_not_found');
    const student = await makeUser(['student']);
    expect(await codeOf(submitForAudit(db, student, versionId, settings))).toBe('course_not_found');
    expect(await codeOf(submitForAudit(db, null, versionId, settings))).toBe('unauthenticated');
  });

  it('a double submit starts one audit', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const results = await Promise.allSettled([
      submitForAudit(db, author, versionId, settings),
      submitForAudit(db, author, versionId, settings),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await statusOf(versionId)).auditAttempts).toBe(1);
  });

  it('a run that is repeated or stale changes nothing', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const { job } = await auditOnce(versionId, author);
    expect(await runAudit(db, llm, job, settings)).toEqual({ status: 'skipped' });
    expect(await runAudit(db, llm, { ...job, attemptNo: 9 }, settings)).toEqual({
      status: 'skipped',
    });
  });
});

describe('the audit limit (D-09b)', () => {
  it('rejects the sixth run on a version', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('offTopic', author);
    for (let i = 1; i <= 5; i++) {
      const { outcome } = await auditOnce(versionId, author);
      expect(outcome.status).toBe('changes_requested');
    }
    expect((await statusOf(versionId)).auditAttempts).toBe(5);
    expect(await codeOf(submitForAudit(db, author, versionId, settings))).toBe(
      'audit_limit_reached',
    );
    expect((await getAuditView(db, author, versionId, settings)).canSubmit).toBe(false);
    expect((await statusOf(versionId)).auditAttempts).toBe(5);

    // the author starts over from a copy of the exhausted version
    const copy = await createNewVersion(db, author, versionId, 5);
    expect(copy.versionNo).toBe(2);
    expect((await statusOf(copy.versionId)).auditAttempts).toBe(0);
  });

  it('gives the run back when the audit cannot finish', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    const job = await submitForAudit(db, author, versionId, settings);
    expect(await findAuditingJobs(db)).toContainEqual(job);
    expect(await failAudit(db, job)).toBe(true);
    const v = await statusOf(versionId);
    expect(v).toMatchObject({ status: 'changes_requested', auditAttempts: 0 });
    expect((await listNotifications(db, author)).map((x) => x.type)).toContain('audit_failed');
    expect(await failAudit(db, job)).toBe(false);
  });
});

describe('rating 10 and the expert review (F4-R6)', () => {
  /** Long content makes the Mock say "expert", and a size cap of 10 lets the 10 through. */
  const tenSettings: AuditSettings = {
    ...settings,
    rating: { ...DEFAULT_RATING_CONFIG, volumeCaps: [] },
  };
  const long = '\n\nДодатковий розділ про змінні, цикли та функції з прикладами. '.repeat(70);

  async function candidate() {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author, long);
    const { outcome } = await auditOnce(versionId, author, tenSettings);
    expect(outcome.status).toBe('expert_review');
    return { author, versionId };
  }

  it('sends a 10 to the expert review instead of publishing, and tells the author', async () => {
    const { author, versionId } = await candidate();
    const v = await statusOf(versionId);
    expect(v).toMatchObject({ status: 'expert_review', rating: null, aiLevel: 'expert' });
    expect((await listNotifications(db, author)).map((x) => x.type)).toContain(
      'expert_review_started',
    );
    // nobody can publish it around the expert
    expect(await codeOf(publishVersion(db, author, versionId))).toBe('invalid_version_state');
  });

  it('runs assignment → checklist → decision → notification, and approval gives the 10', async () => {
    const { author, versionId } = await candidate();
    const admin = await makeUser(['admin']);
    const expert = await makeUser(['expert']);

    expect((await listReviewQueue(db, admin)).find((q) => q.versionId === versionId)).toMatchObject(
      { review: null },
    );
    const { reviewId } = await assignExpert(db, admin, { versionId, expertId: expert.id });
    expect((await listMyReviews(db, expert)).map((r) => r.reviewId)).toContain(reviewId);
    expect((await listNotifications(db, expert)).map((x) => x.type)).toContain('review_assigned');
    expect((await listReviewQueue(db, admin)).find((q) => q.versionId === versionId)).toMatchObject(
      {
        review: { status: 'assigned' },
        expertName: expert.displayName,
      },
    );

    // an approval with an unticked item is refused, and nothing changes
    const items = Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, true]));
    expect(
      await codeOf(
        decideReview(db, expert, reviewId, {
          decision: 'approved',
          items: { ...items, edge_cases: false },
        }),
      ),
    ).toBe('invalid_review');
    expect((await statusOf(versionId)).status).toBe('expert_review');

    // another expert cannot decide it
    const stranger = await makeUser(['expert']);
    expect(
      await codeOf(decideReview(db, stranger, reviewId, { decision: 'approved', items })),
    ).toBe('review_not_found');

    await decideReview(db, expert, reviewId, { decision: 'approved', items, comment: 'Відмінно.' });
    expect(await statusOf(versionId)).toMatchObject({ status: 'ready_to_publish', rating: 10 });
    expect((await listNotifications(db, author)).map((x) => x.type)).toContain('review_decided');
    // decided once
    expect(await codeOf(decideReview(db, expert, reviewId, { decision: 'approved', items }))).toBe(
      'review_conflict',
    );

    const published = await publishVersion(db, author, versionId);
    expect(published).toMatchObject({ status: 'published', rating: 10 });
  });

  it('only an admin assigns, only a real expert other than the author, only for a version under review', async () => {
    const { author, versionId } = await candidate();
    const admin = await makeUser(['admin']);
    const expert = await makeUser(['expert']);
    expect(await codeOf(assignExpert(db, author, { versionId, expertId: expert.id }))).toBe(
      'forbidden',
    );
    expect(await codeOf(assignExpert(db, admin, { versionId, expertId: author.id }))).toBe(
      'invalid_review',
    );
    const authorExpert = await makeUser(['author', 'expert']);
    const ownVersion = await draft('good', authorExpert, long);
    await auditOnce(ownVersion, authorExpert, tenSettings);
    expect(
      await codeOf(assignExpert(db, admin, { versionId: ownVersion, expertId: authorExpert.id })),
    ).toBe('invalid_review');
    const plain = await draft('good', author);
    expect(await codeOf(assignExpert(db, admin, { versionId: plain, expertId: expert.id }))).toBe(
      'invalid_version_state',
    );

    // re-assigning before a decision replaces the expert; there is still one open review
    const other = await makeUser(['expert']);
    const first = await assignExpert(db, admin, { versionId, expertId: expert.id });
    const second = await assignExpert(db, admin, { versionId, expertId: other.id });
    expect(second.reviewId).toBe(first.reviewId);
    expect((await listMyReviews(db, expert)).length).toBe(0);
  });

  it('a rejection shows the checklist; the author may publish with 9', async () => {
    const { author, versionId } = await candidate();
    const admin = await makeUser(['admin']);
    const expert = await makeUser(['expert']);
    const { reviewId } = await assignExpert(db, admin, { versionId, expertId: expert.id });
    const items = Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, k !== 'expert_depth']));
    expect(await codeOf(decideReview(db, expert, reviewId, { decision: 'rejected', items }))).toBe(
      'invalid_review',
    );
    await decideReview(db, expert, reviewId, {
      decision: 'rejected',
      items,
      comment: 'Не експертний рівень.',
    });

    const view = await getAuditView(db, author, versionId, tenSettings);
    expect(view.awaitingChoice).toBe(true);
    expect(view.review).toMatchObject({
      status: 'rejected',
      checklist: { comment: 'Не експертний рівень.' },
    });
    expect(
      (await listNotifications(db, author)).filter((x) => x.type === 'review_decided'),
    ).toHaveLength(1);
    // the admin cannot re-assign a decided review
    expect(await codeOf(assignExpert(db, admin, { versionId, expertId: expert.id }))).toBe(
      'review_conflict',
    );

    const done = await resolveRejection(db, author, versionId, { choice: 'publish_9' });
    expect(done).toMatchObject({ status: 'published', rating: 9 });
    expect(await codeOf(resolveRejection(db, author, versionId, { choice: 'improve' }))).toBe(
      'invalid_version_state',
    );
  });

  it('a rejection lets the author keep improving; the next audit needs a new review', async () => {
    const { author, versionId } = await candidate();
    const admin = await makeUser(['admin']);
    const expert = await makeUser(['expert']);
    const { reviewId } = await assignExpert(db, admin, { versionId, expertId: expert.id });
    const items = Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, false]));
    await decideReview(db, expert, reviewId, { decision: 'rejected', items, comment: 'Замало.' });

    expect(await codeOf(resolveRejection(db, author, versionId, { choice: 'maybe' }))).toBe(
      'invalid_review',
    );
    await resolveRejection(db, author, versionId, { choice: 'improve' });
    expect((await statusOf(versionId)).status).toBe('changes_requested');

    // improving works again, and a new audit that reaches 10 waits for a fresh assignment
    const { outcome } = await auditOnce(versionId, author, tenSettings);
    expect(outcome.status).toBe('expert_review');
    const view = await getAuditView(db, author, versionId, tenSettings);
    expect(view.awaitingChoice).toBe(false);
    expect(view.review).toBeNull();
    const again = await assignExpert(db, admin, { versionId, expertId: expert.id });
    expect(again.reviewId).not.toBe(reviewId);
  });
});

describe('publication and immutability (D-06, F1-R1)', () => {
  it('a published version cannot be edited; a new version is audited again', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author);
    const published = await publishVersion(db, author, versionId);
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();

    // nothing about it can change
    expect(await codeOf(updateVersion(db, author, versionId, { title: 'Інша назва' }))).toBe(
      'version_locked',
    );
    expect(await codeOf(editGraph(db, author, versionId, { op: 'add_skill', name: 'Нова' }))).toBe(
      'version_locked',
    );
    expect(await codeOf(submitForAudit(db, author, versionId, settings))).toBe(
      'invalid_version_state',
    );
    expect(await codeOf(publishVersion(db, author, versionId))).toBe('invalid_version_state');
    expect(await codeOf(reopenVersion(db, author, versionId))).toBe('invalid_version_state');

    // the new version starts clean and has to pass the audit
    const next = await createNewVersion(db, author, versionId, 5);
    const v2 = await statusOf(next.versionId);
    expect(v2).toMatchObject({
      status: 'draft',
      rating: null,
      auditAttempts: 0,
      versionNo: 2,
      parentVersionId: versionId,
    });
    expect(await codeOf(publishVersion(db, author, next.versionId))).toBe('invalid_version_state');
    const again = await auditOnce(next.versionId, author);
    expect(again.outcome.status).toBe('ready_to_publish');
    // the old version is untouched
    expect(await statusOf(versionId)).toMatchObject({ status: 'published', rating: 5 });
    // its skills must be verified afresh
    const copied = await db.select().from(skills).where(eq(skills.courseVersionId, next.versionId));
    expect(copied).toHaveLength(3);
  });

  it('the author can take a ready version back to change the score, then audit again', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author);
    await reopenVersion(db, author, versionId);
    expect(await statusOf(versionId)).toMatchObject({
      status: 'draft',
      rating: null,
      auditAttempts: 1,
    });
    expect((await getAuditView(db, author, versionId, settings)).canSubmit).toBe(true);
    await auditOnce(versionId, author);
    expect((await statusOf(versionId)).auditAttempts).toBe(2);
  });

  it('only the author (or an admin) publishes', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author);
    const stranger = await makeUser(['author']);
    expect(await codeOf(publishVersion(db, stranger, versionId))).toBe('course_not_found');
    const student = await makeUser(['student']);
    expect(await codeOf(publishVersion(db, student, versionId))).toBe('course_not_found');
    expect((await statusOf(versionId)).status).toBe('ready_to_publish');
  });
});

describe('notifications', () => {
  it("lists a user's own messages and marks them read", async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author);
    expect(await unreadCount(db, author)).toBe(1);
    const other = await makeUser(['author']);
    expect(await listNotifications(db, other)).toHaveLength(0);
    await markAllRead(db, author);
    expect(await unreadCount(db, author)).toBe(0);
    expect(
      (await db.select().from(notifications).where(eq(notifications.userId, author.id)))[0]!.readAt,
    ).not.toBeNull();
  });
});

describe('what the version endpoints show (F4-R7, D-09b)', () => {
  const HIDDEN = ['volumeCap', 'aiHardness', 'aiLevel', 'auditSummary', 'auditAttempts'];

  it('keeps the audit internals out of the graph, the update and the catalog', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author, { ...settings, rating: DEFAULT_RATING_CONFIG });
    const student = await makeUser(['student']);
    await publishVersion(db, author, versionId);

    for (const viewer of [author, student]) {
      const g = await getVersionGraph(db, viewer, versionId);
      expect(g.version.rating).toBe(3);
      for (const key of HIDDEN) expect(g.version).not.toHaveProperty(key);
    }
    const [mine] = (await listCourseVersions(db, author)).filter((v) => v.versionId === versionId);
    expect(mine?.auditAttempts).toBe(1);
    const [seen] = (await listCourseVersions(db, student)).filter((v) => v.versionId === versionId);
    expect(seen).toMatchObject({ rating: 3, auditAttempts: null });
    expect(seen).not.toHaveProperty('aiLevel');
  });

  it('offers a student only the newest published version of a course', async () => {
    const author = await makeUser(['author']);
    const v1 = await draft('good', author);
    await auditOnce(v1, author);
    await publishVersion(db, author, v1);
    const v2 = (await createNewVersion(db, author, v1, 5)).versionId;
    await auditOnce(v2, author);
    await publishVersion(db, author, v2);
    const student = await makeUser(['student']);
    const ids = (await listCourseVersions(db, student)).map((v) => v.versionId);
    expect(ids).toContain(v2);
    expect(ids).not.toContain(v1);
    // the author still sees both, and v1 itself stays published for the students on it
    const own = (await listCourseVersions(db, author)).map((v) => v.versionId);
    expect(own).toEqual(expect.arrayContaining([v1, v2]));
    expect((await statusOf(v1)).status).toBe('published');
  });
});

describe('the last audit run is not thrown away', () => {
  it('refuses to reopen a ready version when no run is left', async () => {
    const author = await makeUser(['author']);
    const versionId = await draft('good', author);
    await auditOnce(versionId, author);
    await db
      .update(courseVersions)
      .set({ auditAttempts: 5 })
      .where(eq(courseVersions.id, versionId));
    expect(await codeOf(reopenVersion(db, author, versionId))).toBe('invalid_version_state');
    expect(await statusOf(versionId)).toMatchObject({ status: 'ready_to_publish', rating: 5 });
    expect((await publishVersion(db, author, versionId)).status).toBe('published');
  });

  it('keeps "publish with 9" open when no run is left, and clears the stale score, keeps the feedback, when improving', async () => {
    const tenSettings: AuditSettings = {
      ...settings,
      rating: { ...DEFAULT_RATING_CONFIG, volumeCaps: [] },
    };
    const long = '\n\nДодатковий розділ про змінні, цикли та функції з прикладами. '.repeat(70);
    const reject = async (versionId: string) => {
      const admin = await makeUser(['admin']);
      const expert = await makeUser(['expert']);
      const { reviewId } = await assignExpert(db, admin, { versionId, expertId: expert.id });
      const items = Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, false]));
      await decideReview(db, expert, reviewId, { decision: 'rejected', items, comment: 'Замало.' });
    };

    const author = await makeUser(['author']);
    const spent = await draft('good', author, long);
    // four runs are used: the audit below is the fifth
    await db.update(courseVersions).set({ auditAttempts: 4 }).where(eq(courseVersions.id, spent));
    await auditOnce(spent, author, tenSettings);
    await reject(spent);
    expect(await codeOf(resolveRejection(db, author, spent, { choice: 'improve' }))).toBe(
      'invalid_version_state',
    );
    expect((await resolveRejection(db, author, spent, { choice: 'publish_9' })).rating).toBe(9);

    const other = await draft('good', author, long);
    await auditOnce(other, author, tenSettings);
    await reject(other);
    await resolveRejection(db, author, other, { choice: 'improve' });
    expect(await statusOf(other)).toMatchObject({
      status: 'changes_requested',
      aiLevel: null,
      aiHardness: null,
      volumeCap: null,
    });
    // the feedback to improve from is kept
    expect((await statusOf(other)).auditSummary).toMatchObject({ outcome: 'expert_review' });
  });

  it('an expert whose review was given to another expert cannot decide it', async () => {
    const tenSettings: AuditSettings = {
      ...settings,
      rating: { ...DEFAULT_RATING_CONFIG, volumeCaps: [] },
    };
    const long = '\n\nДодатковий розділ про змінні, цикли та функції з прикладами. '.repeat(70);
    const author = await makeUser(['author']);
    const versionId = await draft('good', author, long);
    await auditOnce(versionId, author, tenSettings);
    const admin = await makeUser(['admin']);
    const [x, y] = [await makeUser(['expert']), await makeUser(['expert'])];
    const { reviewId } = await assignExpert(db, admin, { versionId, expertId: x!.id });
    await assignExpert(db, admin, { versionId, expertId: y!.id });
    const items = Object.fromEntries(CHECKLIST_ITEMS.map((k) => [k, true]));
    expect(await codeOf(decideReview(db, x!, reviewId, { decision: 'approved', items }))).toBe(
      'review_not_found',
    );
    expect((await statusOf(versionId)).status).toBe('expert_review');
  });
});
