import {
  assessmentItems,
  assessments,
  courses,
  courseVersions,
  eventLog,
  experimentAssignments,
  experimentParticipants,
  nodes,
  questions,
  tutorMessages,
  tutorSessions,
  type Db,
  type ExperimentCondition,
  type ExperimentModule,
} from '@eduforge/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { loadConfig } from '../config';
import type { GuardVerdict } from '../tutor/service';
import { normalizedGain } from './gain';
import { SURVEY_ITEMS } from './survey';

/** The files of the de-identified export (RESEARCH.md §6): one row per participant×module, answer, event or tutor reply. */
export const EXPORT_TABLES = ['modules', 'answers', 'events', 'tutor'] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

type Cell = string | number | boolean | null;
interface Table {
  columns: string[];
  rows: Cell[][];
}

/** Column names that would identify a person. The export refuses to be built with one (NFR-2). */
export const PII_COLUMN =
  /(^|_)(email|display_name|full_name|first_name|last_name|user_id|password)(_|$)|^name$/i;

export function assertNoPii(columns: string[]) {
  const bad = columns.filter((c) => PII_COLUMN.test(c));
  if (bad.length > 0)
    throw new Error(`The export must not contain personal columns: ${bad.join(', ')}`);
}

function csvCell(v: Cell): string {
  if (v === null) return '';
  let s = String(v);
  // A spreadsheet would run a cell that starts with these as a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(t: Table): string {
  assertNoPii(t.columns);
  return [t.columns, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

interface Study {
  /** user id → pseudonym, order */
  people: Map<string, { code: string; orderVariant: string }>;
  /** `userId:module` → condition and period */
  assignments: Map<string, { condition: ExperimentCondition; period: number }>;
  /** course version id → module */
  moduleOf: Map<string, ExperimentModule>;
}

async function loadStudy(db: Db, config = loadConfig()): Promise<Study> {
  const people = new Map(
    (await db.select().from(experimentParticipants).orderBy(asc(experimentParticipants.code))).map(
      (p) => [p.userId, { code: p.code, orderVariant: p.orderVariant }],
    ),
  );
  const assignments = new Map(
    (await db.select().from(experimentAssignments)).map((a) => [
      `${a.userId}:${a.module}`,
      { condition: a.condition, period: a.period },
    ]),
  );
  const slugs = config.experiment.courseSlugs;
  const moduleOf = new Map<string, ExperimentModule>();
  const versions = await db
    .select({ id: courseVersions.id, slug: courses.slug })
    .from(courseVersions)
    .innerJoin(courses, eq(courses.id, courseVersions.courseId));
  for (const v of versions) {
    if (v.slug === slugs.A) moduleOf.set(v.id, 'A');
    else if (v.slug === slugs.B) moduleOf.set(v.id, 'B');
  }
  return { people, assignments, moduleOf };
}

const share = (pct: number | null | undefined) => (pct == null ? null : pct / 100);

async function modulesTable(db: Db, st: Study, config = loadConfig()): Promise<Table> {
  const ids = [...st.people.keys()];
  const tests = ids.length
    ? await db
        .select()
        .from(assessments)
        .where(inArray(assessments.userId, ids))
        .orderBy(asc(assessments.startedAt))
    : [];
  const events = ids.length
    ? await db.select().from(eventLog).where(inArray(eventLog.userId, ids))
    : [];
  const tutor = ids.length
    ? await db
        .select({ userId: tutorSessions.userId, versionId: nodes.courseVersionId })
        .from(tutorMessages)
        .innerJoin(tutorSessions, eq(tutorSessions.id, tutorMessages.sessionId))
        .innerJoin(nodes, eq(nodes.id, tutorSessions.nodeId))
        .where(and(inArray(tutorSessions.userId, ids), eq(tutorMessages.role, 'student')))
    : [];

  const columns = [
    'participant_code',
    'module',
    'condition',
    'period',
    'order_variant',
    'pretest',
    'posttest',
    'delayed_posttest',
    'gain_post',
    'retention_change',
    'active_seconds',
    'node_test_attempts',
    'node_test_failures',
    'tutor_questions',
    ...SURVEY_ITEMS.map((i) => `survey_${i.key}`),
  ];
  const rows: Cell[][] = [];
  for (const [userId, person] of st.people) {
    for (const module of ['A', 'B'] as const) {
      const a = st.assignments.get(`${userId}:${module}`);
      if (!a) continue;
      const mine = tests.filter(
        (t) => t.userId === userId && st.moduleOf.get(t.courseVersionId) === module,
      );
      const score = (kind: string) =>
        share(mine.filter((t) => t.kind === kind && t.status === 'submitted').at(-1)?.scorePct);
      const pre = score('pretest');
      const post = score('posttest');
      const delayed = score('delayed_posttest');
      const mineEvents = events.filter(
        (e) => e.userId === userId && (e.props as { module?: string }).module === module,
      );
      const survey = mineEvents.filter((e) => e.name === 'survey_submitted').at(-1)?.props as
        { answers?: Record<string, number> } | undefined;
      const nodeTests = mine.filter((t) => t.kind === 'node_test' && t.status !== 'in_progress');
      rows.push([
        person.code,
        module,
        a.condition,
        a.period,
        person.orderVariant,
        pre,
        post,
        delayed,
        pre !== null && post !== null ? normalizedGain(pre, post) : null,
        delayed !== null && post !== null ? delayed - post : null,
        mineEvents.filter((e) => e.name === 'session_heartbeat').length *
          config.experiment.heartbeatSeconds,
        nodeTests.length,
        nodeTests.filter((t) => t.status === 'failed').length,
        tutor.filter((t) => t.userId === userId && st.moduleOf.get(t.versionId) === module).length,
        ...SURVEY_ITEMS.map((i) => survey?.answers?.[i.key] ?? null),
      ]);
    }
  }
  return { columns, rows };
}

async function answersTable(db: Db, st: Study): Promise<Table> {
  const ids = [...st.people.keys()];
  const found = ids.length
    ? await db
        .select({
          userId: assessments.userId,
          versionId: assessments.courseVersionId,
          kind: assessments.kind,
          roundNo: assessments.roundNo,
          attemptNo: assessments.attemptNo,
          ord: assessmentItems.ord,
          questionId: assessmentItems.questionId,
          skillId: questions.skillId,
          isCorrect: assessmentItems.isCorrect,
          timeMs: assessmentItems.timeMs,
        })
        .from(assessmentItems)
        .innerJoin(assessments, eq(assessments.id, assessmentItems.assessmentId))
        .innerJoin(questions, eq(questions.id, assessmentItems.questionId))
        .where(inArray(assessments.userId, ids))
        .orderBy(asc(assessments.startedAt), asc(assessmentItems.ord))
    : [];
  const rows: Cell[][] = [];
  for (const r of found) {
    const module = st.moduleOf.get(r.versionId);
    const a = module && st.assignments.get(`${r.userId}:${module}`);
    if (!module || !a) continue;
    rows.push([
      st.people.get(r.userId)!.code,
      module,
      a.condition,
      r.kind,
      r.roundNo,
      r.attemptNo,
      r.ord,
      r.questionId,
      r.skillId,
      r.isCorrect,
      r.timeMs,
    ]);
  }
  return {
    columns: [
      'participant_code',
      'module',
      'condition',
      'assessment_kind',
      'round_no',
      'attempt_no',
      'ord',
      'question_id',
      'skill_id',
      'is_correct',
      'time_ms',
    ],
    rows,
  };
}

async function eventsTable(db: Db, st: Study): Promise<Table> {
  const ids = [...st.people.keys()];
  const found = ids.length
    ? await db
        .select()
        .from(eventLog)
        .where(inArray(eventLog.userId, ids))
        .orderBy(asc(eventLog.id))
    : [];
  return {
    columns: ['participant_code', 'ts', 'event', 'module', 'condition', 'props'],
    rows: found.map((e) => {
      const { module, condition, ...rest } = e.props as Record<string, unknown>;
      return [
        st.people.get(e.userId!)!.code,
        e.ts.toISOString(),
        e.name,
        (module as string | undefined) ?? null,
        (condition as string | undefined) ?? null,
        JSON.stringify(rest),
      ];
    }),
  };
}

/** One row per tutor reply: the hint level, whether the guard let the draft through, and what was shown (H4). No text. */
async function tutorTable(db: Db, st: Study): Promise<Table> {
  const ids = [...st.people.keys()];
  const found = ids.length
    ? await db
        .select({
          userId: tutorSessions.userId,
          versionId: nodes.courseVersionId,
          hintLevel: tutorMessages.hintLevel,
          verdict: tutorMessages.guardVerdict,
        })
        .from(tutorMessages)
        .innerJoin(tutorSessions, eq(tutorSessions.id, tutorMessages.sessionId))
        .innerJoin(nodes, eq(nodes.id, tutorSessions.nodeId))
        .where(and(inArray(tutorSessions.userId, ids), eq(tutorMessages.role, 'tutor')))
        .orderBy(asc(tutorMessages.createdAt))
    : [];
  const rows: Cell[][] = [];
  for (const r of found) {
    const module = st.moduleOf.get(r.versionId);
    const a = module && st.assignments.get(`${r.userId}:${module}`);
    if (!module || !a) continue;
    const v = r.verdict as GuardVerdict | null;
    rows.push([
      st.people.get(r.userId)!.code,
      module,
      a.condition,
      r.hintLevel,
      v?.source ?? null,
      v?.fallbackReason ?? null,
      v?.attempts[0]?.revealed ?? null,
    ]);
  }
  return {
    columns: [
      'participant_code',
      'module',
      'condition',
      'hint_level',
      'source',
      'fallback_reason',
      'first_draft_revealed',
    ],
    rows,
  };
}

/** The CSV of one export table. Only pseudonyms identify people in it; the column check runs on every build. */
export async function exportCsv(
  db: Db,
  table: ExportTable,
  config = loadConfig(),
): Promise<string> {
  const st = await loadStudy(db, config);
  const build = {
    modules: () => modulesTable(db, st, config),
    answers: () => answersTable(db, st),
    events: () => eventsTable(db, st),
    tutor: () => tutorTable(db, st),
  };
  return toCsv(await build[table]());
}
