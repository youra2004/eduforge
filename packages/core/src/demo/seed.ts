import { readFileSync } from 'node:fs';
import {
  assessmentItems,
  assessments,
  contentItems,
  courseVersions,
  enrollments,
  masteryHistory,
  nodeEdges,
  nodeProgress,
  nodeSkills,
  nodes,
  questions,
  skillMastery,
  skills,
  userRoles,
  users,
  type Db,
  type NodeState,
} from '@eduforge/db';
import { eq, inArray } from 'drizzle-orm';
import { hashPassword } from '../auth/password';
import { loadConfig } from '../config';
import { importCourse, type Tx } from '../courses/service';
import { bktUpdate, passesNode } from '../learning/bkt';

const DAY_MS = 24 * 60 * 60 * 1000;
const QUESTIONS_PER_SKILL = 4;
const ITEMS_PER_SKILL = 3;
const courseFile = new URL('../../seed/demo-course.json', import.meta.url);

/** One demo student: their enrollment and the node tests they took (days ago, how many of 3 questions per skill were right). */
interface Persona {
  key: string;
  name: string;
  enrolledDaysAgo: number;
  tests: { node: string; daysAgo: number; correctPerSkill: number }[];
}

// Each persona exercises one branch of the recommendation job (F7).
const personas: Persona[] = [
  {
    key: 'olena',
    name: 'Олена Коваль',
    enrolledDaysAgo: 20,
    tests: [
      { node: 'start', daysAgo: 12, correctPerSkill: 2 },
      { node: 'start', daysAgo: 9, correctPerSkill: 3 },
      { node: 'types', daysAgo: 5, correctPerSkill: 3 },
      { node: 'conditions', daysAgo: 2, correctPerSkill: 3 },
    ],
  },
  {
    key: 'taras',
    name: 'Тарас Мельник',
    enrolledDaysAgo: 25,
    tests: [
      { node: 'start', daysAgo: 10, correctPerSkill: 1 },
      { node: 'start', daysAgo: 8, correctPerSkill: 1 },
      { node: 'start', daysAgo: 3, correctPerSkill: 3 },
      { node: 'types', daysAgo: 2, correctPerSkill: 0 },
      { node: 'types', daysAgo: 1, correctPerSkill: 1 },
    ],
  },
  {
    key: 'iryna',
    name: 'Ірина Шевченко',
    enrolledDaysAgo: 20,
    tests: [{ node: 'start', daysAgo: 14, correctPerSkill: 3 }],
  },
  { key: 'maksym', name: 'Максим Бондар', enrolledDaysAgo: 1, tests: [] },
];

export interface DemoSeedResult {
  created: boolean;
  adminEmail: string;
  studentEmails: string[];
  versionId?: string;
}

/**
 * NFR-6: a demo environment from a clean database: one published course, four students with different
 * histories and an admin. Everything is marked as demonstration data: `users.is_demo`, "(демо)" in the names,
 * "[ДЕМО]" in the course title. `suffix` makes the emails and the slug unique (tests, repeated runs).
 */
export async function seedDemo(
  database: Db,
  opts: { password: string; suffix?: string; now?: Date },
): Promise<DemoSeedResult> {
  const suffix = opts.suffix ?? '';
  const now = opts.now ?? new Date();
  const email = (key: string) => `demo-${key}${suffix}@demo.eduforge.local`;
  const adminEmail = email('admin');
  const studentEmails = personas.map((p) => email(p.key));

  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail));
  if (existing) return { created: false, adminEmail, studentEmails };
  // All or nothing: a failure half way must not leave an admin that makes the next run say "already seeded".
  return database.transaction((tx) =>
    seedAll(tx, { password: opts.password, suffix, now }, adminEmail, studentEmails),
  );
}

