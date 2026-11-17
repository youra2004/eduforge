import {
  assessmentItems,
  assessments,
  consents,
  courseVersions,
  createDb,
  enrollments,
  eventLog,
  experimentAssignments,
  experimentParticipants,
  questions,
  skillMastery,
  users,
  type ExperimentCondition,
} from '@eduforge/db';
import {
  DrizzleLLMRunStore,
  EmbeddingClient,
  LLMClient,
  MockEmbeddingProvider,
  MockLLMProvider,
} from '@eduforge/llm';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/guard';
import { loadConfig } from '../config';
import { createContentItem } from '../content/service';
import { indexNode } from '../content/indexing';
import { CourseError } from '../courses/errors';
import { getVersionGraph, importCourse } from '../courses/service';
import {
  answerPractice,
  enroll,
  getPracticeQuestion,
  getProgress,
  learningSettings,
  startNodeTest,
} from '../learning/service';
import { questionMockResponders } from '../questions/mock';
import { tutorMockResponders } from '../tutor/mock';
import { askTutor, type TutorDeps } from '../tutor/service';
import { assignmentsOf, CELLS } from './assign';
import { recordClientEvent } from './clientEvents';
import { exportCsv, EXPORT_TABLES } from './export';
import { SURVEY_ITEMS } from './survey';
import {
  answerAssessment,
  experimentSettings,
  finishLearning,
  getParticipation,
  joinExperiment,
  startStudyTest,
  submitSurvey,
  type StudyTestKind,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const config = loadConfig({ ...process.env, DATABASE_URL: 'x' });
const slugs = config.experiment.courseSlugs;
const learning = learningSettings(config);
const study = experimentSettings(config);
const llm = new LLMClient(
  new MockLLMProvider({ ...questionMockResponders, ...tutorMockResponders }),
  new DrizzleLLMRunStore(db),
);
const tutorDeps: TutorDeps = {
  llm,
  embedder: new EmbeddingClient(new MockEmbeddingProvider(1024), new DrizzleLLMRunStore(db)),
  limits: { ratePerMinute: 1000, dailyTokenBudget: 10_000_000 },
};

const T0 = new Date();
const later = (days: number) => new Date(T0.getTime() + days * 86_400_000);

let n = 0;
const EMAILS: string[] = [];
async function makeUser(roles: AuthUser['roles'] = ['student']): Promise<AuthUser> {
  const email = `exp-secret-${Date.now()}-${n++}@test.local`;
  EMAILS.push(email);
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Таємне Імʼя' })
    .returning();
  return { id: row!.id, email, displayName: 'Таємне Імʼя', roles };
}

const CORRECT = 1;
type Modules = Record<'A' | 'B', { versionId: string; nodeIds: string[]; skillIds: string[] }>;
let modules: Modules;

/** Two small published courses: the study's topics A and B, each with two nodes (n1 → n2). */
async function makeModule(slug: string, label: string) {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    {
      slug,
      title: `Модуль ${label}`,
      skills: [
        { key: 's1', name: `${label}: навичка 1` },
        { key: 's2', name: `${label}: навичка 2` },
      ],
      nodes: [
        {
          key: 'n1',
          title: `${label}: вузол 1`,
          skills: ['s1'],
          hints: [{ level: 1, text: 'Подумайте ще.' }],
        },
        { key: 'n2', title: `${label}: вузол 2`, skills: ['s2'] },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    },
    author.id,
  );
  const graph = await getVersionGraph(db, author, versionId);
  const embedder = tutorDeps.embedder as EmbeddingClient;
  for (const node of graph.nodes) {
    await createContentItem(db, author, node.id, {
      kind: 'markdown',
      title: 'Тема',
      bodyMd: `Матеріал вузла ${node.title}: змінна зберігає значення.`,
    });
    await indexNode(db, embedder, node.id);
  }
  await db
    .update(courseVersions)
    .set({ status: 'published' })
    .where(eq(courseVersions.id, versionId));
  for (const node of graph.nodes) {
    const skillId = node.skillIds[0]!;
    for (const [pool, count] of [
      ['node', 4],
      ['assessment', 3],
      ['exam', 3],
    ] as const) {
      await db.insert(questions).values(
        Array.from({ length: count }, (_, i) => ({
          nodeId: node.id,
          skillId,
          pool,
          kind: 'mcq' as const,
          promptMd: `${label} ${pool} ${node.title} №${i}`,
          options: ['Невірно', 'Вірно', 'Теж невірно', 'І це невірно'],
          answerKey: { optionIndex: CORRECT },
          guess: 0.25,
          status: 'validated' as const,
        })),
      );
    }
  }
  const sorted = graph.nodes.slice().sort((a, b) => a.title.localeCompare(b.title, 'uk'));
  return {
    versionId,
    nodeIds: sorted.map((x) => x.id),
    skillIds: sorted.map((x) => x.skillIds[0]!),
  };
}

beforeAll(async () => {
  modules = { A: await makeModule(slugs.A, 'A'), B: await makeModule(slugs.B, 'B') };
});

/** A participant placed straight into a cell, so a test knows each topic's condition. */
async function participantIn(cellIndex: number): Promise<AuthUser> {
  const user = await makeUser();
  const cell = CELLS[cellIndex]!;
  await db.insert(experimentParticipants).values({
    userId: user.id,
    code: `T-${Date.now().toString(36)}${n++}`.toUpperCase(),
    orderVariant: cell.orderVariant,
  });
  await db
    .insert(experimentAssignments)
    .values(assignmentsOf(cell).map((a) => ({ ...a, userId: user.id })));
  return user;
}
/** A_then_B, A = method (so B = control)  /  A_then_B, A = control (so B = method). */
const METHOD_FIRST = 0;
const CONTROL_FIRST = 1;

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError) return err.code;
    throw err;
  }
  return 'ok';
}

