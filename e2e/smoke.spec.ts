import { expect, test } from '@playwright/test';

test('home page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'EduForge' })).toBeVisible();
});

test('health endpoint reports the database', async ({ request }) => {
  const res = await request.get('/api/health');
  expect((await res.json()).db.ok).toBe(true);
});
