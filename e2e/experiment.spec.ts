import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const proof = '.local-agent/proof/m07';
mkdirSync(proof, { recursive: true });

// The right answers of the demo content, by question text, so the test can answer like a student who knows the material.
interface Q {
  q: string;
  options: string[];
  correct: number;
}
type Topic = { questions: Record<'node' | 'assessment', Record<string, Q[]>> };
const seed = JSON.parse(
  readFileSync('packages/core/seed/experiment-modules.json', 'utf8'),
) as Record<'A' | 'B', Topic>;
const clean = (s: string) => s.replaceAll('`', '').replace(/\s+/g, ' ').trim();
const correctOption = new Map<string, string>();
for (const topic of [seed.A, seed.B])
  for (const pool of Object.values(topic.questions))
    for (const list of Object.values(pool))
      for (const q of list) correctOption.set(clean(q.q), clean(q.options[q.correct]!));

async function dbRows<T>(sql: string, params: unknown[]): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Answers the question on screen (right or deliberately wrong) and presses the button. */
async function answerCurrent(page: Page, right: boolean, button = 'Відповісти') {
  const prompt = clean(await page.getByTestId('question-prompt').innerText());
  const good = correctOption.get(prompt);
  expect(good, `a known question: ${prompt}`).toBeTruthy();
  const labels = (await page.locator('.options label').allInnerTexts()).map(clean);
  const pick = right ? good! : labels.find((l) => l !== good)!;
  await page.locator('.options label').filter({ hasText: pick }).first().check();
  await page.getByRole('button', { name: button, exact: true }).click();
}

/** Runs the whole test on screen: `Питання i з N` until the last answer. */
async function takeTest(page: Page, right: boolean, shot?: string) {
  await expect(page.getByTestId('test-runner')).toBeVisible();
  const total = Number(/з (\d+)/.exec(await page.getByTestId('progress').innerText())![1]);
  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('progress')).toContainText(`Питання ${i} з ${total}`);
    if (i === 1 && shot) await page.screenshot({ path: `${proof}/${shot}.png` });
    await answerCurrent(page, right);
  }
}

async function nodeOrder(page: Page, versionId: string) {
  const g = await (await page.request.get(`/api/courses/versions/${versionId}`)).json();
  const roots = g.nodes.filter(
    (n: { id: string }) => !g.edges.some((e: { to: string }) => e.to === n.id),
  );
  const rest = g.nodes.filter((n: { id: string }) => !roots.includes(n));
  return [...roots, ...rest] as { id: string; title: string }[];
}

const card = (page: Page, i: number): Locator => page.getByTestId('experiment-module').nth(i);