/** Takes a whole study test, answering everything right (or all wrong). */
async function takeStudyTest(
  user: AuthUser,
  module: 'A' | 'B',
  kind: StudyTestKind,
  opts: { right?: boolean; now?: Date } = {},
) {
  const now = opts.now ?? T0;
  const started = await startStudyTest(db, user, module, kind, learning, now);
  let last = started;
  for (const item of started.items) {
    const res = await answerAssessment(
      db,
      llm,
      user,
      started.id,
      item.id,
      { optionIndex: opts.right === false ? 0 : CORRECT },
      learning,
      now,
    );
    last = res.assessment;
  }
  return { started, last };
}

const survey = (v = 4) => ({ answers: Object.fromEntries(SURVEY_ITEMS.map((i) => [i.key, v])) });

async function conditionOf(user: AuthUser, module: 'A' | 'B') {
  const [a] = await db
    .select()
    .from(experimentAssignments)
    .where(
      and(eq(experimentAssignments.userId, user.id), eq(experimentAssignments.module, module)),
    );
  return a!.condition as ExperimentCondition;
}

describe('joining the study', () => {
  it('needs consent, records it, and gives a pseudonym and two assignments', async () => {
    const user = await makeUser();
    expect(await code(joinExperiment(db, user, {}))).toBe('consent_required');
    expect(await code(joinExperiment(db, user, { consent: false }))).toBe('consent_required');
    expect(await getParticipation(db, user, study)).toBeNull();

    const joined = await joinExperiment(db, user, { consent: true });
    expect(joined!.code).toMatch(/^P-[A-Z2-9]{6}$/);
    expect(joined!.modules.map((m) => m.period)).toEqual([1, 2]);
    expect(joined!.modules.map((m) => m.condition).sort()).toEqual(['control', 'method']);
    const [consent] = await db
      .select()
      .from(consents)
      .where(and(eq(consents.userId, user.id), eq(consents.kind, 'research')));
    expect(consent).toBeTruthy();

    // joining again changes nothing
    const again = await joinExperiment(db, user, { consent: true });
    expect(again!.code).toBe(joined!.code);
    const rows = await db
      .select()
      .from(experimentAssignments)
      .where(eq(experimentAssignments.userId, user.id));
    expect(rows).toHaveLength(2);
  });

  it('splits real joins evenly across the four cells', async () => {
    const before = await db.select().from(experimentParticipants);
    const start = before.length;
    for (let i = 0; i < 8; i++) await joinExperiment(db, await makeUser(), { consent: true });
    const all = await db.select().from(experimentParticipants);
    expect(all.length).toBe(start + 8);
    const mine = all.slice(start);
    // the newest 8 fill the emptiest cells: no order or topic-A condition gets more than 2 of 4 extra...
    expect(mine.filter((p) => p.orderVariant === 'A_then_B').length).toBeGreaterThanOrEqual(2);
    expect(mine.filter((p) => p.orderVariant === 'B_then_A').length).toBeGreaterThanOrEqual(2);
    const codes = new Set(all.map((p) => p.code));
    expect(codes.size).toBe(all.length);
  });
});

