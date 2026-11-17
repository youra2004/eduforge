import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));
const proof = '.local-agent/proof/m09';
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

/** A published, rated copy of the demo course with node and exam questions (stands in for the audit and the generator). */
async function publishedCourse(browser: Browser) {
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
  return { versionId, nodeId: nodeRow[0]!.id };
}

/** A student who joined the course and has passed every node (the learning part has its own tests). */
async function studentWhoFinished(browser: Browser, versionId: string) {
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

async function answerAll(page: Page, rightCount: number, total = 20) {
  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('exam-progress')).toContainText(`Питання ${i} з ${total}`);
    await page
      .getByLabel(i <= rightCount ? 'Правильна відповідь' : 'Невірна відповідь', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Відповісти й далі' }).click();
  }
}

test('a student takes the exam: pre-check, one question at a time, per-skill result, tutor closed', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { versionId, nodeId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);

  await page.goto(`/courses/${versionId}`);
  await expect(page.getByTestId('exam-link')).toBeVisible();
  await page.getByTestId('exam-link').click();
  await expect(page.getByTestId('exam-precheck')).toBeVisible();
  await expect(page.getByTestId('exam-rules')).toContainText('Питань: 20, на весь іспит — 45 хв');
  await expect(page.getByTestId('exam-start')).toBeDisabled();
  await page.screenshot({ path: `${proof}/1-precheck.png`, fullPage: true });
  await page.getByTestId('exam-agree').check();
  await page.getByTestId('exam-start').click();

  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 1 з 20');
  await expect(page.getByTestId('exam-total-timer')).toHaveText(/4[45]:\d\d/);
  await page.screenshot({ path: `${proof}/2-question.png`, fullPage: true });

  // the tutor is closed on the server while the exam runs
  const tutor = await page.request.post(`/api/nodes/${nodeId}/tutor`, {
    data: { message: 'Підкажіть відповідь' },
  });
  expect(tutor.status()).toBe(409);
  expect((await tutor.json()).error).toBe('tutor_unavailable');

  // the exam is not readable through the generic assessment endpoint, which would list every question
  const [{ id: examId }] = await sql<{ id: string }>(
    "SELECT id FROM assessments WHERE kind = 'exam' AND user_id = (SELECT id FROM users WHERE email = $1)",
    [email],
  );
  expect((await page.request.get(`/api/assessments/${examId}`)).status()).toBe(404);
  const view = await (await page.request.get(`/api/exams/${examId}`)).json();
  expect(JSON.stringify(view)).not.toMatch(/answerKey|isCorrect|rubric/);
  expect(JSON.stringify(view).match(/promptMd/g)).toHaveLength(1);

  await answerAll(page, 14);
  await expect(page.getByTestId('exam-result')).toBeVisible();
  await expect(page.getByTestId('exam-verdict')).toHaveText('Іспит складено');
  await expect(page.getByTestId('exam-score')).toHaveText('70 %');
  await expect(page.getByTestId('exam-skill')).toHaveCount(11);
  await page.screenshot({ path: `${proof}/3-result-passed.png`, fullPage: true });

  const [stored] = await sql<{ status: string; score_pct: number; items: string }>(
    `SELECT a.status, a.score_pct, (SELECT count(*) FROM assessment_items i WHERE i.assessment_id = a.id) AS items
     FROM assessments a WHERE a.id = $1`,
    [examId],
  );
  expect(stored).toMatchObject({ status: 'passed', score_pct: 70, items: '20' });

  const again = await page.request.post(`/api/courses/versions/${versionId}/exam`);
  expect(again.status()).toBe(409);
  expect((await again.json()).error).toBe('exam_passed');
  await page.goto(`/courses/${versionId}/exam`);
  await expect(page.getByTestId('exam-blocked')).toContainText('вже складено');
  await expect(page.getByTestId('exam-history')).toContainText('складено (70 %)');
  await page.screenshot({ path: `${proof}/4-precheck-after-pass.png`, fullPage: true });
});

