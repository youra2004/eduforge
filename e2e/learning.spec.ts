import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));
const proof = '.local-agent/proof/m05';
mkdirSync(proof, { recursive: true });

/** Stands in for M08 (publication) and the question generator: publishes the version and fills the pools. */
async function publishWithQuestions(versionId: string) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("UPDATE course_versions SET status = 'published' WHERE id = $1", [versionId]);
    await db.query(
      `INSERT INTO questions (node_id, skill_id, pool, kind, prompt_md, options, answer_key, guess, status)
       SELECT ns.node_id, ns.skill_id, 'node', 'mcq',
              'Питання ' || s.name || ' №' || g.i,
              '["Невірна відповідь", "Правильна відповідь", "Ще одна невірна", "І ця невірна"]'::jsonb,
              '{"optionIndex": 1}'::jsonb, 0.25, 'validated'
       FROM node_skills ns
       JOIN skills s ON s.id = ns.skill_id
       JOIN nodes n ON n.id = ns.node_id AND n.course_version_id = $1
       CROSS JOIN generate_series(1, 4) AS g(i)`,
      [versionId],
    );
  } finally {
    await db.end();
  }
}

async function dbValue<T>(sql: string, params: unknown[]): Promise<T> {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows[0] as T;
  } finally {
    await db.end();
  }
}

async function takeTest(page: Page, right: boolean) {
  await page.getByTestId('start-test').click();
  await expect(page.getByTestId('test-runner')).toBeVisible();
  for (let i = 1; i <= 6; i++) {
    await expect(page.getByTestId('progress')).toContainText(`Питання ${i} з 6`);
    if (i === 1) await page.screenshot({ path: `${proof}/3-test-question.png` });
    await page
      .getByLabel(right ? 'Правильна відповідь' : 'Невірна відповідь', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Відповісти' }).click();
  }
  await expect(page.getByTestId('test-result')).toBeVisible();
}

test('a student passes a node, unlocks the next one, fails a round and meets the pause', async ({
  browser,
}) => {
  test.setTimeout(120_000);
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
    data: { ...demo, slug: `python-${uniq()}` },
  });
  const { versionId } = await imported.json();
  const graph = await (await admin.request.get(`/api/courses/versions/${versionId}`)).json();
  const nodeByTitle = (title: string) =>
    graph.nodes.find((n: { title: string }) => n.title === title);
  const start = nodeByTitle(demo.nodes.find((n: { key: string }) => n.key === 'start').title);
  const types = nodeByTitle(demo.nodes.find((n: { key: string }) => n.key === 'types').title);
  await admin.request.post(`/api/nodes/${start.id}/content`, {
    data: {
      kind: 'markdown',
      title: 'Вивід і змінні',
      bodyMd: 'Функція `print` виводить текст. Змінна зберігає значення.',
    },
  });
  await publishWithQuestions(versionId);

  // the student
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = `student-${uniq()}@e2e.local`;
  const registered = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, displayName: 'Студентка', acceptTerms: true },
  });
  expect(registered.status()).toBe(201);

  await page.goto('/student');
  await expect(page.getByTestId('no-enrollments')).toBeVisible();
  await page.goto(`/courses/${versionId}`);
  await page.getByTestId('enroll').click();
  await expect(page.getByTestId('graph-legend')).toBeVisible();
  const stateOf = (title: string) =>
    page.getByTestId('graph-node').filter({ hasText: title }).getByTestId('graph-node-state');
  await expect(stateOf(start.title)).toHaveText('Доступний');
  await expect(stateOf(types.title)).toHaveText('Заблокований');
  await page.screenshot({ path: `${proof}/1-course-after-enroll.png`, fullPage: true });

  // a locked node is closed on the server, in the page and in the API
  await page.goto(`/courses/${versionId}/nodes/${types.id}`);
  await expect(page.getByTestId('node-closed')).toContainText('ще закритий');
  await page.screenshot({ path: `${proof}/2-locked-node.png` });
  expect((await page.request.get(`/api/nodes/${types.id}/content`)).status()).toBe(403);
  const lockedTest = await page.request.post(`/api/nodes/${types.id}/test`);
  expect(lockedTest.status()).toBe(403);
  expect((await lockedTest.json()).error).toBe('node_locked');

  // practice changes nothing
  await page.goto(`/courses/${versionId}/nodes/${start.id}`);
  await expect(page.getByTestId('content-item')).toBeVisible();
  await page.getByTestId('start-practice').click();
  await page.getByLabel('Правильна відповідь', { exact: true }).check();
  await page.getByRole('button', { name: 'Перевірити' }).click();
  await expect(page.getByTestId('practice-verdict')).toContainText('Вірно');
  await page.screenshot({ path: `${proof}/4-node-practice.png`, fullPage: true });
  const afterPractice = await dbValue<{ n: string }>(
    'SELECT (SELECT count(*) FROM skill_mastery sm JOIN users u ON u.id = sm.user_id WHERE u.email = $1) AS n',
    [email],
  );
  expect(Number(afterPractice.n)).toBe(0);

  // passing the node
  await takeTest(page, true);
  await expect(page.getByTestId('result-verdict')).toHaveText('Вузол пройдено');
  await expect(page.getByTestId('skill-level')).toHaveCount(2);
  await page.screenshot({ path: `${proof}/5-result-passed.png`, fullPage: true });

  await page.goto(`/courses/${versionId}`);
  await expect(stateOf(start.title)).toHaveText('Пройдено');
  await expect(stateOf(types.title)).toHaveText('Доступний');
  await page.screenshot({ path: `${proof}/6-course-next-unlocked.png`, fullPage: true });

  // two failed attempts: remediation after the first, the pause after the second
  await page.goto(`/courses/${versionId}/nodes/${types.id}`);
  await takeTest(page, false);
  await expect(page.getByTestId('result-verdict')).toHaveText('Поки що не пройдено');
  await expect(page.getByTestId('next-step')).toContainText('спроба 2 з 2');
  await page.screenshot({ path: `${proof}/7-result-failed-first.png`, fullPage: true });
  await page.goto(`/courses/${versionId}/nodes/${types.id}`);
  await expect(page.getByTestId('attempt-note')).toContainText('спроба 2 з 2');
  await takeTest(page, false);
  await expect(page.getByTestId('next-step')).toContainText('Обидві спроби раунду використано');
  await page.screenshot({ path: `${proof}/8-result-cooldown.png`, fullPage: true });

  await page.goto(`/courses/${versionId}/nodes/${types.id}`);
  await expect(page.getByTestId('cooldown-note')).toContainText('Пауза');
  await expect(page.getByTestId('start-test')).toHaveCount(0);
  await page.screenshot({ path: `${proof}/9-node-cooldown.png`, fullPage: true });
  const refused = await page.request.post(`/api/nodes/${types.id}/test`);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toBe('node_cooldown');

  await page.goto(`/courses/${versionId}`);
  await expect(stateOf(types.title)).toContainText('Пауза');
  await page.screenshot({ path: `${proof}/10-course-cooldown.png`, fullPage: true });
  await page.goto('/student');
  await expect(page.getByTestId('enrollments')).toContainText('пройдено 1 з 8');
  await page.screenshot({ path: `${proof}/11-student-page.png` });
});
