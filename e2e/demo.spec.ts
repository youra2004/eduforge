import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { PASSWORD, uniq } from './exam-helpers';

const proof = '.local-agent/proof/m12';
mkdirSync(proof, { recursive: true });

async function login(browser: Browser, email: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await expect(page.getByText(/Вітаємо/)).toBeVisible();
  return page;
}

test('demo scenario: seed → admin sees the scaled pauses → "run now" → students see their tips', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // From nothing but the script: demonstration data, all of it marked as such.
  const suffix = `-${uniq()}`;
  const seeded = execFileSync('pnpm', ['seed-demo'], {
    env: { ...process.env, DEMO_PASSWORD: PASSWORD, DEMO_SUFFIX: suffix },
    encoding: 'utf8',
  });
  expect(seeded).toContain('Demonstration data created');
  const email = (key: string) => `demo-${key}${suffix}@demo.eduforge.local`;

  // The admin: TIME_SCALE=1440 in the e2e server, so the 24 h pause lasts a minute.
  const admin = await login(browser, email('admin'));
  await admin.goto('/admin');
  await admin.screenshot({ path: `${proof}/1-admin-demo-link.png`, fullPage: true });
  await admin.getByTestId('demo-link').click();
  await expect(admin.getByTestId('time-scale')).toContainText('1440');
  await expect(admin.getByTestId('pause-node-scaled')).toHaveText('1 хв');
  await admin.screenshot({ path: `${proof}/2-admin-demo-page.png`, fullPage: true });

  await admin.getByTestId('run-recommendations').click();
  await expect(admin.getByTestId('run-result')).toBeVisible();
  const row = (key: string) => admin.getByTestId('run-row').filter({ hasText: email(key) });
  await expect(row('olena')).toContainText('Створено поради');
  await expect(row('taras')).toContainText('Створено поради');
  await expect(row('iryna')).toContainText('Створено поради');
  await expect(row('maksym')).toContainText('Замало даних');
  await admin.screenshot({ path: `${proof}/3-admin-run-result.png`, fullPage: true });

  // The struggling student sees at most three tips and the demo marker.
  const taras = await login(browser, email('taras'));
  await taras.goto('/student');
  await expect(taras.getByTestId('demo-banner')).toBeVisible();
  const count = await taras.getByTestId('recommendation').count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  await expect(taras.getByTestId('recommendations')).toContainText('Типи даних і оператори');
  await taras.screenshot({ path: `${proof}/4-student-struggling.png`, fullPage: true });

  const iryna = await login(browser, email('iryna'));
  await iryna.goto('/student');
  await expect(iryna.getByTestId('recommendations')).toContainText('Поверніться до курсу');
  await iryna.screenshot({ path: `${proof}/5-student-idle.png`, fullPage: true });

  const maksym = await login(browser, email('maksym'));
  await maksym.goto('/student');
  await expect(maksym.getByTestId('no-recommendations')).toBeVisible();
  await maksym.screenshot({ path: `${proof}/6-student-new-no-tips.png`, fullPage: true });

  // Nothing changed since: running again creates no new tip for anyone.
  await admin.getByTestId('run-recommendations').click();
  await expect(admin.getByTestId('run-created')).toHaveText('0');
  await admin.screenshot({ path: `${proof}/7-admin-second-run.png`, fullPage: true });
  await taras.reload();
  expect(await taras.getByTestId('recommendation').count()).toBe(count);
});
