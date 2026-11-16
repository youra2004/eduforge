import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));

test('an admin imports the seed course and sees its graph', async ({ page }) => {
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

  // a broken course gets a list of errors and is not saved
  const slug = `python-${uniq()}`;
  const broken = { ...demo, slug, edges: [...demo.edges, { from: 'files', to: 'start' }] };
  const rejected = await page.request.post('/api/admin/courses/import', { data: broken });
  expect(rejected.status()).toBe(422);
  expect((await rejected.json()).issues.map((i: { code: string }) => i.code)).toContain('cycle');

  const res = await page.request.post('/api/admin/courses/import', { data: { ...demo, slug } });
  expect(res.status()).toBe(201);
  const { versionId } = await res.json();

  await page.goto('/courses');
  await page.locator(`a[href="/courses/${versionId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${versionId}$`));
  await expect(page.getByRole('heading', { name: /Основи Python/ })).toBeVisible();

  await expect(page.getByTestId('graph-node')).toHaveCount(8);
  await expect(page.locator('.react-flow__edge')).toHaveCount(9);
  await expect(page.getByTestId('graph-issues')).toHaveCount(0);
  // roots are open, everything behind a prerequisite is locked (placeholder states)
  await expect(page.locator('.graph-node.available')).toHaveCount(1);
  await expect(page.locator('.graph-node.locked')).toHaveCount(7);
  await page.screenshot({ path: '.local-agent/proof/m02/course-graph.png', fullPage: true });
});

test('a student cannot see or import a draft course', async ({ browser }) => {
  const adminEmail = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', adminEmail, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const adminCtx = await browser.newContext();
  const login = await adminCtx.request.post('/api/auth/login', {
    data: { email: adminEmail, password: PASSWORD },
  });
  expect(login.status()).toBe(200);
  const imported = await adminCtx.request.post('/api/admin/courses/import', {
    data: { ...demo, slug: `python-${uniq()}` },
  });
  const { versionId } = await imported.json();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/register');
  await page.getByLabel('Імʼя').fill('Студент');
  await page.getByLabel('Email').fill(`student-${uniq()}@e2e.local`);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByLabel(/умовами користування/).check();
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
  await expect(page.getByText(/Вітаємо/)).toBeVisible();

  expect((await page.goto(`/courses/${versionId}`))?.status()).toBe(404);
  expect((await page.request.get(`/api/courses/versions/${versionId}`)).status()).toBe(404);
  const list = await (await page.request.get('/api/courses')).json();
  expect(list.versions.some((v: { versionId: string }) => v.versionId === versionId)).toBe(false);
  expect((await page.request.post('/api/admin/courses/import', { data: demo })).status()).toBe(403);
  expect((await ctx.request.get('/api/courses')).status()).toBe(200);

  const guest = await browser.newContext();
  expect((await guest.request.get('/api/courses')).status()).toBe(401);
  await adminCtx.close();
  await ctx.close();
  await guest.close();
});
