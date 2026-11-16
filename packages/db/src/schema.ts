import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
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