async function doModule(page: Page, i: number, label: string) {
  const c = card(page, i);
  await expect(c).toHaveAttribute('data-step', 'pretest');
  const control = (await c.getByTestId('module-condition').innerText()) === 'вільний режим';
  await page.screenshot({ path: `${proof}/${label}-1-module-pretest.png`, fullPage: true });

  // pre-test
  await c.getByTestId('start-pretest').click();
  await takeTest(page, false, `${label}-2-pretest-question`);
  await expect(page.getByTestId('study-test-done')).toBeVisible();
  // no verdicts, no score
  await expect(page.getByTestId('study-test-done')).not.toContainText(/вірно|%/);
  await page.screenshot({ path: `${proof}/${label}-3-pretest-done.png` });
  await page.getByTestId('back-to-experiment').click();
  await expect(card(page, i)).toHaveAttribute('data-step', 'learning');

  // learning
  const href = (await card(page, i).getByTestId('open-course').getAttribute('href'))!;
  const versionId = href.split('/').pop()!;
  await page.goto(href);
  await page.getByTestId('enroll').click();
  await expect(page.getByTestId('graph-legend')).toBeVisible();
  const nodes = await nodeOrder(page, versionId);
  const state = (title: string) =>
    page.getByTestId('graph-node').filter({ hasText: title }).getByTestId('graph-node-state');

  if (control) {
    await expect(page.getByTestId('free-navigation-note')).toBeVisible();
    for (const n of nodes) await expect(state(n.title)).toHaveText('Доступний');
    await page.screenshot({ path: `${proof}/${label}-4-control-graph.png`, fullPage: true });
    // the second node is readable straight away, there is no tutor and no node test
    await page.goto(`${href}/nodes/${nodes[1]!.id}`);
    await expect(page.getByTestId('content-item')).toBeVisible();
    await expect(page.getByTestId('tutor-chat')).toHaveCount(0);
    await expect(page.getByTestId('start-test')).toHaveCount(0);
    await page.getByTestId('start-practice').click();
    await answerCurrent(page, true, 'Перевірити');
    await expect(page.getByTestId('practice-verdict')).toContainText('Вірно');
    await page.waitForTimeout(2500); // a heartbeat (every 2 s in this run)
    await page.screenshot({ path: `${proof}/${label}-5-control-node.png`, fullPage: true });
    // the server refuses even when the UI is bypassed
    const tutor = await page.request.post(`/api/nodes/${nodes[0]!.id}/tutor`, {
      data: { message: 'Підкажіть' },
    });
    expect(tutor.status()).toBe(403);
    expect((await tutor.json()).error).toBe('tutor_disabled');
    const nodeTest = await page.request.post(`/api/nodes/${nodes[0]!.id}/test`);
    expect(nodeTest.status()).toBe(403);
    expect((await nodeTest.json()).error).toBe('node_test_disabled');
    console.log(`control: tutor -> 403 tutor_disabled, node test -> 403 node_test_disabled`);
    await page.goto('/experiment');
    await card(page, i).getByTestId('finish-learning').click();
  } else {
    await expect(state(nodes[0]!.title)).toHaveText('Доступний');
    await expect(state(nodes[1]!.title)).toHaveText('Заблокований');
    await page.screenshot({ path: `${proof}/${label}-4-method-graph.png`, fullPage: true });
    for (const [k, n] of nodes.entries()) {
      await page.goto(`${href}/nodes/${n.id}`);
      await expect(page.getByTestId('content-item')).toBeVisible();
      if (k === 0) {
        await page.getByTestId('tutor-input').fill('Підкажіть, з чого почати?');
        await page.getByTestId('tutor-send').click();
        await expect(page.getByTestId('tutor-tutor')).toBeVisible();
        await page.waitForTimeout(2500); // a heartbeat
        await page.screenshot({
          path: `${proof}/${label}-5-method-node-tutor.png`,
          fullPage: true,
        });
      }
      await page.getByTestId('start-test').click();
      await takeTest(page, true, k === 0 ? `${label}-6-method-node-test` : undefined);
      await expect(page.getByTestId('result-verdict')).toHaveText('Вузол пройдено');
    }
    await page.goto('/experiment');
  }

  // post-test, survey
  await expect(card(page, i)).toHaveAttribute('data-step', 'posttest');
  await page.screenshot({ path: `${proof}/${label}-7-module-posttest.png`, fullPage: true });
  await card(page, i).getByTestId('start-posttest').click();
  await takeTest(page, true);
  await page.getByTestId('back-to-experiment').click();
  await expect(card(page, i)).toHaveAttribute('data-step', 'survey');
  const items = card(page, i).getByTestId('survey-item');
  for (let k = 0; k < (await items.count()); k++) {
    await items.nth(k).getByLabel('4', { exact: true }).check();
  }
  await page.screenshot({ path: `${proof}/${label}-8-survey.png`, fullPage: true });
  await card(page, i).getByTestId('submit-survey').click();
  await expect(card(page, i)).toHaveAttribute('data-step', 'delayed_wait');
  return control;
}

