import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from './migrate';

const url = process.env.TEST_DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url });
afterAll(() => pool.end());

async function exists(sql: string) {
  const res = await pool.query<{ found: boolean }>(`SELECT (${sql}) AS found`);
  return res.rows[0]?.found;
}
const hasVector = () => exists("EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')");
const hasLlmRuns = () => exists("to_regclass('public.llm_runs') IS NOT NULL");
const hasUsers = () => exists("to_regclass('public.users') IS NOT NULL");
const hasCourses = () => exists("to_regclass('public.course_versions') IS NOT NULL");
const hasContent = () => exists("to_regclass('public.content_chunks') IS NOT NULL");
const hasQuestions = () => exists("to_regclass('public.questions') IS NOT NULL");
const hasTutor = () => exists("to_regclass('public.tutor_messages') IS NOT NULL");
const hasExperiment = () => exists("to_regclass('public.experiment_assignments') IS NOT NULL");
const hasAudit = () => exists("to_regclass('public.expert_reviews') IS NOT NULL");
const hasLearning = () => exists("to_regclass('public.skill_mastery') IS NOT NULL");

describe('migrations', () => {
  it('apply to an empty DB: vector extension, llm_runs and users exist', async () => {
    expect(await hasVector()).toBe(true);
    expect(await hasLlmRuns()).toBe(true);
    expect(await hasUsers()).toBe(true);
    expect(await hasCourses()).toBe(true);
    expect(await hasContent()).toBe(true);
    expect(await hasQuestions()).toBe(true);
    expect(await hasLearning()).toBe(true);
    expect(await hasTutor()).toBe(true);
    expect(await hasExperiment()).toBe(true);
    expect(await hasAudit()).toBe(true);
  });

  it('roll back, and apply again', async () => {
    const rolledBack = await migrateDown(url, 10);
    expect(rolledBack).toEqual([
      '0009_audit_publication',
      '0008_experiment',
      '0007_tutor',
      '0006_learning_engine',
      '0005_question_bank',
      '0004_content_embeddings',
      '0003_courses_graph',
      '0002_auth_roles',
      '0001_llm_runs',
      '0000_enable_vector',
    ]);
    expect(await hasAudit()).toBe(false);
    expect(await hasExperiment()).toBe(false);
    expect(await hasTutor()).toBe(false);
    expect(await hasLearning()).toBe(false);
    expect(await hasQuestions()).toBe(false);
    expect(await hasContent()).toBe(false);
    expect(await hasCourses()).toBe(false);
    expect(await hasUsers()).toBe(false);
    expect(await hasLlmRuns()).toBe(false);
    expect(await hasVector()).toBe(false);

    await migrateUp(url);
    expect(await hasAudit()).toBe(true);
    expect(await hasExperiment()).toBe(true);
    expect(await hasTutor()).toBe(true);
    expect(await hasLearning()).toBe(true);
    expect(await hasQuestions()).toBe(true);
    expect(await hasContent()).toBe(true);
    expect(await hasVector()).toBe(true);
    expect(await hasLlmRuns()).toBe(true);
    expect(await hasUsers()).toBe(true);
    expect(await hasCourses()).toBe(true);
  });
});