describe('the control condition (server side)', () => {
  it('has no gating: every node is open, and node tests are refused', async () => {
    const user = await participantIn(CONTROL_FIRST); // topic A = control
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    const progress = await getProgress(db, user, modules.A.versionId);
    expect(progress!.map((p) => p.state)).toEqual(['available', 'available']);
    // the second node has a prerequisite, but nothing is locked, so the material is readable straight away
    expect(await code(startNodeTest(db, user, modules.A.nodeIds[1]!, learning))).toBe(
      'node_test_disabled',
    );
    expect(await code(startNodeTest(db, user, modules.A.nodeIds[0]!, learning))).toBe(
      'node_test_disabled',
    );
    // self-check questions (practice) work and change nothing
    const [q] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.nodeId, modules.A.nodeIds[1]!), eq(questions.pool, 'node')))
      .limit(1);
    expect(
      (
        await answerPractice(
          db,
          llm,
          user,
          modules.A.nodeIds[1]!,
          q!.id,
          { optionIndex: 1 },
          learning,
        )
      ).isCorrect,
    ).toBe(true);
    const mastery = await db.select().from(skillMastery).where(eq(skillMastery.userId, user.id));
    expect(mastery).toHaveLength(0);
  });

  it('has no tutor, even when the request is made by hand', async () => {
    const user = await participantIn(CONTROL_FIRST);
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    expect(
      await code(askTutor(db, tutorDeps, user, modules.A.nodeIds[0]!, { message: 'Допоможіть' })),
    ).toBe('tutor_disabled');
  });

  it('is only the control for its own topic: the same person has gating and a tutor in the other one', async () => {
    const user = await participantIn(CONTROL_FIRST); // A = control, B = method
    expect(await conditionOf(user, 'B')).toBe('method');
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    await finishLearning(db, user, 'A');
    await takeStudyTest(user, 'A', 'posttest');
    await submitSurvey(db, user, 'A', survey());
    await takeStudyTest(user, 'B', 'pretest');
    await enroll(db, user, modules.B.versionId);
    const progress = await getProgress(db, user, modules.B.versionId);
    expect(progress!.map((p) => p.state).sort()).toEqual(['available', 'locked']);
    const reply = await askTutor(db, tutorDeps, user, modules.B.nodeIds[0]!, {
      message: 'Допоможіть',
    });
    expect(reply.message.content.length).toBeGreaterThan(0);
  });
});

describe('the method condition', () => {
  it('keeps gating and the tutor', async () => {
    const user = await participantIn(METHOD_FIRST);
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    const progress = await getProgress(db, user, modules.A.versionId);
    expect(progress!.map((p) => p.state).sort()).toEqual(['available', 'locked']);
    expect(await code(startNodeTest(db, user, modules.A.nodeIds[1]!, learning))).toBe(
      'node_locked',
    );
    const reply = await askTutor(db, tutorDeps, user, modules.A.nodeIds[0]!, {
      message: 'Допоможіть',
    });
    expect(reply.message.content.length).toBeGreaterThan(0);
  });

  it('ends only by passing every node: finishing by hand is refused', async () => {
    const user = await participantIn(METHOD_FIRST);
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    expect(await code(finishLearning(db, user, 'A'))).toBe('experiment_step_not_allowed');
  });
});

