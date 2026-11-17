import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));
const proof = '.local-agent/proof/m06';
mkdirSync(proof, { recursive: true });

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Stands in for M08 (publication) and the question generator, as in learning.spec.ts. */
async function publishWithQuestions(versionId: string) {
  await sql("UPDATE course_versions SET status = 'published' WHERE id = $1", [versionId]);
  await sql(
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
}

async function register(page: Page) {
  const email = `student-${uniq()}@e2e.local`;
  const res = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, displayName: 'Студентка', acceptTerms: true },
  });
  expect(res.status()).toBe(201);
  return email;
}

async function ask(page: Page, text: string) {
  const before = await page.getByTestId('tutor-tutor').count();
  await page.getByTestId('tutor-input').first().fill(text);
  await page.getByTestId('tutor-send').first().click();
  await expect(page.getByTestId('tutor-tutor')).toHaveCount(before + 1);
}

test('the tutor gives hints in the node, in practice and after a failed test, within scope', async ({
  browser,
}) => {
  test.setTimeout(150_000);
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
  const { versionId } = await (
    await admin.request.post('/api/admin/courses/import', {
      data: { ...demo, slug: `python-${uniq()}` },
    })
  ).json();
  const graph = await (await admin.request.get(`/api/courses/versions/${versionId}`)).json();
  const node = (key: string) => {
    const title = demo.nodes.find((n: { key: string }) => n.key === key).title;
    return graph.nodes.find((n: { title: string }) => n.title === title);
  };
  const [start, types, conditions] = [node('start'), node('types'), node('conditions')];
  const content = {
    [start.id]:
      'Функція `print` виводить текст на екран. Функція `input` читає рядок від користувача.',
    [types.id]: 'Змінна зберігає значення. Тип значення визначає, які дії над ним можливі.',
    [conditions.id]: 'Оператор if перевіряє умову. Гілка else виконується, коли умова хибна.',
  };
  for (const [id, bodyMd] of Object.entries(content)) {
    await admin.request.post(`/api/nodes/${id}/content`, {
      data: { kind: 'markdown', title: 'Конспект', bodyMd },
    });
  }
  await publishWithQuestions(versionId);
  // the worker (pnpm --filter @eduforge/worker dev) turns the text into chunks
  await expect
    .poll(
      async () =>
        Number(
          (
            await sql<{ n: string }>(
              'SELECT count(*) AS n FROM content_chunks WHERE node_id = ANY($1)',
              [[start.id, types.id, conditions.id]],
            )
          )[0]!.n,
        ),
      { timeout: 60_000, message: 'run the worker so content gets indexed' },
    )
    .toBe(3);

  const page = await (await browser.newContext()).newPage();
  const email = await register(page);
  await page.goto(`/courses/${versionId}`);
  await page.getByTestId('enroll').click();
  await expect(page.getByTestId('graph-legend')).toBeVisible();
  // start is passed, so `types` is open; `conditions` stays locked
  await sql(
    `UPDATE node_progress SET state = CASE WHEN node_id = $2 THEN 'passed'::node_state ELSE 'available'::node_state END
     WHERE user_id = (SELECT id FROM users WHERE email = $1) AND node_id IN ($2, $3)`,
    [email, start.id, types.id],
  );

  // 1. chat in the node: the ladder climbs
  await page.goto(`/courses/${versionId}/nodes/${types.id}`);
  await expect(page.getByTestId('tutor-chat').first()).toBeVisible();
  await ask(page, 'Не розумію, що таке змінна.');
  await expect(page.getByTestId('hint-level').first()).toContainText('підказка 1 з 3');
  await ask(page, 'Все ще не зрозуміло.');
  await expect(page.getByTestId('hint-level').nth(1)).toContainText('підказка 2 з 3');
  await page.getByTestId('tutor-chat').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${proof}/1-node-chat.png`, fullPage: true });

  // what was logged: level, guard verdict, chunks of allowed nodes only, llm run
  const logged = await sql<{
    hint_level: number;
    guard_verdict: { source: string; attempts: { revealed: boolean }[] };
    retrieved_chunk_ids: string[];
    llm_run_id: string;
  }>(
    `SELECT m.* FROM tutor_messages m JOIN tutor_sessions s ON s.id = m.session_id
     JOIN users u ON u.id = s.user_id WHERE u.email = $1 AND m.role = 'tutor' ORDER BY m.created_at`,
    [email],
  );
  expect(logged.map((m) => m.hint_level)).toEqual([1, 2]);
  for (const m of logged) {
    expect(m.guard_verdict.source).toBe('llm');
    expect(m.guard_verdict.attempts.at(-1)!.revealed).toBe(false);
    expect(m.llm_run_id).toBeTruthy();
    expect(m.retrieved_chunk_ids.length).toBeGreaterThan(0);
    const nodes = await sql<{ node_id: string }>(
      'SELECT DISTINCT node_id FROM content_chunks WHERE id = ANY($1)',
      [m.retrieved_chunk_ids],
    );
    expect(nodes.every((r) => [start.id, types.id].includes(r.node_id))).toBe(true);
  }

  // 2. practice: a wrong answer opens the tutor for that question
  await page.getByTestId('start-practice').click();
  await page.getByLabel('Невірна відповідь', { exact: true }).check();
  await page.getByRole('button', { name: 'Перевірити' }).click();
  await expect(page.getByTestId('practice-verdict')).toContainText('невірно');
  const practiceChat = page
    .getByTestId('tutor-chat')
    .filter({ hasText: 'допомога з цим питанням' });
  await practiceChat.getByTestId('tutor-hint').click();
  await expect(practiceChat.getByTestId('tutor-tutor')).toHaveCount(1);
  await practiceChat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${proof}/2-practice-hint.png`, fullPage: true });

  // 3. remediation after a failed test: no answers are shown, hints are
  await page.getByTestId('start-test').click();
  await expect(page.getByTestId('test-runner')).toBeVisible();
  const running = page.url();
  const closed = await page.request.post(`/api/nodes/${types.id}/tutor`, {
    data: { message: 'Допоможіть із тестом' },
  });
  expect(closed.status()).toBe(409);
  expect((await closed.json()).error).toBe('tutor_unavailable');
  for (let i = 1; i <= 6; i++) {
    await expect(page.getByTestId('progress')).toContainText(`Питання ${i} з 6`);
    await page.getByLabel('Невірна відповідь', { exact: true }).check();
    await page.getByRole('button', { name: 'Відповісти' }).click();
  }
  await expect(page.getByTestId('result-verdict')).toHaveText('Поки що не пройдено');
  const item = page.getByTestId('remediation-item').first();
  await item.locator('summary').click();
  await item.getByTestId('tutor-hint').click();
  await expect(item.getByTestId('tutor-tutor')).toHaveCount(1);
  await expect(page.getByText('Правильна відповідь', { exact: true })).toHaveCount(0);
  await item.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${proof}/3-remediation-hint.png`, fullPage: true });
  expect(running).toContain('/assessments/');

  // 4. scope and limits on the server
  const locked = await page.request.post(`/api/nodes/${conditions.id}/tutor`, {
    data: { message: 'Допоможіть' },
  });
  expect(locked.status()).toBe(403);
  expect((await locked.json()).error).toBe('node_locked');
  const bad = await page.request.post(`/api/nodes/${start.id}/tutor`, { data: { message: '' } });
  expect(bad.status()).toBe(422);

  const limited = await (await browser.newContext()).newPage();
  await register(limited);
  await limited.goto(`/courses/${versionId}`);
  await limited.getByTestId('enroll').click();
  await expect(limited.getByTestId('graph-legend')).toBeVisible();
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    statuses.push(
      (
        await limited.request.post(`/api/nodes/${start.id}/tutor`, {
          data: { message: `Питання ${i}` },
        })
      ).status(),
    );
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
});
