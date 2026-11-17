import { readFileSync } from 'node:fs';
import { courseVersions, createDb, llmRuns, questions, users } from '@eduforge/db';
import { DrizzleLLMRunStore, LLMClient, MockLLMProvider, type LLMProvider } from '@eduforge/llm';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AuthError, type AuthUser } from '../auth/guard';
import { createContentItem } from '../content/service';
import { CourseError } from '../courses/errors';
import { createNewVersion, getVersionGraph, importCourse } from '../courses/service';
import { toStudentQuestion } from './dto';
import { createQuestionMock } from './mock';
import { generateQuestions, validateQuestion } from './pipeline';
import { poolIssues } from './pools';
import { generatorPrompt, GENERATOR_SYSTEM } from './prompts';
import {
  assertQuestionsInPool,
  createQuestion,
  decideQuestion,
  listNodeQuestions,
  planGeneration,
  updateQuestion,
} from './service';
import { nodeSkillList, nodeTheory } from './theory';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const demo = JSON.parse(
  readFileSync(new URL('../../seed/demo-course.json', import.meta.url), 'utf8'),
);
const cfg = { slip: 0.1 };

let n = 0;
async function makeUser(roles: AuthUser['roles']): Promise<AuthUser> {
  const email = `questions-test-${Date.now()}-${n++}@test.local`;
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning();
  return { id: row!.id, email, displayName: 'Тест', roles };
}

const THEORY_A =
  'Змінна зберігає значення під іменем. Функція print виводить текст на екран. Індексація списку починається з нуля.';
const THEORY_B = 'Секретна теорія іншого вузла про бази даних і SQL запити.';

async function setup() {
  const author = await makeUser(['author']);
  const { versionId } = await importCourse(
    db,
    { ...structuredClone(demo), slug: `q-${Date.now()}-${n++}` },
    author.id,
  );
  const graph = await getVersionGraph(db, author, versionId);
  // the first two nodes that have at least two skills
  const [a, b] = graph.nodes.filter((x) => x.skillIds.length >= 2) as [
    (typeof graph.nodes)[number],
    (typeof graph.nodes)[number],
  ];
  await createContentItem(db, author, a.id, {
    kind: 'markdown',
    title: 'Теорія',
    bodyMd: THEORY_A,
  });
  await createContentItem(db, author, b.id, { kind: 'markdown', title: 'Інше', bodyMd: THEORY_B });
  return { author, versionId, a, b, graph };
}

const llmWith = (provider: LLMProvider = createQuestionMock()) =>
  new LLMClient(provider, new DrizzleLLMRunStore(db));

const mcqBody = (
  skillId: string,
  options: string[],
  correctIndex: number,
  promptMd = 'Що вірно?',
) => ({
  pool: 'node',
  kind: 'mcq',
  skillId,
  promptMd,
  options,
  correctIndex,
});

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof CourseError || err instanceof AuthError) return err.code;
    return `other:${String(err)}`;
  }
  return 'none';
}