describe('the same assessment questions in both conditions', () => {
  it('gives method and control participants the same set for a topic, from the assessment pool only', async () => {
    const method = await participantIn(METHOD_FIRST);
    const control = await participantIn(CONTROL_FIRST);
    const idsOf = async (u: AuthUser) => {
      const { started } = await takeStudyTest(u, 'A', 'pretest');
      const rows = await db
        .select({ questionId: assessmentItems.questionId, pool: questions.pool })
        .from(assessmentItems)
        .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
        .where(eq(assessmentItems.assessmentId, started.id));
      expect(rows.every((r) => r.pool === 'assessment')).toBe(true);
      return rows.map((r) => r.questionId).sort();
    };
    const a = await idsOf(method);
    const b = await idsOf(control);
    expect(a).toHaveLength(6); // 2 nodes × 3 assessment questions
    expect(b).toEqual(a);
    expect(await conditionOf(method, 'A')).toBe('method');
    expect(await conditionOf(control, 'A')).toBe('control');
  });

  it('uses the same set for the pre-test, the post-test and the delayed test', async () => {
    const user = await participantIn(CONTROL_FIRST);
    const sets: string[][] = [];
    const take = async (kind: StudyTestKind, now?: Date) => {
      const { started } = await takeStudyTest(user, 'A', kind, { now });
      const rows = await db
        .select({ q: assessmentItems.questionId })
        .from(assessmentItems)
        .where(eq(assessmentItems.assessmentId, started.id));
      sets.push(rows.map((r) => r.q).sort());
    };
    await take('pretest');
    await enroll(db, user, modules.A.versionId);
    await finishLearning(db, user, 'A');
    await take('posttest');
    await submitSurvey(db, user, 'A', survey());
    await take('delayed_posttest', later(8));
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
  });
});

describe('the participant flow is enforced by the server', () => {
  it('follows pre-test → learning → post-test → survey, then the delayed test after the wait', async () => {
    const user = await participantIn(CONTROL_FIRST);
    const step = async (now = T0) =>
      (await getParticipation(db, user, study, now))!.modules.map((m) => m.step);
    expect(await step()).toEqual(['pretest', 'waiting']);

    // nothing can be skipped
    expect(await code(enroll(db, user, modules.A.versionId))).toBe('experiment_step_not_allowed');
    expect(await code(startStudyTest(db, user, 'A', 'posttest', learning))).toBe(
      'experiment_step_not_allowed',
    );
    expect(await code(startStudyTest(db, user, 'A', 'delayed_posttest', learning))).toBe(
      'experiment_step_not_allowed',
    );
    expect(await code(startStudyTest(db, user, 'B', 'pretest', learning))).toBe(
      'experiment_step_not_allowed',
    );
    expect(await code(submitSurvey(db, user, 'A', survey()))).toBe('experiment_step_not_allowed');

    await takeStudyTest(user, 'A', 'pretest');
    expect(await step()).toEqual(['learning', 'waiting']);
    expect(await code(finishLearning(db, user, 'A'))).toBe('not_enrolled');
    await enroll(db, user, modules.A.versionId);
    expect(await code(startStudyTest(db, user, 'A', 'posttest', learning))).toBe(
      'experiment_step_not_allowed',
    );
    await finishLearning(db, user, 'A');
    expect(await step()).toEqual(['posttest', 'waiting']);

    await takeStudyTest(user, 'A', 'posttest');
    expect(await step()).toEqual(['survey', 'waiting']);
    expect(await code(startStudyTest(db, user, 'B', 'pretest', learning))).toBe(
      'experiment_step_not_allowed',
    );
    expect(await code(submitSurvey(db, user, 'A', { answers: { clarity: 9 } }))).toBe(
      'invalid_survey',
    );
    await submitSurvey(db, user, 'A', survey(5));
    expect(await code(submitSurvey(db, user, 'A', survey()))).toBe('experiment_step_not_allowed');

    // the next topic opens, and the delayed test of the first waits for its delay
    expect(await step()).toEqual(['delayed_wait', 'pretest']);
    expect(await code(startStudyTest(db, user, 'A', 'delayed_posttest', learning, later(1)))).toBe(
      'experiment_step_not_allowed',
    );
    expect((await getParticipation(db, user, study, later(1)))!.reminders).toEqual([]);
    expect(await step(later(8))).toEqual(['delayed', 'pretest']);
    expect((await getParticipation(db, user, study, later(8)))!.reminders).toEqual(['A']);
    await takeStudyTest(user, 'A', 'delayed_posttest', { now: later(8) });
    expect(await step(later(8))).toEqual(['complete', 'pretest']);
    expect((await getParticipation(db, user, study, later(8)))!.reminders).toEqual([]);
  });

  it('resumes a started test instead of starting a second one', async () => {
    const user = await participantIn(CONTROL_FIRST);
    const first = await startStudyTest(db, user, 'A', 'pretest', learning);
    const second = await startStudyTest(db, user, 'A', 'pretest', learning);
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(assessments).where(eq(assessments.userId, user.id));
    expect(rows).toHaveLength(1);
    expect((await getParticipation(db, user, study))!.modules[0]!.runningAssessmentId).toBe(
      first.id,
    );
  });

  it('refuses people who have not joined, and other people’s tests', async () => {
    const outsider = await makeUser();
    expect(await code(startStudyTest(db, outsider, 'A', 'pretest', learning))).toBe(
      'experiment_not_joined',
    );
    const user = await participantIn(CONTROL_FIRST);
    const { id, items } = await startStudyTest(db, user, 'A', 'pretest', learning);
    expect(
      await code(
        answerAssessment(db, llm, outsider, id, items[0]!.id, { optionIndex: 1 }, learning),
      ),
    ).toBe('assessment_not_found');
  });
});

