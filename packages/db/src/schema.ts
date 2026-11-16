import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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
