import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const llmPurposes = [
  'question_generation',
  'question_validation',
  'audit_conformity',
  'audit_skills',
  'audit_scoring',
  'open_grading',
  'tutor',
  'tutor_guard',
  'recommendation',
  'certificate_summary',
  'vision_check',
  'transcription',
  'embedding',
] as const;

export type LLMPurpose = (typeof llmPurposes)[number];

export const llmPurpose = pgEnum('llm_purpose', llmPurposes);

// Every LLM call is logged here (NFR-3, P3). See DATA_MODEL.md section 12.
export const llmRuns = pgTable(
  'llm_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: llmPurpose('purpose').notNull(),
    model: text('model').notNull(),
    params: jsonb('params').notNull().default({}),
    promptVersion: text('prompt_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    request: jsonb('request').notNull(),
    response: jsonb('response'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd').notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_runs_purpose_created_idx').on(t.purpose, t.createdAt)],
);

export type LLMRun = typeof llmRuns.$inferSelect;
export type NewLLMRun = typeof llmRuns.$inferInsert;

// Users and access (DATA_MODEL.md section 3). One person can hold several roles.
export const roles = ['student', 'author', 'expert', 'admin'] as const;
export type Role = (typeof roles)[number];
export const roleEnum = pgEnum('role', roles);

export const consentKinds = ['proctoring', 'research', 'terms'] as const;
export type ConsentKind = (typeof consentKinds)[number];
export const consentKind = pgEnum('consent_kind', consentKinds);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  examBanUntil: timestamp('exam_ban_until', { withTimezone: true }),
  examBannedForever: boolean('exam_banned_forever').notNull().default(false),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

// Append-only: each row says which version of which text the user accepted, and when.
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: consentKind('kind').notNull(),
    version: text('version').notNull(),
    givenAt: timestamp('given_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('consents_user_kind_idx').on(t.userId, t.kind)],
);

// Server-side sessions (ADR-0004). `id` is the SHA-256 of the cookie token, never the token itself.
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// Failed logins, for rate limiting (NFR-4). `key` is e.g. `email:a@b.c` or `ip:1.2.3.4`.
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_key_created_idx').on(t.key, t.createdAt)],
);

export type User = typeof users.$inferSelect;

