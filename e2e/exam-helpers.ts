import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

export const PASSWORD = 'correct horse battery';
export const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));

export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A published, rated copy of the demo course with node and exam questions (stands in for the audit and the generator). */
export async function publishedCourse(browser: Browser) {
  const adminEmail = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', adminEmail, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/login');
  await admin.getByLabel('Email').fill(adminEmail);
  await admin.getByLabel('Пароль').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Увійти' }).click();
  await expect(admin.getByText(/Вітаємо/)).toBeVisible();
  const imported = await admin.request.post('/api/admin/courses/import', {
    data: { ...demo, slug: `exam-${uniq()}` },
  });
  const { versionId } = (await imported.json()) as { versionId: string };
  await sql("UPDATE course_versions SET status = 'published', rating = 2 WHERE id = $1", [
    versionId,
  ]);
  for (const pool of ['node', 'exam']) {
    await sql(
      `INSERT INTO questions (node_id, skill_id, pool, kind, prompt_md, options, answer_key, guess, status)
       SELECT ns.node_id, ns.skill_id, $2, 'mcq',
              'Питання ' || s.name || ' №' || g.i,
              '["Невірна відповідь", "Правильна відповідь", "Ще одна невірна", "І ця невірна"]'::jsonb,
              '{"optionIndex": 1}'::jsonb, 0.25, 'validated'
       FROM node_skills ns
       JOIN skills s ON s.id = ns.skill_id
       JOIN nodes n ON n.id = ns.node_id AND n.course_version_id = $1
       CROSS JOIN generate_series(1, 4) AS g(i)`,
      [versionId, pool],
    );
  }
  const nodeRow = await sql<{ id: string }>('SELECT id FROM nodes WHERE course_version_id = $1', [
    versionId,
  ]);
  return { versionId, nodeId: nodeRow[0]!.id, admin };
}

/** A student who joined the course and has passed every node (the learning part has its own tests). */
export async function studentWhoFinished(browser: Browser, versionId: string) {
  const page = await (await browser.newContext()).newPage();
  const email = `student-${uniq()}@e2e.local`;
  const registered = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, displayName: 'Студентка', acceptTerms: true },
  });
  expect(registered.status()).toBe(201);
  await page.goto(`/courses/${versionId}`);
  await page.getByTestId('enroll').click();
  await expect(page.getByTestId('graph-legend')).toBeVisible();
  await sql(
    `UPDATE node_progress SET state = 'passed', passed_at = now()
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );
  await sql(
    `UPDATE enrollments SET status = 'completed', completed_at = now()
     WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );
  return { page, email };
}

/** The camera gate before the first question: the fake camera, fullscreen and the reference photo (M10). */
export async function passGate(page: Page) {
  await page.getByTestId('proctor-begin').click();
  await expect(page.getByTestId('proctor-active')).toBeVisible();
}

export async function answerAll(page: Page, rightCount: number, total = 20) {
  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('exam-progress')).toContainText(`Питання ${i} з ${total}`);
    await page
      .getByLabel(i <= rightCount ? 'Правильна відповідь' : 'Невірна відповідь', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Відповісти й далі' }).click();
  }
}
