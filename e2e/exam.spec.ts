import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { answerAll, passGate, publishedCourse, sql, studentWhoFinished } from './exam-helpers';

const proof = '.local-agent/proof/m09';
mkdirSync(proof, { recursive: true });

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
  await expect(page.getByTestId('exam-start')).toBeDisabled(); // the proctoring consent is still missing
  await page.getByTestId('exam-consent').check();
  await page.getByTestId('exam-start').click();

  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await expect(page.getByTestId('exam-progress')).toHaveCount(0); // no question before the camera gate
  await passGate(page);
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
  await page.getByTestId('exam-consent').check();
  await page.getByTestId('exam-start').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await passGate(page);
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
  await page.getByTestId('exam-interrupt').click();
  await page.getByTestId('exam-interrupt-confirm').click();
  await expect(page.getByTestId('exam-interrupted')).toContainText('без штрафу');
  await page.screenshot({ path: `${proof}/7-interrupted.png` });
  await page.getByTestId('exam-resume').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
  await passGate(page);
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
  await passGate(page);
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