// Courses and the knowledge graph (DATA_MODEL.md section 4).
export const versionStatuses = [
  'draft',
  'auditing',
  'changes_requested',
  'ready_to_publish',
  'expert_review',
  'published',
  'archived',
] as const;
export type VersionStatus = (typeof versionStatuses)[number];
export const versionStatus = pgEnum('version_status', versionStatuses);

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// A published version is immutable (D-06); the service layer enforces it.
export const courseVersions = pgTable(
  'course_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id),
    versionNo: integer('version_no').notNull(),
    parentVersionId: uuid('parent_version_id').references((): AnyPgColumn => courseVersions.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    declaredLevel: text('declared_level'),
    status: versionStatus('status').notNull().default('draft'),
    auditAttempts: integer('audit_attempts').notNull().default(0),
    rating: smallint('rating'),
    aiLevel: text('ai_level'),
    aiHardness: real('ai_hardness'),
    volumeCap: smallint('volume_cap'),
    auditSummary: jsonb('audit_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    unique('course_versions_course_version_no_unique').on(t.courseId, t.versionNo),
    check('course_versions_rating_range', sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 1 AND 10`),
  ],
);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    verified: boolean('verified'),
    verificationNote: text('verification_note'),
  },
  (t) => [index('skills_course_version_idx').on(t.courseVersionId)],
);

export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    // Optional {x, y} for the graph view/editor; the view lays nodes out itself when it is null.
    position: jsonb('position').$type<{ x: number; y: number }>(),
  },
  (t) => [index('nodes_course_version_idx').on(t.courseVersionId)],
);

// Prerequisite edges, AND semantics (D-12): `nodeId` opens once every `prereqNodeId` pointing at it is passed.
export const nodeEdges = pgTable(
  'node_edges',
  {
    prereqNodeId: uuid('prereq_node_id')
      .notNull()
      .references(() => nodes.id),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
  },
  (t) => [
    primaryKey({ columns: [t.prereqNodeId, t.nodeId] }),
    check('node_edges_no_self_loop', sql`${t.prereqNodeId} <> ${t.nodeId}`),
    index('node_edges_node_idx').on(t.nodeId),
  ],
);

export const nodeSkills = pgTable(
  'node_skills',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.skillId] }),
    index('node_skills_skill_idx').on(t.skillId),
  ],
);

export type Course = typeof courses.$inferSelect;
export type CourseVersion = typeof courseVersions.$inferSelect;

// Node content and its search index (DATA_MODEL.md section 5, F2).
export const contentKinds = ['markdown', 'video'] as const;
export type ContentKind = (typeof contentKinds)[number];
export const contentKind = pgEnum('content_kind', contentKinds);

export const transcriptSources = ['author', 'whisper'] as const;
export type TranscriptSource = (typeof transcriptSources)[number];
export const transcriptSource = pgEnum('transcript_source', transcriptSources);

/** The vector column size. Changing it needs a migration and a full re-embed (ADR-0006, OQ-2). */
export const EMBEDDING_COLUMN_DIM = 1024;

export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    kind: contentKind('kind').notNull(),
    title: text('title').notNull(),
    ord: integer('ord').notNull().default(0),
    bodyMd: text('body_md'),
    videoUrl: text('video_url'),
    videoStorageKey: text('video_storage_key'),
    transcriptText: text('transcript_text'),
    transcriptSource: transcriptSource('transcript_source'),
    // SHA-256 of the text that the current chunks were built from; null while not indexed.
    indexedHash: text('indexed_hash'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('content_items_node_idx').on(t.nodeId, t.ord),
    check(
      'content_items_kind_fields',
      sql`(${t.kind} = 'markdown' AND ${t.bodyMd} IS NOT NULL) OR (${t.kind} = 'video' AND (${t.videoUrl} IS NOT NULL OR ${t.videoStorageKey} IS NOT NULL))`,
    ),
  ],
);

// `nodeId` is repeated here on purpose: the tutor's search filters on it in SQL (D-15).
export const contentChunks = pgTable(
  'content_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_COLUMN_DIM }).notNull(),
  },
  (t) => [
    unique('content_chunks_item_index_unique').on(t.contentItemId, t.chunkIndex),
    index('content_chunks_node_idx').on(t.nodeId),
    index('content_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export type ContentItem = typeof contentItems.$inferSelect;
export type ContentChunk = typeof contentChunks.$inferSelect;

// Question bank (DATA_MODEL.md section 6, F3). Pools never overlap: a question lives in exactly one (D-17).
export const questionKinds = ['mcq', 'short', 'open'] as const;
export type QuestionKind = (typeof questionKinds)[number];
export const questionKind = pgEnum('question_kind', questionKinds);

export const questionPools = ['node', 'exam', 'assessment'] as const;
export type QuestionPool = (typeof questionPools)[number];
export const questionPool = pgEnum('question_pool', questionPools);

export const questionStatuses = ['generated', 'validated', 'rejected', 'retired'] as const;
export type QuestionStatus = (typeof questionStatuses)[number];
export const questionStatus = pgEnum('question_status', questionStatuses);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    pool: questionPool('pool').notNull(),
    kind: questionKind('kind').notNull(),
    promptMd: text('prompt_md').notNull(),
    options: jsonb('options').$type<string[]>(),
    // mcq: {optionIndex}; short: {accepted: string[]}; open: {reference}. Never shown to students or the tutor (P6).
    answerKey: jsonb('answer_key').notNull(),
    rubric: text('rubric'),
    difficulty: real('difficulty').notNull().default(0.5),
    guess: real('guess').notNull(),
    slip: real('slip').notNull().default(0.1),
    status: questionStatus('status').notNull().default('generated'),
    rejectionReason: text('rejection_reason'),
    // Bumped on every edit, so a validation that started before the edit cannot validate the new text.
    revision: integer('revision').notNull().default(0),
    generatorRunId: uuid('generator_run_id').references(() => llmRuns.id),
    validatorRunId: uuid('validator_run_id').references(() => llmRuns.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('questions_node_pool_idx').on(t.nodeId, t.pool, t.status),
    index('questions_skill_idx').on(t.skillId),
    check('questions_guess_range', sql`${t.guess} BETWEEN 0 AND 1`),
    check('questions_slip_range', sql`${t.slip} BETWEEN 0 AND 1`),
    check('questions_difficulty_range', sql`${t.difficulty} BETWEEN 0 AND 1`),
  ],
);

// The author's fixed hints for the tutor's fallback (F1-R4); the tutor reads them in M06.
export const staticHints = pgTable(
  'static_hints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    level: smallint('level').notNull(),
    text: text('text').notNull(),
  },
  (t) => [index('static_hints_node_idx').on(t.nodeId)],
);

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;

// Learning engine (DATA_MODEL.md section 7, F5). `node_progress` rows are created when a student enrolls.
export const enrollmentStatuses = ['active', 'completed'] as const;
export type EnrollmentStatus = (typeof enrollmentStatuses)[number];

export const enrollments = pgTable(
  'enrollments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    status: text('status').$type<EnrollmentStatus>().notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [unique('enrollments_user_version_unique').on(t.userId, t.courseVersionId)],
);

export const nodeStates = ['locked', 'available', 'in_progress', 'passed', 'cooldown'] as const;
export type NodeState = (typeof nodeStates)[number];
export const nodeState = pgEnum('node_state', nodeStates);

export const nodeProgress = pgTable(
  'node_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    state: nodeState('state').notNull(),
    roundNo: integer('round_no').notNull().default(1),
    attemptsInRound: integer('attempts_in_round').notNull().default(0),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    passedAt: timestamp('passed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nodeId] })],
);

export const skillMastery = pgTable(
  'skill_mastery',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    pKnown: real('p_known').notNull(),
    nObs: integer('n_obs').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skillId] })],
);

export const assessmentKinds = [
  'node_test',
  'exam',
  'pretest',
  'posttest',
  'delayed_posttest',
] as const;
export type AssessmentKind = (typeof assessmentKinds)[number];
export const assessmentKind = pgEnum('assessment_kind', assessmentKinds);

export const assessmentStatuses = [
  'in_progress',
  'submitted',
  'passed',
  'failed',
  'interrupted',
  'annulled',
] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];
export const assessmentStatus = pgEnum('assessment_status', assessmentStatuses);

export interface NodeSkillResult {
  skillId: string;
  name: string;
  pKnown: number;
}
export type ExamSkillLevel = 'perfect' | 'good' | 'needs_work';
export interface ExamSkillResult {
  skillId: string;
  name: string;
  pct: number;
  level: ExamSkillLevel;
}

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: assessmentKind('kind').notNull(),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    nodeId: uuid('node_id').references(() => nodes.id),
    roundNo: integer('round_no').notNull().default(1),
    attemptNo: integer('attempt_no').notNull().default(1),
    status: assessmentStatus('status').notNull().default('in_progress'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    // Node tests have no timer; the exam sets it.
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    scorePct: real('score_pct'),
    // A node test stores the skill's mastery, the exam its share of points and level (F8-R4, F8-R7).
    perSkill: jsonb('per_skill').$type<(NodeSkillResult | ExamSkillResult)[]>(),
    interruptions: integer('interruptions').notNull().default(0),
    riskScore: real('risk_score').notNull().default(0),
    questionSetSeed: bigint('question_set_seed', { mode: 'number' }).notNull(),
    meta: jsonb('meta').notNull().default({}),
  },
  (t) => [
    index('assessments_user_node_idx').on(t.userId, t.nodeId, t.status),
    // One unfinished node test per student and node, so a double click cannot start two.
    uniqueIndex('assessments_node_test_in_progress_unique')
      .on(t.userId, t.nodeId)
      .where(sql`${t.kind} = 'node_test' AND ${t.status} = 'in_progress'`),
  ],
);

export const assessmentItems = pgTable(
  'assessment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    ord: integer('ord').notNull(),
    shownAt: timestamp('shown_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    answer: jsonb('answer'),
    isCorrect: boolean('is_correct'),
    score: real('score'),
    gradedBy: text('graded_by').$type<'auto' | 'llm'>(),
    graderRunId: uuid('grader_run_id').references(() => llmRuns.id),
    timeMs: integer('time_ms'),
    hintsUsed: integer('hints_used').notNull().default(0),
  },
  (t) => [
    unique('assessment_items_assessment_ord_unique').on(t.assessmentId, t.ord),
    index('assessment_items_question_idx').on(t.questionId),
  ],
);

// Append-only: one row per change of p_known (F5-R7, P5).
export const masteryHistory = pgTable(
  'mastery_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id),
    assessmentItemId: uuid('assessment_item_id')
      .notNull()
      .references(() => assessmentItems.id),
    pBefore: real('p_before').notNull(),
    pAfter: real('p_after').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mastery_history_user_skill_idx').on(t.userId, t.skillId, t.at)],
);

// Append-only research log (P5, RESEARCH.md).
export const eventLog = pgTable(
  'event_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id),
    sessionKey: text('session_key'),
    name: text('name').notNull(),
    props: jsonb('props').notNull().default({}),
  },
  (t) => [
    index('event_log_user_ts_idx').on(t.userId, t.ts),
    index('event_log_name_idx').on(t.name),
  ],
);

export type Assessment = typeof assessments.$inferSelect;
export type AssessmentItem = typeof assessmentItems.$inferSelect;
export type NodeProgress = typeof nodeProgress.$inferSelect;

// AI tutor (DATA_MODEL.md section 8, F6). A session is one conversation about a node, optionally about one question.
export const tutorSessions = pgTable(
  'tutor_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id),
    questionId: uuid('question_id').references(() => questions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tutor_sessions_user_idx').on(t.userId, t.createdAt)],
);

export const tutorRoles = ['student', 'tutor'] as const;
export type TutorRole = (typeof tutorRoles)[number];

/** `guardVerdict` and `retrievedChunkIds` are the research log of F6-R8 (P5, H4). */
export const tutorMessages = pgTable(
  'tutor_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => tutorSessions.id),
    role: text('role').$type<TutorRole>().notNull(),
    content: text('content').notNull(),
    hintLevel: smallint('hint_level'),
    guardVerdict: jsonb('guard_verdict'),
    retrievedChunkIds: uuid('retrieved_chunk_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    llmRunId: uuid('llm_run_id').references(() => llmRuns.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tutor_messages_role_check', sql`${t.role} IN ('student', 'tutor')`),
    index('tutor_messages_session_idx').on(t.sessionId, t.createdAt),
  ],
);

export type TutorSession = typeof tutorSessions.$inferSelect;
export type TutorMessage = typeof tutorMessages.$inferSelect;

// Experiment (DATA_MODEL.md section 13, RESEARCH.md). `code` is the pseudonym: it is all the export shows of a person.
export const orderVariants = ['A_then_B', 'B_then_A'] as const;
export type OrderVariant = (typeof orderVariants)[number];
export const experimentModules = ['A', 'B'] as const;
export type ExperimentModule = (typeof experimentModules)[number];
export const experimentConditions = ['method', 'control'] as const;
export type ExperimentCondition = (typeof experimentConditions)[number];

export const experimentParticipants = pgTable(
  'experiment_participants',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id),
    code: text('code').notNull().unique(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),
    orderVariant: text('order_variant').$type<OrderVariant>().notNull(),
  },
  (t) => [
    check(
      'experiment_participants_order_check',
      sql`${t.orderVariant} IN ('A_then_B', 'B_then_A')`,
    ),
  ],
);

export const experimentAssignments = pgTable(
  'experiment_assignments',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => experimentParticipants.userId),
    module: text('module').$type<ExperimentModule>().notNull(),
    condition: text('condition').$type<ExperimentCondition>().notNull(),
    period: smallint('period').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.module] }),
    check('experiment_assignments_module_check', sql`${t.module} IN ('A', 'B')`),
    check('experiment_assignments_condition_check', sql`${t.condition} IN ('method', 'control')`),
    check('experiment_assignments_period_check', sql`${t.period} IN (1, 2)`),
    unique('experiment_assignments_user_period_unique').on(t.userId, t.period),
  ],
);

export type ExperimentParticipant = typeof experimentParticipants.$inferSelect;
export type ExperimentAssignment = typeof experimentAssignments.$inferSelect;

// Audit, expert review and notifications (DATA_MODEL.md section 9, F4).
export const auditStages = ['structure', 'volume', 'conformity', 'skills', 'scoring'] as const;
export type AuditStage = (typeof auditStages)[number];

/** One row per stage of one audit attempt; `result` is the aggregate, the raw N runs live in `llm_runs`. */
export const auditRuns = pgTable(
  'audit_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    attemptNo: integer('attempt_no').notNull(),
    stage: text('stage').$type<AuditStage>().notNull(),
    status: text('status').$type<'passed' | 'failed'>().notNull(),
    result: jsonb('result').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('audit_runs_version_attempt_stage_unique').on(t.courseVersionId, t.attemptNo, t.stage),
    check(
      'audit_runs_stage_check',
      sql`${t.stage} IN ('structure', 'volume', 'conformity', 'skills', 'scoring')`,
    ),
    check('audit_runs_status_check', sql`${t.status} IN ('passed', 'failed')`),
  ],
);

export const reviewStatuses = ['assigned', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export const reviewStatus = pgEnum('review_status', reviewStatuses);

export interface ReviewChecklist {
  items: Record<string, boolean>;
  comment: string;
}

// The simulated expert review of a rating-10 candidate (D-10). An admin assigns it; the expert decides.
export const expertReviews = pgTable(
  'expert_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseVersionId: uuid('course_version_id')
      .notNull()
      .references(() => courseVersions.id),
    expertId: uuid('expert_id')
      .notNull()
      .references(() => users.id),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id),
    status: reviewStatus('status').notNull().default('assigned'),
    checklist: jsonb('checklist').$type<ReviewChecklist>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('expert_reviews_version_idx').on(t.courseVersionId, t.createdAt),
    index('expert_reviews_expert_idx').on(t.expertId, t.status),
    // One open review per version, so a double click cannot assign two experts.
    uniqueIndex('expert_reviews_assigned_unique')
      .on(t.courseVersionId)
      .where(sql`${t.status} = 'assigned'`),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export type AuditRun = typeof auditRuns.$inferSelect;
export type ExpertReview = typeof expertReviews.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
