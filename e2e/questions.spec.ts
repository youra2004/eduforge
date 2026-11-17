import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const demo = JSON.parse(readFileSync('packages/core/seed/demo-course.json', 'utf8'));

test('an author adds a question by hand, approves and rejects it, and sees which questions the node lacks', async ({
  page,
}) => {
  test.setTimeout(90_000);
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
  const graph = await (await page.request.get(`/api/courses/versions/${versionId}`)).json();
  const node = graph.nodes[0];
  await page.request.post(`/api/nodes/${node.id}/content`, {
    data: {
      kind: 'markdown',
      title: 'Вивід',
      bodyMd: 'Функція print виводить текст на екран. Функція input читає рядок.',
    },
  });

  // the course page lists the shortage, the node page the empty bank
  await page.goto(`/courses/${versionId}`);
  await expect(page.getByTestId('pool-issues')).toContainText('Недостатньо перевірених питань');
  await page.getByTestId('pool-issues').locator('summary').click();
  await expect(page.getByTestId('pool-issues')).toContainText('0 of 4 validated questions');

  await page.goto(`/courses/${versionId}/nodes/${node.id}`);
  const bank = page.getByTestId('question-bank');
  await expect(bank.getByText('Питань ще немає.').first()).toBeVisible();

  // a manual multiple-choice question
  const add = bank.getByTestId('question-add-form');
  await add.getByLabel('Питання', { exact: true }).fill('Що робить функція print?');
  await add.getByLabel(/Варіанти/).fill('Читає файл\nВиводить текст на екран');
  await add.getByLabel('Номер правильного варіанта').fill('2');
  await add.getByRole('button', { name: 'Додати питання' }).click();
  const q = bank.getByTestId('question').filter({ hasText: 'Що робить функція print?' });
  await expect(q).toBeVisible();
  await expect(q.locator('strong')).toHaveText('Виводить текст на екран');

  // the author's call works whether or not a worker has validated it yet
  await q.getByRole('button', { name: 'Відхилити' }).click();
  await expect(q.getByTestId('question-status')).toHaveText('Відхилено');
  await q.getByRole('button', { name: 'Схвалити' }).click();
  await expect(q.getByTestId('question-status')).toHaveText('Перевірено');
  await expect(bank.getByTestId('pool-summary').locator('tbody tr').first()).toContainText(
    /\d з 4/,
  );

  // editing sends it back for validation; a key outside the options is refused
  await q.getByText('Редагувати').click();
  const edit = q.getByTestId('question-edit-form');
  await edit.getByLabel('Номер правильного варіанта').fill('5');
  await edit.getByRole('button', { name: 'Зберегти' }).click();
  await expect(edit.getByRole('alert')).toContainText('one of the options');
  await edit.getByLabel('Номер правильного варіанта').fill('1');
  await edit.getByRole('button', { name: 'Зберегти' }).click();
  await expect(q.locator('strong')).toHaveText('Читає файл');
  await expect(q.getByTestId('question-status')).not.toHaveText('Перевірено');
  await page.screenshot({ path: '.local-agent/proof/m04/question-bank.png', fullPage: true });
});