describe('generator (F3-R3)', () => {
  it('sees only the theory of its node and the skill list', async () => {
    const { author, a } = await setup();
    // things that must not leak into the prompt: the node's title and summary, another node's text, an existing question
    await db.update(courseVersions).set({ description: 'ОПИС-КУРСУ-СЕКРЕТ' });
    await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['ІСНУЮЧЕ-ПИТАННЯ-1', 'ІСНУЮЧЕ-ПИТАННЯ-2'], 0),
      cfg,
    );

    const provider = createQuestionMock();
    const r = await generateQuestions(db, llmWith(provider), cfg, {
      nodeId: a.id,
      pool: 'node',
      perSkill: 4,
    });

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0]!;
    expect(call.purpose).toBe('question_generation');
    const [theory, skills] = await Promise.all([nodeTheory(db, a.id), nodeSkillList(db, a.id)]);
    // exactly the theory and the skills, built by the one prompt function
    expect(call.prompt).toBe(generatorPrompt(theory, skills, 4));
    expect(call.system).toBe(GENERATOR_SYSTEM);
    expect(call.prompt).toContain(THEORY_A);
    for (const s of skills) expect(call.prompt).toContain(s.name);
    for (const leak of [a.title, a.summary, THEORY_B, 'ІСНУЮЧЕ-ПИТАННЯ', 'ОПИС-КУРСУ-СЕКРЕТ']) {
      expect(call.prompt).not.toContain(leak);
      expect(call.system).not.toContain(leak);
    }

    // the logged request is the same prompt; questions point back to the run
    const [run] = await db.select().from(llmRuns).where(eq(llmRuns.id, r.runId));
    expect(run!.purpose).toBe('question_generation');
    expect((run!.request as { prompt: string }).prompt).toBe(call.prompt);
    expect(r.questionIds).toHaveLength(skills.length * 4);
    const rows = await db.select().from(questions).where(eq(questions.generatorRunId, r.runId));
    expect(rows).toHaveLength(r.questionIds.length);
    expect(rows.every((q) => q.status === 'generated' && q.pool === 'node')).toBe(true);
    expect(rows.every((q) => q.validatorRunId === null && q.slip === 0.1)).toBe(true);
  });

  it('drops questions for a skill outside the node and keeps the rest', async () => {
    const { a, b } = await setup();
    const foreign = b.skillIds.find((s) => !a.skillIds.includes(s))!;
    const provider = new MockLLMProvider({
      question_generation: () => ({
        questions: [
          { kind: 'short', skillId: a.skillIds[0], promptMd: 'Q1', accepted: ['x'] },
          { kind: 'short', skillId: foreign, promptMd: 'Q2', accepted: ['x'] },
          {
            kind: 'mcq',
            skillId: a.skillIds[0],
            promptMd: 'Q3',
            options: ['a', 'b'],
            correctIndex: 5,
          },
        ],
      }),
    });
    const r = await generateQuestions(db, llmWith(provider), cfg, {
      nodeId: a.id,
      pool: 'exam',
      perSkill: 1,
    });
    expect(r.questionIds).toHaveLength(1);
    expect(r.dropped).toBe(2);
  });

  it('refuses a node without theory and a frozen version', async () => {
    const { author, graph, versionId, a, b } = await setup();
    const empty = graph.nodes.find((x) => x.id !== a.id && x.id !== b.id && x.skillIds.length > 0)!;
    const input = { nodeId: empty.id, pool: 'node', perSkill: 2 } as const;
    expect(await code(generateQuestions(db, llmWith(), cfg, input))).toBe('invalid_question');
    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    expect(await code(generateQuestions(db, llmWith(), cfg, { ...input, nodeId: a.id }))).toBe(
      'version_locked',
    );
    expect(
      await code(
        planGeneration(
          db,
          author,
          a.id,
          { pool: 'node' },
          { nodeMinPerSkill: 4, examMinPerSkill: 3 },
        ),
      ),
    ).toBe('version_locked');
  });
});

describe('frozen versions during a slow call (D-06)', () => {
  it('a generation that finishes after the version was published writes nothing', async () => {
    const { a, versionId } = await setup();
    const publishMidCall: LLMProvider = {
      model: 'slow',
      async complete() {
        await db
          .update(courseVersions)
          .set({ status: 'published' })
          .where(eq(courseVersions.id, versionId));
        return {
          output: {
            questions: [{ kind: 'short', skillId: a.skillIds[0], promptMd: 'Q', accepted: ['x'] }],
          },
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
        };
      },
    };
    const input = { nodeId: a.id, pool: 'node', perSkill: 1 } as const;
    expect(await code(generateQuestions(db, llmWith(publishMidCall), cfg, input))).toBe(
      'version_locked',
    );
    expect(await db.select().from(questions).where(eq(questions.nodeId, a.id))).toHaveLength(0);
  });

  it('a retired question cannot be edited back to life, and a copy leaves pending questions behind', async () => {
    const { author, versionId, a } = await setup();
    const llm = llmWith();
    const ok = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['Функція print виводить текст на екран.', 'Неправда.'], 0),
      cfg,
    );
    await validateQuestion(db, llm, ok.id);
    const pending = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['а', 'б'], 0, 'Ще одне?'),
      cfg,
    );
    const old = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['в', 'г'], 0, 'Старе?'),
      cfg,
    );
    await db.update(questions).set({ status: 'retired' }).where(eq(questions.id, old.id));
    expect(
      await code(updateQuestion(db, author, old.id, mcqBody(a.skillIds[0]!, ['в', 'г'], 1))),
    ).toBe('invalid_question');

    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    const next = await createNewVersion(db, author, versionId);
    const graph = await getVersionGraph(db, author, next.versionId);
    const copied = await listNodeQuestions(
      db,
      author,
      graph.nodes.find((x) => x.title === a.title)!.id,
    );
    expect(copied.questions.map((q) => q.status).sort()).toEqual(['retired', 'validated']);
    expect(copied.questions.some((q) => q.promptMd === pending.promptMd)).toBe(false);
  });
});

