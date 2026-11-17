import { readFileSync } from 'node:fs';
import {
  assessmentItems,
  assessments,
  courseVersions,
  createDb,
  eventLog,
  masteryHistory,
  nodeProgress,
  questions,
  skillMastery,
  users,
} from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient } from '@eduforge/llm';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/guard';
import { loadConfig } from '../config';
import { listNodeContent } from '../content/service';
import { CourseError } from '../courses/errors';
import { getVersionGraph, importCourse } from '../courses/service';
import { createQuestionMock } from '../questions/mock';
import {
  answerItem,
  answerPractice,
  enroll,
  getAssessment,
  getPracticeQuestion,
  getProgress,
  learningSettings,
  startNodeTest,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);
const llm = new LLMClient(createQuestionMock(), new DrizzleLLMRunStore(db));
// TIME_SCALE 1440 turns the 24 h pause into 60 s.
const settings = learningSettings(loadConfig({ DATABASE_URL: 'x', TIME_SCALE: '1440' }));
const T0 = new Date('2026-03-01T10:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `learning-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}

const CORRECT = 1;
async function setup(poolSize = 4) {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `learn-${Date.now()}-${n++}` },
    author.id,
  );
  await db
    .update(courseVersions)
    .set({ status: 'published' })
    .where(eq(courseVersions.id, versionId));
  const graph = await getVersionGraph(db, author, versionId);
  const byKey = new Map<string, (typeof graph.nodes)[number]>(
    demo.nodes.map((dn: { key: string; title: string }) => [
      dn.key,
      graph.nodes.find((g) => g.title === dn.title)!,
    ]),
  );
  for (const node of graph.nodes) {
    for (const skillId of node.skillIds) {
      for (const [pool, count] of [
        ['node', poolSize],
        ['exam', 3],
      ] as const) {
        await db.insert(questions).values(
          Array.from({ length: count }, (_, i) => ({
            nodeId: node.id,
            skillId,
            pool,
            kind: 'mcq' as const,
            promptMd: `Питання ${pool} ${i}`,
            options: ['Невірно', 'Вірно', 'Теж невірно', 'І це невірно'],
            answerKey: { optionIndex: CORRECT },
            guess: 0.25,
            status: 'validated' as const,
          })),
        );
      }
    }
  }
  const student = await makeUser(['student']);
  return { author, student, versionId, graph, node: (key: string) => byKey.get(key)! };
}

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError) return err.code;
    throw err;
  }
  return 'ok';
}

/** Answers every question of a running test with the right (or a wrong) option. */
async function takeTest(user: AuthUser, nodeId: string, opts: { right: boolean; now: Date }) {
  const started = await startNodeTest(db, user, nodeId, settings, opts.now);
  let last = started;
  for (const item of started.items) {
    const res = await answerItem(
      db,
      llm,
      user,
      started.id,
      item.id,
      { optionIndex: opts.right ? CORRECT : 0 },
      settings,
      opts.now,
    );
    last = res.assessment;
  }
  return last;
}