describe('study tests measure, they do not teach', () => {
  it('give no feedback, no BKT and no tutor while running', async () => {
    const user = await participantIn(METHOD_FIRST);
    const started = await startStudyTest(db, user, 'A', 'pretest', learning);
    expect(started.kind).toBe('pretest');
    const res = await answerAssessment(
      db,
      llm,
      user,
      started.id,
      started.items[0]!.id,
      { optionIndex: 0 },
      learning,
    );
    expect(res.assessment.items[0]!.isCorrect).toBeNull();
    expect(res.assessment.result).toBeNull();
    expect(JSON.stringify(res.assessment)).not.toMatch(/answerKey|rubric|optionIndex"?:\s*1/);
    // the tutor is closed while a test runs
    await enroll(db, user, modules.A.versionId).catch(() => undefined);
    expect(
      await code(askTutor(db, tutorDeps, user, modules.A.nodeIds[0]!, { message: 'x' })),
    ).not.toBe('ok');
    // finishing it still gives no feedback and no mastery
    for (const item of started.items.slice(1)) {
      await answerAssessment(db, llm, user, started.id, item.id, { optionIndex: 1 }, learning);
    }
    const [row] = await db.select().from(assessments).where(eq(assessments.id, started.id));
    expect(row!.status).toBe('submitted');
    expect(row!.scorePct).toBeCloseTo((5 / 6) * 100);
    const view = await startStudyTest(db, user, 'A', 'posttest', learning).catch(() => null);
    expect(view).toBeNull(); // not before the learning part
    const mastery = await db.select().from(skillMastery).where(eq(skillMastery.userId, user.id));
    expect(mastery).toHaveLength(0);
  });
});

/** RESEARCH.md §3, "Required event_log events". */
const REQUIRED_EVENTS = [
  'module_started',
  'module_finished',
  'content_opened',
  'video_progress',
  'node_test_started',
  'node_test_submitted',
  'question_answered',
  'hint_requested',
  'tutor_message',
  'mastery_updated',
  'cooldown_started',
  'pretest_started',
  'pretest_submitted',
  'posttest_started',
  'posttest_submitted',
  'survey_submitted',
  'session_heartbeat',
];

describe('research events (P5)', () => {
  it('writes every event of the RESEARCH.md list, each with user, module and condition', async () => {
    const user = await participantIn(METHOD_FIRST); // A = method, B = control

    // topic A (method): pre-test, tutor, a failed round (pause), then passing both nodes
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    const [n1, n2] = modules.A.nodeIds as [string, string];
    expect(
      await recordClientEvent(db, user, { name: 'content_opened', nodeId: n1 }, study),
    ).toEqual({ logged: true });
    expect(
      await recordClientEvent(db, user, { name: 'session_heartbeat', nodeId: n1 }, study),
    ).toEqual({ logged: true });
    await recordClientEvent(
      db,
      user,
      {
        name: 'video_progress',
        nodeId: n1,
        contentItemId: crypto.randomUUID(),
        positionSeconds: 12.5,
        durationSeconds: 60,
      },
      study,
    );
    await askTutor(db, tutorDeps, user, n1, { message: 'Підкажіть, будь ласка' });

    // TIME_SCALE 1440: the 24 h pause is 60 s, so a test can sit it out
    const fast = learningSettings(loadConfig({ DATABASE_URL: 'x', TIME_SCALE: '1440' }));
    const test = async (nodeId: string, right: boolean, now = new Date()) => {
      const started = await startNodeTest(db, user, nodeId, fast, now);
      for (const item of started.items) {
        await answerAssessment(
          db,
          llm,
          user,
          started.id,
          item.id,
          { optionIndex: right ? CORRECT : 0 },
          fast,
          now,
        );
      }
    };
    await test(n1, false);
    await test(n1, false); // second failed attempt: the pause starts (cooldown_started)
    await test(n1, true, new Date(Date.now() + 120_000));
    await test(n2, true);
    await takeStudyTest(user, 'A', 'posttest');
    await submitSurvey(db, user, 'A', survey(3));

    // topic B (control): pre-test, free reading, finishing by hand, post-test
    await takeStudyTest(user, 'B', 'pretest');
    await enroll(db, user, modules.B.versionId);
    await recordClientEvent(
      db,
      user,
      { name: 'content_opened', nodeId: modules.B.nodeIds[1]! },
      study,
    );
    await finishLearning(db, user, 'B');
    await takeStudyTest(user, 'B', 'posttest');
    await submitSurvey(db, user, 'B', survey(2));
    await takeStudyTest(user, 'A', 'delayed_posttest', { now: later(8) });

    const events = await db.select().from(eventLog).where(eq(eventLog.userId, user.id));
    const names = new Set(events.map((e) => e.name));
    const missing = REQUIRED_EVENTS.filter((e) => !names.has(e));
    expect(missing).toEqual([]);
    expect(names.has('delayed_posttest_started') && names.has('delayed_posttest_submitted')).toBe(
      true,
    );

    // every event of a study course carries the module and the condition of that topic
    const studyEvents = events.filter((e) => REQUIRED_EVENTS.includes(e.name));
    for (const e of studyEvents) {
      const p = e.props as { module?: string; condition?: string };
      expect(p.module, e.name).toMatch(/^[AB]$/);
      expect(p.condition, e.name).toBe(p.module === 'A' ? 'method' : 'control');
    }
    expect(events.every((e) => e.ts instanceof Date && e.userId === user.id)).toBe(true);
  });

  it('accepts only known client events for a node the user may open, and throttles heartbeats', async () => {
    const user = await participantIn(METHOD_FIRST);
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    const [n1, n2] = modules.A.nodeIds as [string, string];
    expect(await code(recordClientEvent(db, user, { name: 'enrolled', nodeId: n1 }, study))).toBe(
      'invalid_content',
    );
    expect(
      await code(recordClientEvent(db, user, { name: 'content_opened', nodeId: n2 }, study)),
    ).toBe('node_locked');
    expect(
      await recordClientEvent(db, user, { name: 'session_heartbeat', nodeId: n1 }, study),
    ).toEqual({ logged: true });
    expect(
      await recordClientEvent(db, user, { name: 'session_heartbeat', nodeId: n1 }, study),
    ).toEqual({ logged: false });
    const beats = await db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.userId, user.id), eq(eventLog.name, 'session_heartbeat')));
    expect(beats).toHaveLength(1);
  });
});