describe('validator (F3-R3)', () => {
  it('validates good questions and logs both runs on them', async () => {
    const { author, a } = await setup();
    const llm = llmWith();
    const r = await generateQuestions(db, llm, cfg, { nodeId: a.id, pool: 'node', perSkill: 4 });
    for (const id of r.questionIds) {
      const v = await validateQuestion(db, llm, id);
      expect(v.status).toBe('validated');
    }
    const rows = await db.select().from(questions).where(eq(questions.generatorRunId, r.runId));
    expect(rows.every((q) => q.status === 'validated' && q.rejectionReason === null)).toBe(true);
    expect(rows.every((q) => q.generatorRunId === r.runId && q.validatorRunId !== null)).toBe(true);
    expect(rows.some((q) => q.difficulty !== 0.5)).toBe(true);
    const runs = await db.select().from(llmRuns).where(eq(llmRuns.id, rows[0]!.validatorRunId!));
    expect(runs[0]!.purpose).toBe('question_validation');
    // generated mcq questions get guess = 1 / options (F3-R5)
    const mcq = rows.find((q) => q.kind === 'mcq')!;
    expect(mcq.guess).toBe(1 / mcq.options!.length);
    expect(rows.find((q) => q.kind === 'short')!.guess).toBe(0.1);
    expect(rows.find((q) => q.kind === 'open')!.guess).toBe(0.05);
    void author;
  });

  const fixtures = [
    {
      name: 'mcq with a wrong key',
      body: (s: string) =>
        mcqBody(s, ['Функція print читає файл.', 'Функція print виводить текст на екран.'], 0),
      reason: /wrong/,
    },
    {
      name: 'mcq where two options are right',
      body: (s: string) =>
        mcqBody(
          s,
          ['Індексація списку починається з нуля.', 'Змінна зберігає значення під іменем.'],
          0,
        ),
      reason: /ambiguous|More than one/,
    },
    {
      name: 'short answer that the theory does not contain',
      body: (s: string) => ({
        pool: 'node',
        kind: 'short',
        skillId: s,
        promptMd: 'Яка функція читає файл?',
        accepted: ['open'],
      }),
      reason: /wrong/,
    },
    {
      name: 'open question with an invented reference',
      body: (s: string) => ({
        pool: 'node',
        kind: 'open',
        skillId: s,
        promptMd: 'Що таке цикл?',
        reference: 'Цикл — це спосіб зберігати файли на диску.',
        rubric: 'Згадати файли',
      }),
      reason: /wrong/,
    },
  ];

  it.each(fixtures)('rejects $name, with the reason and the run', async ({ body, reason }) => {
    const { author, a } = await setup();
    const llm = llmWith();
    const q = await createQuestion(db, author, a.id, body(a.skillIds[0]!), cfg);
    expect(q.status).toBe('generated');
    const v = await validateQuestion(db, llm, q.id);
    expect(v.status).toBe('rejected');
    const [row] = await db.select().from(questions).where(eq(questions.id, q.id));
    expect(row!.status).toBe('rejected');
    expect(row!.rejectionReason).toMatch(reason);
    expect(row!.validatorRunId).toBe((v as { runId: string }).runId);
  });

  it('accepts the same kinds of question when the key is right', async () => {
    const { author, a } = await setup();
    const llm = llmWith();
    const good = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(
        a.skillIds[0]!,
        ['Функція print читає файл.', 'Функція print виводить текст на екран.'],
        1,
      ),
      cfg,
    );
    expect((await validateQuestion(db, llm, good.id)).status).toBe('validated');
  });

  it('does nothing for a question that is not waiting, and a rejected verdict can be overridden by the author', async () => {
    const { author, a } = await setup();
    const llm = llmWith();
    const q = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['Це неправда.', 'Інша неправда.'], 0),
      cfg,
    );
    await validateQuestion(db, llm, q.id);
    expect(await validateQuestion(db, llm, q.id)).toEqual({
      status: 'skipped',
      reason: 'not_pending',
    });
    expect(await validateQuestion(db, llm, '00000000-0000-4000-8000-000000000000')).toEqual({
      status: 'skipped',
      reason: 'not_found',
    });
    const approved = await decideQuestion(db, author, q.id, { decision: 'approve' });
    expect(approved).toMatchObject({ status: 'validated', rejectionReason: null });
    expect(await code(decideQuestion(db, author, q.id, { decision: 'approve' }))).toBe(
      'invalid_question',
    );
    const rejected = await decideQuestion(db, author, q.id, {
      decision: 'reject',
      reason: 'застаріло',
    });
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'застаріло' });
  });

  it('an edit while the validator is running wins: the stale verdict is dropped', async () => {
    const { author, a } = await setup();
    const q = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['Функція print виводить текст на екран.', 'Неправда.'], 0),
      cfg,
    );
    const slowEdit: LLMProvider = {
      model: 'slow-edit',
      async complete() {
        // the author fixes the question while the validator is still thinking
        await updateQuestion(
          db,
          author,
          q.id,
          mcqBody(a.skillIds[0]!, ['Неправда.', 'Також неправда.'], 0),
        );
        return {
          output: {
            keyCorrect: true,
            unambiguous: true,
            matchesSkill: true,
            difficulty: 0.3,
            reason: 'ok',
          },
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
        };
      },
    };
    const v = await validateQuestion(db, llmWith(slowEdit), q.id);
    expect(v).toEqual({ status: 'skipped', reason: 'edited' });
    const [row] = await db.select().from(questions).where(eq(questions.id, q.id));
    expect(row).toMatchObject({ status: 'generated', revision: 1, validatorRunId: null });
  });
});