test('a participant completes a module in both conditions, and the export is de-identified', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const adminEmail = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', adminEmail, 'Адмін Секретний'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const seeded = execFileSync('pnpm', ['seed-experiment', adminEmail], {
    env: process.env,
    encoding: 'utf8',
  });
  console.log(
    seeded
      .split('\n')
      .filter((l) => l.startsWith('Topic'))
      .join('\n'),
  );

  const student = await (await browser.newContext()).newPage();
  const email = `student-${uniq()}@e2e.local`;
  const registered = await student.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, displayName: 'Студентка Секретна', acceptTerms: true },
  });
  expect(registered.status()).toBe(201);

  // consent first
  await student.goto('/experiment');
  await expect(student.getByTestId('join-experiment')).toBeDisabled();
  await student.screenshot({ path: `${proof}/00-consent.png`, fullPage: true });
  const early = await student.request.post('/api/experiment/modules/A/test', {
    data: { kind: 'pretest' },
  });
  expect(early.status()).toBe(403);
  expect((await early.json()).error).toBe('experiment_not_joined');
  await student.getByTestId('research-consent').check();
  await student.getByTestId('join-experiment').click();
  await expect(student.getByTestId('participant-code')).toHaveText(/^P-[A-Z2-9]{6}$/);
  const code = await student.getByTestId('participant-code').innerText();
  await expect(student.getByTestId('experiment-module')).toHaveCount(2);
  await expect(card(student, 1)).toHaveAttribute('data-step', 'waiting');
  await student.screenshot({ path: `${proof}/01-experiment-joined.png`, fullPage: true });

  const firstControl = await doModule(student, 0, 'p1');
  await student.screenshot({ path: `${proof}/p1-9-delayed-wait.png`, fullPage: true });
  await expect(card(student, 1)).toHaveAttribute('data-step', 'pretest');
  const secondControl = await doModule(student, 1, 'p2');
  // one module of each condition
  expect(firstControl).not.toBe(secondControl);

  // the delayed test opens after the wait (10 s in this run); the reminder shows
  await student.goto('/student');
  await expect(async () => {
    await student.reload();
    await expect(student.getByTestId('delayed-reminder')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await student.screenshot({ path: `${proof}/p3-1-student-reminder.png` });
  await student.goto('/experiment');
  await expect(student.getByTestId('delayed-reminder')).toBeVisible();
  await expect(card(student, 0)).toHaveAttribute('data-step', 'delayed');
  await student.screenshot({ path: `${proof}/p3-2-delayed-due.png`, fullPage: true });
  await card(student, 0).getByTestId('start-delayed_posttest').click();
  await takeTest(student, true);
  await student.getByTestId('back-to-experiment').click();
  await expect(card(student, 0)).toHaveAttribute('data-step', 'complete');
  await expect(card(student, 1)).toHaveAttribute('data-step', 'delayed_wait');
  await student.screenshot({ path: `${proof}/p3-3-complete.png`, fullPage: true });

  // events: every event of the study carries module and condition
  const events = await dbRows<{ name: string; props: { module?: string; condition?: string } }>(
    `SELECT e.name, e.props FROM event_log e JOIN users u ON u.id = e.user_id WHERE u.email = $1`,
    [email],
  );
  const names = new Set(events.map((e) => e.name));
  for (const n of [
    'module_started',
    'module_finished',
    'content_opened',
    'session_heartbeat',
    'node_test_started',
    'node_test_submitted',
    'question_answered',
    'hint_requested',
    'tutor_message',
    'mastery_updated',
    'pretest_started',
    'pretest_submitted',
    'posttest_started',
    'posttest_submitted',
    'delayed_posttest_submitted',
    'survey_submitted',
  ]) {
    expect(names, n).toContain(n);
  }
  console.log(`event names written: ${[...names].sort().join(', ')}`);

  // the admin's export
  const admin = await (await browser.newContext()).newPage();
  await admin.goto('/login');
  await admin.getByLabel('Email').fill(adminEmail);
  await admin.getByLabel('Пароль').fill(PASSWORD);
  await admin.getByRole('button', { name: 'Увійти' }).click();
  await expect(admin.getByText(/Вітаємо/)).toBeVisible();
  await admin.goto('/admin');
  await expect(admin.getByTestId('export-links')).toContainText('modules.csv');
  await admin.screenshot({ path: `${proof}/p4-admin-export.png`, fullPage: true });
  // a student cannot download it
  expect((await student.request.get('/api/admin/experiment/export?table=modules')).status()).toBe(
    403,
  );
  const modulesCsv = await (
    await admin.request.get('/api/admin/experiment/export?table=modules')
  ).text();
  writeFileSync(`${proof}/export-modules.csv`, modulesCsv);
  for (const table of ['answers', 'events', 'tutor']) {
    const csv = await (
      await admin.request.get(`/api/admin/experiment/export?table=${table}`)
    ).text();
    expect(csv, table).not.toContain(email);
    expect(csv, table).not.toContain('Студентка Секретна');
    if (table === 'events') writeFileSync(`${proof}/export-events.csv`, csv);
  }
  expect(modulesCsv).toContain(code);
  expect(modulesCsv).not.toContain(email);
  expect(modulesCsv).not.toContain('Студентка Секретна');
  expect(modulesCsv.split('\n')[0]).not.toMatch(/email|user_id|display_name|(^|,)name(,|$)/);
  console.log(modulesCsv);
});