describe('closed doors around the learning step', () => {
  it('opens the material only while learning: not before the pre-test, not after the module is finished', async () => {
    const user = await participantIn(CONTROL_FIRST);
    const [n1] = modules.A.nodeIds as [string];
    expect(
      await code(recordClientEvent(db, user, { name: 'content_opened', nodeId: n1 }, study)),
    ).toBe('not_enrolled');
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    expect(
      await code(recordClientEvent(db, user, { name: 'content_opened', nodeId: n1 }, study)),
    ).toBe('ok');
    await finishLearning(db, user, 'A');
    expect(
      await code(recordClientEvent(db, user, { name: 'content_opened', nodeId: n1 }, study)),
    ).toBe('experiment_step_not_allowed');
    expect(await code(getPracticeQuestion(db, user, n1))).toBe('experiment_step_not_allowed');
    expect(await code(askTutor(db, tutorDeps, user, n1, { message: 'x' }))).toBe(
      'experiment_step_not_allowed',
    );
  });

  it('applies to a participant who is also an admin: staff rights do not open the material early', async () => {
    const user = await participantIn(CONTROL_FIRST);
    const admin: AuthUser = { ...user, roles: ['student', 'admin'] };
    expect(
      await code(
        recordClientEvent(
          db,
          admin,
          { name: 'content_opened', nodeId: modules.A.nodeIds[0]! },
          study,
        ),
      ),
    ).toBe('not_enrolled');
  });

  it('keeps people who are not in the study out of the study courses, and refuses joiners who already studied', async () => {
    const outsider = await makeUser();
    expect(await code(enroll(db, outsider, modules.A.versionId))).toBe('experiment_not_joined');
    const early = await makeUser();
    await db.insert(enrollments).values({ userId: early.id, courseVersionId: modules.B.versionId });
    expect(await code(joinExperiment(db, early, { consent: true }))).toBe(
      'experiment_step_not_allowed',
    );
    expect(await getParticipation(db, early, study)).toBeNull();
  });
});