async function seedAll(
  db: Tx,
  opts: { password: string; suffix: string; now: Date },
  adminEmail: string,
  studentEmails: string[],
): Promise<DemoSeedResult> {
  const { suffix, now } = opts;
  const email = (key: string) => `demo-${key}${suffix}@demo.eduforge.local`;

  const config = loadConfig();
  const { pInit, learn, slip } = config.bkt;
  const threshold = config.node.passThreshold;
  const passwordHash = await hashPassword(opts.password);
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const insertUser = async (displayName: string, mail: string, role: 'admin' | 'student') => {
    const [u] = await db
      .insert(users)
      .values({
        email: mail,
        passwordHash,
        displayName: `${displayName} (демо)`,
        isDemo: true,
        createdAt: ago(30),
      })
      .returning({ id: users.id });
    await db.insert(userRoles).values({ userId: u!.id, role });
    return u!.id;
  };

  const adminId = await insertUser('Демо-адміністратор', adminEmail, 'admin');
  const course = JSON.parse(readFileSync(courseFile, 'utf8')) as {
    slug: string;
    title: string;
    nodes: { key: string; title: string; summary: string; skills: string[] }[];
  };
  const { versionId } = await importCourse(
    db,
    { ...course, slug: `${course.slug}-demo${suffix}`, title: `[ДЕМО] ${course.title}` },
    adminId,
  );
  await db
    .update(courseVersions)
    .set({ status: 'published', rating: 3, publishedAt: ago(30) })
    .where(eq(courseVersions.id, versionId));

  const nodeRows = await db.select().from(nodes).where(eq(nodes.courseVersionId, versionId));
  const nodeIds = new Map(nodeRows.map((n) => [n.title, n.id]));
  const nodeIdOf = (key: string) => nodeIds.get(course.nodes.find((n) => n.key === key)!.title)!;
  const nodeSkillRows = await db
    .select({ nodeId: nodeSkills.nodeId, skillId: nodeSkills.skillId })
    .from(nodeSkills)
    .where(inArray(nodeSkills.nodeId, [...nodeIds.values()]));
  const skillRows = await db.select().from(skills).where(eq(skills.courseVersionId, versionId));
  const skillName = new Map(skillRows.map((s) => [s.id, s.name]));
  const edges = await db
    .select()
    .from(nodeEdges)
    .where(inArray(nodeEdges.nodeId, [...nodeIds.values()]));

  // The material and the question pools are placeholders, labelled as such.
  await db.insert(contentItems).values(
    course.nodes.map((n) => ({
      nodeId: nodeIdOf(n.key),
      kind: 'markdown' as const,
      title: n.title,
      bodyMd: `${n.summary}\n\n*Демонстраційний матеріал.*`,
    })),
  );
  const questionRows = nodeSkillRows.flatMap((ns) =>
    (['node', 'exam'] as const).flatMap((pool) =>
      Array.from({ length: QUESTIONS_PER_SKILL }, (_, i) => ({
        nodeId: ns.nodeId,
        skillId: ns.skillId,
        pool,
        kind: 'mcq' as const,
        promptMd: `Демо-питання про «${skillName.get(ns.skillId)}» №${i + 1}`,
        options: ['Невірна відповідь', 'Правильна відповідь', 'Ще одна невірна', 'І ця невірна'],
        answerKey: { optionIndex: 1 },
        guess: 0.25,
        status: 'validated' as const,
      })),
    ),
  );
  const questionIds = await db.insert(questions).values(questionRows).returning({
    id: questions.id,
    nodeId: questions.nodeId,
    skillId: questions.skillId,
    pool: questions.pool,
  });

  for (const persona of personas) {
    const userId = await insertUser(persona.name, email(persona.key), 'student');
    await db.insert(enrollments).values({
      userId,
      courseVersionId: versionId,
      startedAt: ago(persona.enrolledDaysAgo),
    });
    const pKnown = new Map<string, number>();
    const nObs = new Map<string, number>();
    const passed = new Set<string>();
    const attemptsOnNode = new Map<string, number>();

    for (const test of persona.tests) {
      const nodeId = nodeIdOf(test.node);
      const nodeSkillIds = nodeSkillRows.filter((r) => r.nodeId === nodeId).map((r) => r.skillId);
      const attemptNo = (attemptsOnNode.get(nodeId) ?? 0) + 1;
      attemptsOnNode.set(nodeId, attemptNo);
      const startedAt = ago(test.daysAgo);
      const [assessment] = await db
        .insert(assessments)
        .values({
          userId,
          kind: 'node_test',
          courseVersionId: versionId,
          nodeId,
          attemptNo,
          status: 'submitted',
          startedAt,
          submittedAt: startedAt,
          questionSetSeed: 1,
        })
        .returning({ id: assessments.id });
      let ord = 0;
      for (const skillId of nodeSkillIds) {
        const pool = questionIds.filter(
          (q) => q.nodeId === nodeId && q.skillId === skillId && q.pool === 'node',
        );
        for (let i = 0; i < ITEMS_PER_SKILL; i++) {
          const correct = i < test.correctPerSkill;
          const [item] = await db
            .insert(assessmentItems)
            .values({
              assessmentId: assessment!.id,
              questionId: pool[i]!.id,
              ord: ord++,
              shownAt: startedAt,
              answeredAt: startedAt,
              answer: { optionIndex: correct ? 1 : 0 },
              isCorrect: correct,
              score: correct ? 1 : 0,
              gradedBy: 'auto',
            })
            .returning({ id: assessmentItems.id });
          const before = pKnown.get(skillId) ?? pInit;
          const after = bktUpdate({ p: before, correct, guess: 0.25, slip, learn });
          pKnown.set(skillId, after);
          nObs.set(skillId, (nObs.get(skillId) ?? 0) + 1);
          await db.insert(masteryHistory).values({
            userId,
            skillId,
            assessmentItemId: item!.id,
            pBefore: before,
            pAfter: after,
            at: startedAt,
          });
        }
      }
      const ps = nodeSkillIds.map((s) => pKnown.get(s)!);
      const ok = passesNode(ps, threshold);
      if (ok) passed.add(nodeId);
      await db
        .update(assessments)
        .set({
          status: ok ? 'passed' : 'failed',
          scorePct: (test.correctPerSkill / ITEMS_PER_SKILL) * 100,
          perSkill: nodeSkillIds.map((s) => ({
            skillId: s,
            name: skillName.get(s)!,
            pKnown: pKnown.get(s)!,
          })),
        })
        .where(eq(assessments.id, assessment!.id));
    }

    for (const [skillId, p] of pKnown) {
      await db.insert(skillMastery).values({
        userId,
        skillId,
        pKnown: p,
        nObs: nObs.get(skillId)!,
        updatedAt: ago(persona.tests.at(-1)?.daysAgo ?? 0),
      });
    }
    await db.insert(nodeProgress).values(
      [...nodeIds.values()].map((nodeId) => {
        const prereqs = edges.filter((e) => e.nodeId === nodeId).map((e) => e.prereqNodeId);
        const state: NodeState = passed.has(nodeId)
          ? 'passed'
          : prereqs.every((p) => passed.has(p))
            ? 'available'
            : 'locked';
        return {
          userId,
          nodeId,
          state,
          attemptsInRound: 0,
          passedAt: state === 'passed' ? ago(1) : null,
        };
      }),
    );
  }
  return { created: true, adminEmail, studentEmails, versionId };
}
