import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  PASSWORD,
  answerAll,
  passGate,
  publishedCourse,
  sql,
  studentWhoFinished,
  uniq,
} from './exam-helpers';

const proof = '.local-agent/proof/m10';
mkdirSync(proof, { recursive: true });

/** Starts the exam from the pre-check page; `scenario` is the mock checker's script (demo mode). */
async function startExam(page: Page, versionId: string, scenario?: string) {
  await page.goto(`/courses/${versionId}/exam${scenario ? `?proctor=${scenario}` : ''}`);
  await page.getByTestId('exam-agree').check();
  const consent = page.getByTestId('exam-consent');
  if (await consent.isEnabled()) await consent.check();
  await page.getByTestId('exam-start').click();
  await expect(page.getByTestId('exam-runner')).toBeVisible();
}

const attemptOf = async (email: string) =>
  (
    await sql<{ id: string; status: string; risk_score: number }>(
      `SELECT id, status, risk_score FROM assessments
       WHERE kind = 'exam' AND user_id = (SELECT id FROM users WHERE email = $1) ORDER BY started_at DESC`,
      [email],
    )
  )[0]!;

async function adminPage(browser: Browser) {
  const email = `proctor-admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', email, 'Адмін перевірки'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page.getByText(/Вітаємо/)).toBeVisible();
  return page;
}

test('the camera gate: a normal run stores no frame, the exam is passed, nothing is flagged', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { versionId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);

  await page.goto(`/courses/${versionId}/exam`);
  await page.screenshot({ path: `${proof}/1-precheck-consent.png`, fullPage: true });
  await startExam(page, versionId, 'normal');
  await expect(page.getByTestId('proctor-gate')).toBeVisible();
  await expect(page.getByTestId('exam-progress')).toHaveCount(0);
  await page.screenshot({ path: `${proof}/2-camera-gate.png`, fullPage: true });
  await passGate(page);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 1 з 20');
  await page.screenshot({ path: `${proof}/3-exam-proctored.png` });

  // a frame check happens by itself (every 3 s here)
  const a = await attemptOf(email);
  await expect
    .poll(
      async () =>
        (
          await sql(
            "SELECT 1 FROM proctor_events WHERE assessment_id = $1 AND type = 'snapshot_ok'",
            [a.id],
          )
        ).length,
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  await answerAll(page, 14);
  await expect(page.getByTestId('exam-verdict')).toHaveText('Іспит складено');
  // the exam is over: the page has let go of fullscreen on its own, and no one was flagged
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  const [counts] = await sql<{ evidence: string; strikes: string; flagged: string }>(
    `SELECT (SELECT count(*) FROM proctor_evidence e JOIN proctor_events v ON v.id = e.event_id WHERE v.assessment_id = $1) AS evidence,
            (SELECT count(*) FROM strikes WHERE assessment_id = $1) AS strikes,
            (SELECT count(*) FROM proctor_events WHERE assessment_id = $1 AND severity <> 'info') AS flagged`,
    [a.id],
  );
  expect(counts).toEqual({ evidence: '0', strikes: '0', flagged: '0' });
  const [row] = await sql<{ status: string }>('SELECT status FROM assessments WHERE id = $1', [
    a.id,
  ]);
  expect(row!.status).toBe('passed');
});

test('a hard event stops the attempt with a strike and a ban; the student appeals; an admin overturns it', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { versionId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);
  await startExam(page, versionId);
  await passGate(page);
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 1 з 20');

  // leaving fullscreen
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByTestId('exam-stopped')).toBeVisible();
  await expect(page.getByTestId('exam-stopped-reason')).toContainText('повноекранного');
  await expect(page.getByTestId('exam-strike')).toContainText('Порушення №1');
  await page.screenshot({ path: `${proof}/4-hard-stop.png`, fullPage: true });
  const a = await attemptOf(email);
  expect(a.status).toBe('annulled');
  const [strike] = await sql<{ status: string; level: number }>(
    'SELECT status, level FROM strikes WHERE assessment_id = $1',
    [a.id],
  );
  expect(strike).toEqual({ status: 'confirmed', level: 1 });

  // the ban is for exams only
  const refused = await page.request.post(`/api/courses/versions/${versionId}/exam`);
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe('exam_banned');
  expect((await page.request.get(`/api/courses/versions/${versionId}`)).status()).toBe(200);
  await page.goto(`/courses/${versionId}`);
  await expect(page.getByTestId('graph-legend')).toBeVisible(); // learning is open

  // appeal
  await page.goto(`/courses/${versionId}/exam`);
  await expect(page.getByTestId('exam-blocked')).toContainText('закрито доступ до іспитів');
  await page
    .getByTestId('appeal-text')
    .fill('Вікно згорнулося через системне сповіщення, я не виходив навмисно.');
  await page.getByTestId('appeal-submit').click();
  await expect(page.getByTestId('own-strike')).toContainText('апеляцію подано');
  await page.screenshot({ path: `${proof}/5-appeal-sent.png`, fullPage: true });

  // the admin sees it and overturns it
  const admin = await adminPage(browser);
  await admin.goto('/admin');
  await admin.getByTestId('strikes-link').click();
  const item = admin.getByTestId('strike-case').filter({ hasText: email });
  await expect(item.getByTestId('appeal-text-view')).toContainText('системне сповіщення');
  await admin.screenshot({ path: `${proof}/6-admin-appeal.png`, fullPage: true });
  await item.getByTestId('strike-overturn').click();
  await expect(admin.getByTestId('strike-case').filter({ hasText: email })).toHaveCount(0);
  const [user] = await sql<{ exam_ban_until: Date | null }>(
    'SELECT exam_ban_until FROM users WHERE email = $1',
    [email],
  );
  expect(user!.exam_ban_until).toBeNull();
  await page.goto(`/courses/${versionId}/exam`);
  await expect(page.getByTestId('exam-start')).toBeVisible();
  await page.screenshot({ path: `${proof}/7-ban-lifted.png`, fullPage: true });
});

test('mock scenarios: a phone is only a soft signal; a second person goes to the admin, who confirms the strike', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { versionId } = await publishedCourse(browser);

  // phone: 50 points, below the threshold of 60: logged, with its frame, and no strike
  const one = await studentWhoFinished(browser, versionId);
  await startExam(one.page, versionId, 'phone');
  await passGate(one.page);
  const phoneAttempt = await attemptOf(one.email);
  await expect
    .poll(
      async () =>
        (
          await sql("SELECT 1 FROM proctor_events WHERE assessment_id = $1 AND type = 'phone'", [
            phoneAttempt.id,
          ])
        ).length,
      { timeout: 25_000 },
    )
    .toBeGreaterThan(0);
  const [phone] = await sql<{ risk: number; strikes: string; evidence: string }>(
    `SELECT a.risk_score AS risk,
            (SELECT count(*) FROM strikes WHERE assessment_id = a.id) AS strikes,
            (SELECT count(*) FROM proctor_evidence e JOIN proctor_events v ON v.id = e.event_id WHERE v.assessment_id = a.id) AS evidence
     FROM assessments a WHERE a.id = $1`,
    [phoneAttempt.id],
  );
  expect(phone!.strikes).toBe('0');
  expect(Number(phone!.evidence)).toBeGreaterThan(0);
  expect(phone!.risk).toBeGreaterThanOrEqual(50);
  expect((await attemptOf(one.email)).status).toBe('in_progress'); // soft: the attempt goes on

  // second person: the browser sees two faces, the checker sees one more: over the threshold, an admin decides
  const two = await studentWhoFinished(browser, versionId);
  await startExam(two.page, versionId, 'second_person');
  await passGate(two.page);
  const secondAttempt = await attemptOf(two.email);
  await expect
    .poll(
      async () =>
        (
          await sql(
            "SELECT 1 FROM strikes WHERE assessment_id = $1 AND status = 'pending_review'",
            [secondAttempt.id],
          )
        ).length,
      { timeout: 40_000 },
    )
    .toBeGreaterThan(0);
  const [ban] = await sql<{ exam_ban_until: Date | null }>(
    'SELECT exam_ban_until FROM users WHERE email = $1',
    [two.email],
  );
  expect(ban!.exam_ban_until).toBeNull(); // no ban before an admin confirms
  expect((await attemptOf(two.email)).status).toBe('in_progress');

  const admin = await adminPage(browser);
  await admin.goto('/admin/strikes');
  const item = admin.getByTestId('strike-case').filter({ hasText: two.email });
  await expect(item).toContainText('Друга людина в кадрі');
  await expect(item.getByTestId('evidence-frame').first()).toBeVisible();
  // the frames of this case decode (the queue may hold older cases of earlier runs, whose files are gone)
  await expect
    .poll(() =>
      item
        .locator('img')
        .evaluateAll((imgs) =>
          imgs.every(
            (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await item.scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `${proof}/8-admin-queue-evidence.png`, fullPage: true });
  await item.getByTestId('strike-confirm').click();
  await expect(admin.getByTestId('strike-case').filter({ hasText: two.email })).toHaveCount(0);

  const [confirmed] = await sql<{ status: string; level: number }>(
    'SELECT status, level FROM strikes WHERE assessment_id = $1',
    [secondAttempt.id],
  );
  expect(confirmed).toEqual({ status: 'confirmed', level: 1 });
  expect((await attemptOf(two.email)).status).toBe('annulled');
  await two.page.reload();
  await expect(two.page.getByTestId('exam-stopped')).toBeVisible();
  await two.page.screenshot({ path: `${proof}/9-confirmed-student-view.png`, fullPage: true });
});

test('a camera that goes away is a technical interruption: no strike, no ban', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { versionId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);
  await startExam(page, versionId);
  await passGate(page);
  await page.evaluate(() => {
    const video = document.querySelector('[data-testid=proctor-video]') as HTMLVideoElement;
    (video.srcObject as MediaStream).getVideoTracks()[0]!.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('exam-interrupted')).toContainText('без штрафу');
  await page.screenshot({ path: `${proof}/10-camera-interruption.png`, fullPage: true });
  const a = await attemptOf(email);
  expect(a.status).toBe('interrupted');
  const [{ strikes }] = await sql<{ strikes: string }>(
    'SELECT count(*) AS strikes FROM strikes WHERE user_id = (SELECT id FROM users WHERE email = $1)',
    [email],
  );
  expect(strikes).toBe('0');
});

test('losing focus past the grace period is a hard event (it must survive the runner re-rendering)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { versionId } = await publishedCourse(browser);
  const { page, email } = await studentWhoFinished(browser, versionId);
  await startExam(page, versionId);
  await passGate(page);
  await expect(page.getByTestId('exam-progress')).toContainText('Питання 1 з 20');
  // a short blur (under the 1 s grace of this run) is nothing; a long one is a violation
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1500);
  expect((await attemptOf(email)).status).toBe('in_progress');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('exam-stopped')).toBeVisible();
  await expect(page.getByTestId('exam-stopped-reason')).toContainText('втратило фокус');
  const [strike] = await sql<{ reason: string; status: string }>(
    'SELECT reason, status FROM strikes WHERE assessment_id = $1',
    [(await attemptOf(email)).id],
  );
  expect(strike).toEqual({ reason: 'focus_lost', status: 'confirmed' });
});