describe('enrollment and unlocking', () => {
  it('only a published version can be joined; roots open, the rest locked; joining twice is harmless', async () => {
    const { student, versionId, node } = await setup();
    expect(await getProgress(db, student, versionId)).toBeNull();
    await enroll(db, student, versionId);
    await enroll(db, student, versionId);
    const progress = await getProgress(db, student, versionId);
    expect(progress).toHaveLength(8);
    expect(progress!.find((p) => p.nodeId === node('start').id)!.state).toBe('available');
    expect(progress!.filter((p) => p.state === 'locked')).toHaveLength(7);

    const author = await makeUser(['author']);
    const draft = await importCourse(
      db,
      { ...structuredClone(demo), slug: `d-${Date.now()}` },
      author.id,
    );
    expect(await code(enroll(db, student, draft.versionId))).toBe('course_not_found');
    // its author can see the draft, but nobody can join it
    expect(await code(enroll(db, author, draft.versionId))).toBe('version_not_published');
  });

  it('a locked node is closed on the server: test, practice and material', async () => {
    const { student, author, versionId, node } = await setup();
    const locked = node('types').id;
    expect(await code(startNodeTest(db, student, locked, settings, T0))).toBe('not_enrolled');
    expect(await code(listNodeContent(db, student, locked))).toBe('not_enrolled');

    await enroll(db, student, versionId);
    expect(await code(startNodeTest(db, student, locked, settings, T0))).toBe('node_locked');
    expect(await code(listNodeContent(db, student, locked))).toBe('node_locked');
    expect(await code(getPracticeQuestion(db, student, locked))).toBe('node_locked');
    expect(
      await code(answerPractice(db, llm, student, locked, node('start').id, {}, settings)),
    ).toBe('node_locked');
    // the open node and the author's review of the whole course still work
    expect(await code(listNodeContent(db, student, node('start').id))).toBe('ok');
    expect(await code(listNodeContent(db, author, locked))).toBe('ok');
  });

  it('passing a node writes every answer and every p_known change, and unlocks the next node', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const start = node('start');
    const result = await takeTest(student, start.id, { right: true, now: T0 });

    expect(result.status).toBe('passed');
    expect(result.result!.passed).toBe(true);
    expect(result.result!.perSkill.every((s) => s.pKnown >= 0.8)).toBe(true);
    expect(result.items.every((i) => i.isCorrect === true)).toBe(true);

    const items = await db
      .select()
      .from(assessmentItems)
      .where(eq(assessmentItems.assessmentId, result.id));
    expect(items).toHaveLength(6); // 2 skills × 3
    expect(
      items.every((i) => i.answer && i.answeredAt && i.isCorrect && i.gradedBy === 'auto'),
    ).toBe(true);

    const history = await db
      .select()
      .from(masteryHistory)
      .where(eq(masteryHistory.userId, student.id));
    expect(history).toHaveLength(6);
    expect(new Set(history.map((h) => h.assessmentItemId))).toEqual(
      new Set(items.map((i) => i.id)),
    );
    for (const skillId of start.skillIds) {
      const rows = history.filter((h) => h.skillId === skillId).sort((a, b) => a.pAfter - b.pAfter);
      expect(rows[0]!.pBefore).toBeCloseTo(0.2); // p_init
      const [m] = await db
        .select()
        .from(skillMastery)
        .where(and(eq(skillMastery.userId, student.id), eq(skillMastery.skillId, skillId)));
      expect(m!.pKnown).toBeCloseTo(rows.at(-1)!.pAfter);
      expect(m!.nObs).toBe(3);
    }

    const progress = await getProgress(db, student, versionId, T0);
    const state = (key: string) => progress!.find((p) => p.nodeId === node(key).id)!.state;
    expect(state('start')).toBe('passed');
    expect(state('types')).toBe('available');
    expect(state('conditions')).toBe('locked');
    const events = await db
      .select({ name: eventLog.name })
      .from(eventLog)
      .where(eq(eventLog.userId, student.id));
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining([
        'enrolled',
        'node_test_started',
        'question_answered',
        'node_test_submitted',
        'node_unlocked',
      ]),
    );
  });

  it('prerequisites are AND: collections needs both loops and functions', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const pass = (key: string) => takeTest(student, node(key).id, { right: true, now: T0 });
    const state = async (key: string) =>
      (await getProgress(db, student, versionId, T0))!.find((p) => p.nodeId === node(key).id)!
        .state;

    for (const key of ['start', 'types', 'conditions', 'loops']) await pass(key);
    expect(await state('functions')).toBe('available');
    expect(await state('collections')).toBe('locked'); // loops passed, functions not yet
    await pass('functions');
    expect(await state('collections')).toBe('available');
  });
});

describe('rounds and the pause (fake clock)', () => {
  it('two failed attempts start the pause; it cannot be skipped; round 2 opens exactly when it ends', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const id = node('start').id;
    expect(settings.cooldownSeconds).toBe(60);

    const first = await takeTest(student, id, { right: false, now: T0 });
    expect(first.status).toBe('failed');
    expect(first.result!.node).toMatchObject({ state: 'in_progress', attemptsInRound: 1 });

    const second = await takeTest(student, id, { right: false, now: at(10) });
    expect(second.attemptNo).toBe(2);
    expect(second.result!.node).toMatchObject({ state: 'cooldown', attemptsInRound: 2 });
    expect(second.result!.node!.cooldownUntil).toEqual(at(70));

    // inside the pause: refused, whatever time the caller likes up to the last second
    expect(await code(startNodeTest(db, student, id, settings, at(11)))).toBe('node_cooldown');
    expect(await code(startNodeTest(db, student, id, settings, at(69)))).toBe('node_cooldown');
    const mid = (await getProgress(db, student, versionId, at(69)))!.find((p) => p.nodeId === id)!;
    expect(mid.state).toBe('cooldown');

    // at the end of the pause a new round starts with fresh attempts
    const next = await startNodeTest(db, student, id, settings, at(70));
    expect(next).toMatchObject({ roundNo: 2, attemptNo: 1, status: 'in_progress' });
    const [row] = await db
      .select()
      .from(nodeProgress)
      .where(and(eq(nodeProgress.userId, student.id), eq(nodeProgress.nodeId, id)));
    expect(row).toMatchObject({
      state: 'in_progress',
      roundNo: 2,
      attemptsInRound: 0,
      cooldownUntil: null,
    });
  });

  it('retries draw unseen questions first and repeat only when the pool is exhausted', async () => {
    const { student, versionId, node } = await setup(4);
    await enroll(db, student, versionId);
    const id = node('start').id;
    const questionIds = async (assessmentId: string) =>
      (
        await db
          .select({ q: assessmentItems.questionId })
          .from(assessmentItems)
          .where(eq(assessmentItems.assessmentId, assessmentId))
      ).map((r) => r.q);

    const a1 = await takeTest(student, id, { right: false, now: T0 });
    const a2 = await takeTest(student, id, { right: false, now: at(1) });
    const q1 = new Set(await questionIds(a1.id));
    const q2 = await questionIds(a2.id);
    // per skill: 4 questions, 3 shown, so exactly one new one each, and two repeats each
    expect(q2.filter((q) => !q1.has(q))).toHaveLength(2);
    expect(q2).toHaveLength(6);
  });

  it('starting again returns the running test instead of a second one', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const a = await startNodeTest(db, student, node('start').id, settings, T0);
    const b = await startNodeTest(db, student, node('start').id, settings, at(5));
    expect(b.id).toBe(a.id);
    const rows = await db.select().from(assessments).where(eq(assessments.userId, student.id));
    expect(rows).toHaveLength(1);
  });

  it('a pool that is too small refuses to build a short test', async () => {
    const { student, versionId, node } = await setup(2);
    await enroll(db, student, versionId);
    expect(await code(startNodeTest(db, student, node('start').id, settings, T0))).toBe(
      'test_unavailable',
    );
  });
});

