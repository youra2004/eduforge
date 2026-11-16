import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