test('a late answer is rejected, an interruption resumes with a new set, two failures start the pause', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { versionId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);
  const examsOf = () =>
    sql<{ id: string; status: string; attempt_no: number }>(
      `SELECT id, status, attempt_no FROM assessments
       WHERE kind = 'exam' AND user_id = (SELECT id FROM users WHERE email = $1) ORDER BY started_at`,
      [email],
    );

  // the timer is the server's: wait out the first question and answer anyway
  await page.goto(`/courses/${versionId}/exam`);
  await page.getByTestId('exam-agree').check();
  await page.getByTestId('exam-start').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
  const [{ id: firstExam }] = await examsOf();
  const first = await (await page.request.get(`/api/exams/${firstExam}`)).json();
  await expect(page.getByTestId('exam-question-timer')).toHaveText(/0:(1\d|20)/);
  await page.screenshot({ path: `${proof}/5-question-timer.png` });
  await page.waitForTimeout(21_000);
  const late = await page.request.post(`/api/exams/${firstExam}/answer`, {
    data: { itemId: first.exam.current.itemId, answer: { optionIndex: 1 } },
  });
  expect(late.status()).toBe(409);
  expect((await late.json()).error).toBe('exam_time_expired');
  const [missed] = await sql<{ score: number; answer: { timedOut: boolean } }>(
    'SELECT score, answer FROM assessment_items WHERE id = $1',
    [first.exam.current.itemId],
  );
  expect(missed).toMatchObject({ score: 0, answer: { timedOut: true } });
  // the page moves on by itself to the next question
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 2 з 20', {
    timeout: 15_000,
  });
  await page.screenshot({ path: `${proof}/6-after-timeout.png` });

  // a technical interruption: no strike, then a new set
  const setBefore = await sql<{ question_id: string }>(
    'SELECT question_id FROM assessment_items WHERE assessment_id = $1 ORDER BY ord',
    [firstExam],
  );
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('exam-interrupt').click();
  await expect(page.getByTestId('exam-interrupted')).toContainText('без штрафу');
  await page.screenshot({ path: `${proof}/7-interrupted.png` });
  await page.getByTestId('exam-resume').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 1 з 20');
  const exams = await examsOf();
  expect(exams.map((e) => [e.status, e.attempt_no])).toEqual([
    ['interrupted', 1],
    ['in_progress', 1],
  ]);
  const setAfter = await sql<{ question_id: string }>(
    'SELECT question_id FROM assessment_items WHERE assessment_id = $1 ORDER BY ord',
    [exams[1]!.id],
  );
  expect(setAfter.map((r) => r.question_id)).not.toEqual(setBefore.map((r) => r.question_id));
  const [user] = await sql<{ exam_ban_until: Date | null; exam_banned_forever: boolean }>(
    'SELECT exam_ban_until, exam_banned_forever FROM users WHERE email = $1',
    [email],
  );
  expect(user).toMatchObject({ exam_ban_until: null, exam_banned_forever: false });

  // two failed attempts use up the round: the pause
  await answerAll(page, 0);
  await expect(page.getByTestId('exam-verdict')).toHaveText('Іспит не складено');
  await expect(page.getByTestId('exam-next')).toContainText('Залишилась спроба');
  await page.screenshot({ path: `${proof}/8-result-failed.png`, fullPage: true });
  await page.goto(`/courses/${versionId}/exam`);
  await page.getByTestId('exam-agree').check();
  await page.getByTestId('exam-start').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await answerAll(page, 0);
  await expect(page.getByTestId('exam-next')).toContainText('Спроби раунду вичерпано');
  await page.screenshot({ path: `${proof}/9-result-pause.png`, fullPage: true });
  await page.goto(`/courses/${versionId}/exam`);
  await expect(page.getByTestId('exam-blocked')).toContainText('Новий раунд почнеться після паузи');
  await expect(page.getByTestId('exam-start')).toHaveCount(0);
  await page.screenshot({ path: `${proof}/10-precheck-pause.png`, fullPage: true });
  const refused = await page.request.post(`/api/courses/versions/${versionId}/exam`);
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toBe('exam_cooldown');
});
