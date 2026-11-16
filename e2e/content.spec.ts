import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));

test('an admin adds text and a video with a transcript to a node, and it shows next to the player', async ({
  page,
}) => {
  test.setTimeout(90_000); // the first visit to each page compiles it in dev mode
  const email = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', email, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page.getByText(/Вітаємо/)).toBeVisible();

  const res = await page.request.post('/api/admin/courses/import', {
    data: { ...demo, slug: `python-${uniq()}` },
  });
  const { versionId } = await res.json();

  // the graph links to the node page
  await page.goto(`/courses/${versionId}`);
  await page.getByTestId('graph-node').first().getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/courses/${versionId}/nodes/`));
  await expect(page.getByText('У цьому вузлі ще немає матеріалів.')).toBeVisible();

  // markdown with a code block and an image
  const add = page.getByTestId('add-form');
  await add.getByLabel('Назва').fill('Змінні');
  await add
    .getByLabel('Вміст (Markdown)')
    .fill(
      'Змінна зберігає **значення**.\n\n```python\nx = 1\nprint(x)\n```\n\n![схема](/favicon.ico)',
    );
  await add.getByRole('button', { name: 'Додати' }).click();
  const text = page.getByTestId('content-item').filter({ hasText: 'Змінні' });
  await expect(text.locator('pre code')).toContainText('print(x)');
  await expect(text.locator('strong')).toHaveText('значення');
  await expect(text.locator('img')).toHaveAttribute('alt', 'схема');

  // a video by link without a transcript: the author is warned
  await add.getByLabel('Тип').selectOption('video');
  await add.getByLabel('Назва').fill('Відео за посиланням');
  await add.getByLabel('Посилання на відео').fill('https://example.com/lesson.mp4');
  await add.getByRole('button', { name: 'Додати' }).click();
  await expect(page.getByTestId('content-issues')).toContainText('без транскрипту');
  await page.goto(`/courses/${versionId}`);
  await expect(page.getByTestId('graph-issues')).toContainText('has no transcript');
  await page.goBack();

  // an uploaded mp4 with the author's transcript: it plays and the transcript sits next to it
  await add.getByLabel('Тип').selectOption('video');
  await add.getByLabel('Назва').fill('Відео-урок');
  await add.getByLabel(/Або файл mp4/).setInputFiles('e2e/fixtures/sample.mp4');
  await add.getByLabel('Транскрипт').fill('Це транскрипт відео-уроку про змінні.');
  await add.getByRole('button', { name: 'Додати' }).click();
  const lesson = page.getByTestId('content-item').filter({ hasText: 'Відео-урок' });
  await expect(lesson.getByTestId('transcript')).toContainText('транскрипт відео-уроку');
  await expect(lesson.getByTestId('transcript')).toContainText('від автора');

  const video = lesson.locator('video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2);
  const [player, transcript] = await Promise.all([
    lesson.getByTestId('video-player').boundingBox(),
    lesson.getByTestId('transcript').boundingBox(),
  ]);
  expect(transcript!.x).toBeGreaterThan(player!.x + player!.width - 1); // side by side
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  await page.screenshot({ path: '.local-agent/proof/m03/node-content.png', fullPage: true });
});

test('a student sees published content but no editor; a draft stays hidden', async ({
  browser,
}) => {
  const adminEmail = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', adminEmail, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const adminCtx = await browser.newContext();
  await adminCtx.request.post('/api/auth/login', {
    data: { email: adminEmail, password: PASSWORD },
  });
  const { versionId } = await (
    await adminCtx.request.post('/api/admin/courses/import', {
      data: { ...demo, slug: `python-${uniq()}` },
    })
  ).json();
  const graph = await (await adminCtx.request.get(`/api/courses/versions/${versionId}`)).json();
  const nodeId = graph.nodes[0].id;
  const created = await adminCtx.request.post(`/api/nodes/${nodeId}/content`, {
    data: { kind: 'markdown', title: 'Секрет чернетки', bodyMd: 'Текст' },
  });
  expect(created.status()).toBe(201);

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/register');
  await page.getByLabel('Імʼя').fill('Студент');
  await page.getByLabel('Email').fill(`student-${uniq()}@e2e.local`);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByLabel(/умовами користування/).check();
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
  await expect(page.getByText(/Вітаємо/)).toBeVisible();

  expect((await page.request.get(`/api/nodes/${nodeId}/content`)).status()).toBe(404);
  expect((await page.goto(`/courses/${versionId}/nodes/${nodeId}`))?.status()).toBe(404);
  const post = await page.request.post(`/api/nodes/${nodeId}/content`, {
    data: { kind: 'markdown', title: 'x', bodyMd: 'y' },
  });
  expect(post.status()).toBe(404);
  const upload = await page.request.post('/api/content/upload', {
    headers: { 'content-type': 'video/mp4' },
    data: Buffer.from('x'),
  });
  expect(upload.status()).toBe(403);

  // once published, the student reads it, without the editor
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'eduforge',
      '-c',
      `UPDATE course_versions SET status='published' WHERE id='${versionId}'`,
    ],
    { stdio: 'pipe' },
  );
  await page.goto(`/courses/${versionId}/nodes/${nodeId}`);
  await expect(page.getByTestId('content-item')).toContainText('Секрет чернетки');
  await expect(page.getByTestId('content-editor')).toHaveCount(0);
  await adminCtx.close();
  await ctx.close();
});