describe('manual questions (F3-R4)', () => {
  it('start as generated, are edited back to generated, and keep the pool and kind', async () => {
    const { author, a } = await setup();
    const llm = llmWith();
    const q = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['Функція print виводить текст на екран.', 'Неправда.'], 0),
      cfg,
    );
    expect(q).toMatchObject({
      createdBy: author.id,
      generatorRunId: null,
      pool: 'node',
      guess: 0.5,
    });
    await validateQuestion(db, llm, q.id);
    const edited = await updateQuestion(
      db,
      author,
      q.id,
      mcqBody(a.skillIds[0]!, ['а', 'б', 'в', 'г'], 1),
    );
    expect(edited).toMatchObject({
      status: 'generated',
      revision: 1,
      validatorRunId: null,
      guess: 0.25,
      pool: 'node',
    });
    expect(
      await code(
        updateQuestion(db, author, q.id, {
          kind: 'short',
          skillId: a.skillIds[0],
          promptMd: 'Q',
          accepted: ['x'],
        }),
      ),
    ).toBe('invalid_question');
  });

  it('refuses a skill that is not on the node, bad input and strangers', async () => {
    const { author, a, b } = await setup();
    const foreign = b.skillIds.find((s) => !a.skillIds.includes(s))!;
    expect(await code(createQuestion(db, author, a.id, mcqBody(foreign, ['а', 'б'], 0), cfg))).toBe(
      'invalid_question',
    );
    expect(
      await code(createQuestion(db, author, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 3), cfg)),
    ).toBe('invalid_question');
    expect(await code(createQuestion(db, author, a.id, { pool: 'node', kind: 'x' }, cfg))).toBe(
      'invalid_question',
    );
    const other = await makeUser(['author']);
    // a draft of another author does not exist for them
    expect(
      await code(createQuestion(db, other, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0), cfg)),
    ).toBe('course_not_found');
    expect(
      await code(createQuestion(db, null, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0), cfg)),
    ).toBe('unauthenticated');
  });
});

