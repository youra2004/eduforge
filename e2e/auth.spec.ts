import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Each test gets its own fake client IP so failed logins in one test do not rate limit the others.
test.beforeEach(async ({ context }) => {
  const n = Math.floor(Math.random() * 250) + 1;
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${n}.${n}.${n}` });
});

async function register(page: Page, email: string, name = 'Олена') {
  await page.goto('/register');
  await page.getByLabel('Імʼя').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByLabel(/умовами користування/).check();
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Увійти' }).click();
}

async function loginOk(page: Page, email: string) {
  await login(page, email);
  await expect(page.getByText(/Вітаємо/)).toBeVisible();
}

test('register, log out, log in, reach the student page', async ({ page }) => {
  const email = `student-${uniq()}@e2e.local`;
  await register(page, email);
  await expect(page.getByText('Вітаємо, Олена!')).toBeVisible();

  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await loginOk(page, email);
  await page.getByRole('link', { name: 'Студент' }).click();
  await expect(page.getByRole('heading', { name: 'Студент' })).toBeVisible();
  await page.screenshot({ path: '.local-agent/proof/m01/student-page.png' });
});

test('guests are sent to login and a wrong password shows an error', async ({ page, request }) => {
  await page.goto('/student');
  await expect(page).toHaveURL(/\/login$/);

  expect((await request.get('/api/auth/me')).status()).toBe(401);
  expect((await request.get('/api/admin/users')).status()).toBe(401);

  await login(page, `nobody-${uniq()}@e2e.local`, 'wrong password');
  await expect(page.locator('p.error')).toHaveText('Невірний email або пароль.');
});

test('registration requires the terms checkbox', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Імʼя').fill('Олена');
  await page.getByLabel('Email').fill(`x-${uniq()}@e2e.local`);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
  await expect(page).toHaveURL(/\/register$/); // the browser blocks the submit
  await expect(page.getByLabel(/умовами користування/)).toBeFocused();
});

test('a student cannot open admin pages or APIs', async ({ page }) => {
  await register(page, `student-${uniq()}@e2e.local`);
  await expect(page.getByText('Вітаємо, Олена!')).toBeVisible();

  const res = await page.goto('/admin');
  expect(res?.status()).toBe(403);
  await expect(page.getByRole('heading', { name: 'Доступ заборонено' })).toBeVisible();
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
});

test('an admin assigns a role and the user then reaches that page', async ({ browser }) => {
  const adminEmail = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', adminEmail, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });

  const userEmail = `author-${uniq()}@e2e.local`;
  const userCtx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.9.1' } });
  const user = await userCtx.newPage();
  await register(user, userEmail, 'Автор Тест');
  await expect(user.getByText('Вітаємо, Автор Тест!')).toBeVisible();
  expect((await user.goto('/author'))?.status()).toBe(403);

  const adminCtx = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': '10.9.9.2' },
  });
  const admin = await adminCtx.newPage();
  await loginOk(admin, adminEmail);
  await admin.goto('/admin');
  const row = admin.getByRole('row', { name: new RegExp(userEmail) });
  await row.getByLabel('Автор').check();
  await expect(row.getByLabel('Автор')).toBeChecked();
  await admin.reload();
  await expect(
    admin.getByRole('row', { name: new RegExp(userEmail) }).getByLabel('Автор'),
  ).toBeChecked(); // persisted
  await admin.screenshot({ path: '.local-agent/proof/m01/admin-roles.png' });

  expect((await user.goto('/author'))?.status()).toBe(200);
  await expect(user.getByRole('heading', { name: 'Автор' })).toBeVisible();

  await adminCtx.close();
  await userCtx.close();
});