describe('heartbeats cannot be inflated', () => {
  it('logs one heartbeat out of a burst of parallel requests', async () => {
    const user = await participantIn(METHOD_FIRST);
    await takeStudyTest(user, 'A', 'pretest');
    await enroll(db, user, modules.A.versionId);
    const nodeId = modules.A.nodeIds[0]!;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        recordClientEvent(db, user, { name: 'session_heartbeat', nodeId }, study),
      ),
    );
    expect(results.filter((r) => r.logged)).toHaveLength(1);
    const beats = await db
      .select()
      .from(eventLog)
      .where(and(eq(eventLog.userId, user.id), eq(eventLog.name, 'session_heartbeat')));
    expect(beats).toHaveLength(1);
  });
});

describe('the CSV export', () => {
  it('has no emails, names or user ids, only pseudonyms; and the data is there', async () => {
    const user = await participantIn(CONTROL_FIRST);
    await takeStudyTest(user, 'A', 'pretest', { right: false });
    await enroll(db, user, modules.A.versionId);
    await recordClientEvent(
      db,
      user,
      { name: 'session_heartbeat', nodeId: modules.A.nodeIds[0]! },
      study,
    );
    await finishLearning(db, user, 'A');
    await takeStudyTest(user, 'A', 'posttest');
    await submitSurvey(db, user, 'A', survey(4));

    const [me] = await db
      .select()
      .from(experimentParticipants)
      .where(eq(experimentParticipants.userId, user.id));
    const ids = (await db.select({ id: users.id }).from(users)).map((u) => u.id);
    for (const table of EXPORT_TABLES) {
      const csv = await exportCsv(db, table, config);
      const header = csv.split('\n')[0]!.split(',');
      expect(header[0], table).toBe('participant_code');
      expect(header.join(',')).not.toMatch(/email|user_id|display_name|(^|,)name(,|$)|password/i);
      // no email address, display name or user id anywhere in the file
      for (const email of EMAILS) expect(csv, table).not.toContain(email);
      expect(csv, table).not.toContain('Таємне Імʼя');
      for (const id of ids) expect(csv, table).not.toContain(id);
    }
    const modulesCsv = await exportCsv(db, 'modules', config);
    const row = modulesCsv.split('\n').find((l) => l.startsWith(`${me!.code},A,`))!;
    const cols = modulesCsv.split('\n')[0]!.split(',');
    const cell = (name: string) => row.split(',')[cols.indexOf(name)];
    expect(cell('condition')).toBe('control');
    expect(cell('pretest')).toBe('0');
    expect(cell('posttest')).toBe('1');
    expect(cell('gain_post')).toBe('1');
    expect(cell('survey_help')).toBe('4');
    expect(cell('active_seconds')).toBe(String(config.experiment.heartbeatSeconds));
    expect(cell('node_test_attempts')).toBe('0');
    const answers = await exportCsv(db, 'answers', config);
    expect(
      answers.split('\n').filter((l) => l.startsWith(`${me!.code},A,control,pretest`)),
    ).toHaveLength(6);
    await db
      .insert(eventLog)
      .values({ userId: user.id, name: 'unrelated_event_outside_study', props: {} });
    const events = await exportCsv(db, 'events', config);
    expect(events).not.toContain('unrelated_event_outside_study');
    expect(events).toContain(`${me!.code},`);
    expect(events).toContain('survey_submitted');
  });
});