describe('access and immutability', () => {
  it('students cannot read questions; the author and an expert can', async () => {
    const { author, versionId, a } = await setup();
    await createQuestion(db, author, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0), cfg);
    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    const student = await makeUser(['student']);
    const expert = await makeUser(['expert']);
    expect(await code(listNodeQuestions(db, student, a.id))).toBe('forbidden');
    expect((await listNodeQuestions(db, expert, a.id)).questions).toHaveLength(1);
    const own = await listNodeQuestions(db, author, a.id);
    expect(own.questions[0]!.answerKey).toEqual({ optionIndex: 0 });
    expect(own.canEdit).toBe(false); // published
    // an expert can read but not change
    expect(
      await code(createQuestion(db, expert, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0), cfg)),
    ).toBe('forbidden');
  });

  it('a student-facing DTO built from real rows leaks nothing', async () => {
    const { author, a } = await setup();
    const llm = llmWith();
    const r = await generateQuestions(db, llm, cfg, { nodeId: a.id, pool: 'node', perSkill: 4 });
    const rows = await db.select().from(questions).where(eq(questions.generatorRunId, r.runId));
    expect(rows.length).toBeGreaterThan(0);
    for (const q of rows) {
      const json = JSON.stringify(toStudentQuestion(q));
      expect(json).not.toMatch(/answerKey|rubric|optionIndex|accepted|reference/);
      if (q.rubric) expect(json).not.toContain(q.rubric);
      for (const key of Object.values(q.answerKey as Record<string, unknown>)) {
        if (typeof key === 'string') expect(json).not.toContain(key);
      }
    }
    void author;
  });

  it('a published version cannot change; a new version copies its questions', async () => {
    const { author, versionId, a } = await setup();
    const llm = llmWith();
    const r = await generateQuestions(db, llm, cfg, { nodeId: a.id, pool: 'exam', perSkill: 3 });
    for (const id of r.questionIds) await validateQuestion(db, llm, id);
    const before = await listNodeQuestions(db, author, a.id);
    const first = before.questions.find((q) => q.kind === 'mcq')!;

    await db
      .update(courseVersions)
      .set({ status: 'published' })
      .where(eq(courseVersions.id, versionId));
    expect(
      await code(createQuestion(db, author, a.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0), cfg)),
    ).toBe('version_locked');
    expect(
      await code(updateQuestion(db, author, first.id, mcqBody(a.skillIds[0]!, ['а', 'б'], 0))),
    ).toBe('version_locked');
    expect(await code(decideQuestion(db, author, first.id, { decision: 'reject' }))).toBe(
      'version_locked',
    );
    // and the validator leaves it alone
    await db.update(questions).set({ status: 'generated' }).where(eq(questions.id, first.id));
    expect(await validateQuestion(db, llm, first.id)).toEqual({
      status: 'skipped',
      reason: 'version_locked',
    });

    const next = await createNewVersion(db, author, versionId);
    const graph = await getVersionGraph(db, author, next.versionId);
    const copyNode = graph.nodes.find((x) => x.title === a.title)!;
    const copied = await listNodeQuestions(db, author, copyNode.id);
    // `first` was put back to `generated` above, and pending questions are not copied
    const kept = before.questions.filter((q) => q.id !== first.id);
    expect(copied.questions).toHaveLength(kept.length);
    expect(copied.questions.every((q) => !before.questions.some((o) => o.id === q.id))).toBe(true);
    expect(
      copied.questions.every((q) => q.pool === 'exam' && copyNode.skillIds.includes(q.skillId)),
    ).toBe(true);
    expect(copied.questions.map((q) => q.promptMd).sort()).toEqual(
      kept.map((q) => q.promptMd).sort(),
    );
    expect(copied.canEdit).toBe(true);
  });
});