describe('what a student may see and do', () => {
  it('never gets keys, and no verdicts while the test runs; exam questions never appear', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const started = await startNodeTest(db, student, node('start').id, settings, T0);
    const json = JSON.stringify(started);
    for (const banned of ['answerKey', 'rubric', 'optionIndex', 'guess', 'slip', 'difficulty']) {
      expect(json).not.toContain(banned);
    }
    expect(started.items.every((i) => i.isCorrect === null)).toBe(true);
    const ids = started.items.map((i) => i.question.id);
    const rows = await db
      .select({ pool: questions.pool })
      .from(questions)
      .where(inArray(questions.id, ids));
    expect(rows.every((r) => r.pool === 'node')).toBe(true);

    const first = await answerItem(
      db,
      llm,
      student,
      started.id,
      started.items[0]!.id,
      { optionIndex: 0 },
      settings,
      T0,
    );
    expect(first.finished).toBe(false);
    expect(first.assessment.items[0]!.isCorrect).toBeNull();
    expect(first.assessment.result).toBeNull();
  });

  it("another student cannot read or answer someone else's test, and an item is answered once", async () => {
    const { student, versionId, node } = await setup();
    const other = await makeUser(['student']);
    await enroll(db, student, versionId);
    const started = await startNodeTest(db, student, node('start').id, settings, T0);
    const item = started.items[0]!;
    expect(await code(getAssessment(db, other, started.id, settings))).toBe('assessment_not_found');
    expect(
      await code(answerItem(db, llm, other, started.id, item.id, { optionIndex: 1 }, settings, T0)),
    ).toBe('assessment_not_found');
    await answerItem(db, llm, student, started.id, item.id, { optionIndex: 1 }, settings, T0);
    expect(
      await code(
        answerItem(db, llm, student, started.id, item.id, { optionIndex: 1 }, settings, T0),
      ),
    ).toBe('already_answered');
    expect(
      await code(
        answerItem(db, llm, student, started.id, started.items[1]!.id, { text: 'x' }, settings, T0),
      ),
    ).toBe('invalid_question');
  });

  it('a finished test is closed for more answers', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const done = await takeTest(student, node('start').id, { right: true, now: T0 });
    expect(
      await code(
        answerItem(db, llm, student, done.id, done.items[0]!.id, { optionIndex: 1 }, settings, T0),
      ),
    ).toBe('assessment_closed');
  });
});

describe('practice mode', () => {
  it('grades but changes neither skill_mastery, mastery_history, assessment_items nor progress', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const nodeId = node('start').id;
    const before = await db.select().from(nodeProgress).where(eq(nodeProgress.userId, student.id));

    const q = await getPracticeQuestion(db, student, nodeId);
    expect(q).not.toBeNull();
    expect(JSON.stringify(q)).not.toContain('answerKey');
    const right = await answerPractice(
      db,
      llm,
      student,
      nodeId,
      q!.id,
      { optionIndex: CORRECT },
      settings,
    );
    const wrong = await answerPractice(
      db,
      llm,
      student,
      nodeId,
      q!.id,
      { optionIndex: 0 },
      settings,
    );
    expect([right.isCorrect, wrong.isCorrect]).toEqual([true, false]);

    expect(
      await db.select().from(skillMastery).where(eq(skillMastery.userId, student.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(masteryHistory).where(eq(masteryHistory.userId, student.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(assessments).where(eq(assessments.userId, student.id)),
    ).toHaveLength(0);
    expect(await db.select().from(nodeProgress).where(eq(nodeProgress.userId, student.id))).toEqual(
      before,
    );
    const events = await db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.userId, student.id), eq(eventLog.name, 'practice_answered')));
    expect(events).toHaveLength(2);
  });

  it('refuses a question from another node or from the exam pool', async () => {
    const { student, versionId, node } = await setup();
    await enroll(db, student, versionId);
    const [exam] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.nodeId, node('start').id), eq(questions.pool, 'exam')));
    expect(
      await code(
        answerPractice(db, llm, student, node('start').id, exam!.id, { optionIndex: 1 }, settings),
      ),
    ).toBe('question_not_found');
  });
});