describe('pools (D-17, F3-R6)', () => {
  it('rejects using a question outside its pool', async () => {
    const { author, a } = await setup();
    const examQ = await createQuestion(
      db,
      author,
      a.id,
      { ...mcqBody(a.skillIds[0]!, ['а', 'б'], 0), pool: 'exam' },
      cfg,
    );
    const nodeQ = await createQuestion(
      db,
      author,
      a.id,
      mcqBody(a.skillIds[0]!, ['а', 'б'], 0),
      cfg,
    );
    const assessmentQ = await createQuestion(
      db,
      author,
      a.id,
      { ...mcqBody(a.skillIds[0]!, ['а', 'б'], 0), pool: 'assessment' },
      cfg,
    );

    await expect(assertQuestionsInPool(db, [nodeQ.id], 'node')).resolves.toBeUndefined();
    expect(await code(assertQuestionsInPool(db, [nodeQ.id, examQ.id], 'node'))).toBe('wrong_pool');
    expect(await code(assertQuestionsInPool(db, [assessmentQ.id], 'node'))).toBe('wrong_pool');
    expect(await code(assertQuestionsInPool(db, [nodeQ.id], 'exam'))).toBe('wrong_pool');
    expect(
      await code(assertQuestionsInPool(db, ['00000000-0000-4000-8000-000000000000'], 'node')),
    ).toBe('question_not_found');
    try {
      await assertQuestionsInPool(db, [examQ.id], 'node');
    } catch (err) {
      expect((err as CourseError).issues[0]!.message).toContain(examQ.id);
    }
    // the pool cannot be changed by an edit either
    const edited = await updateQuestion(
      db,
      author,
      examQ.id,
      mcqBody(a.skillIds[0]!, ['в', 'г'], 0),
    );
    expect(edited.pool).toBe('exam');
  });

  it('reports exactly which validated questions are missing', async () => {
    const { author, versionId, a } = await setup();
    const llm = llmWith();
    const [s1, s2] = a.skillIds as [string, string];
    const add = async (skill: string, pool: 'node' | 'exam', i: number, validated = true) => {
      const q = await createQuestion(
        db,
        author,
        a.id,
        {
          pool,
          kind: 'short',
          skillId: skill,
          promptMd: `Питання ${pool}-${skill}-${i}`,
          accepted: ['print'],
        },
        cfg,
      );
      if (validated) await validateQuestion(db, llm, q.id);
      return q;
    };
    for (let i = 0; i < 4; i++) await add(s1, 'node', i); // skill 1 is full
    for (let i = 0; i < 2; i++) await add(s2, 'node', i); // skill 2 has 2 of 4
    await add(s2, 'node', 9, false); // not validated: does not count
    const rejected = await add(s2, 'node', 8);
    await decideQuestion(db, author, rejected.id, { decision: 'reject' }); // rejected: does not count
    for (let i = 0; i < 3; i++) await add(s1, 'exam', i); // exam: skill 1 has 3 of 3
    await add(s2, 'exam', 0); // exam: skill 2 has 1 of 3

    const issues = await poolIssues(db, versionId, { nodeMinPerSkill: 4, examMinPerSkill: 3 });
    const mine = issues.filter((i) => i.nodeIds?.includes(a.id) || i.pool === 'exam');
    const nodePool = mine.find((i) => i.pool === 'node' && i.nodeIds?.includes(a.id));
    expect(nodePool).toMatchObject({ code: 'pool_too_small', skillId: s2, have: 2, need: 4 });
    expect(nodePool!.message).toMatch(/2 of 4 .*\(2 missing\)/);
    // node `a` has no other shortage, so skill 1 is not reported for it
    expect(issues.filter((i) => i.pool === 'node' && i.nodeIds?.includes(a.id))).toHaveLength(1);
    const exam = issues.find((i) => i.pool === 'exam' && i.skillId === s2);
    expect(exam).toMatchObject({ have: 1, need: 3 });
    expect(exam!.message).toMatch(/1 of 3 .*\(2 missing\)/);
    expect(issues.some((i) => i.pool === 'exam' && i.skillId === s1)).toBe(false);
    // every other node of the course is short of everything
    const other = issues.filter((i) => i.pool === 'node' && !i.nodeIds?.includes(a.id));
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((i) => i.have === 0 && i.need === 4)).toBe(true);
  });
});
