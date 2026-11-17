import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';

// The audit runs in the worker: start it first (`pnpm --filter @eduforge/worker start`).
if (existsSync('.env')) process.loadEnvFile('.env');

const PASSWORD = 'correct horse battery';
const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const proof = '.local-agent/proof/m08';
mkdirSync(proof, { recursive: true });

type Fixture = {
  course: { nodes: { key: string; title: string }[] } & Record<string, unknown>;
  content: Record<string, string>;
  difficulty: number;
};
const fixtures = JSON.parse(
  readFileSync('packages/core/seed/audit-fixtures.json', 'utf8'),
) as Record<'good' | 'offTopic' | 'uncoveredSkill', Fixture>;

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Creates an admin through the CLI and signs in a browser context as them. */
async function adminContext(browser: Browser) {
  const email = `admin-${uniq()}@e2e.local`;
  execFileSync('pnpm', ['create-admin', email, 'Адмін'], {
    env: { ...process.env, ADMIN_PASSWORD: PASSWORD },
    stdio: 'pipe',
  });
  const ctx = await browser.newContext();
  const login = await ctx.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);
  return ctx;
}

/** Registers a user in a fresh context and, through the admin's session, gives them the roles. */
async function userWith(
  browser: Browser,
  admin: BrowserContext,
  name: string,
  roles: string[],
): Promise<{ ctx: BrowserContext; page: Page; id: string; email: string }> {
  const email = `${roles[0] ?? 'user'}-${uniq()}@e2e.local`;
  const ctx = await browser.newContext();
  const reg = await ctx.request.post('/api/auth/register', {
    data: { email, password: PASSWORD, displayName: name, acceptTerms: true },
  });
  expect(reg.status()).toBe(201);
  const { users } = await (await admin.request.get('/api/admin/users')).json();
  const id = users.find((u: { email: string }) => u.email === email).id as string;
  for (const role of roles) {
    expect((await admin.request.put(`/api/admin/users/${id}/roles/${role}`)).status()).toBe(200);
  }
  return { ctx, page: await ctx.newPage(), id, email };
}

/** Builds a fixture course through the author's own API calls, like the editor does, and fills the pools. */
async function buildCourse(page: Page, which: keyof typeof fixtures) {
  const f = fixtures[which];
  const created = await page.request.post('/api/courses', {
    data: {
      slug: `audit-e2e-${uniq()}`,
      title: String(f.course.title),
      description: String(f.course.description),
      declaredLevel: 'junior',
    },
  });
  expect(created.status()).toBe(201);
  const { versionId } = await created.json();
  const op = async (data: Record<string, unknown>) => {
    const res = await page.request.post(`/api/courses/versions/${versionId}/graph`, { data });
    expect(res.status()).toBe(200);
    return res.json();
  };
  const skillIds = new Map<string, string>();
  for (const s of f.course.skills as { key: string; name: string; description: string }[]) {
    skillIds.set(
      s.key,
      (await op({ op: 'add_skill', name: s.name, description: s.description })).skillId,
    );
  }
  const nodeIds = new Map<string, string>();
  for (const n of f.course.nodes as {
    key: string;
    title: string;
    summary: string;
    skills: string[];
  }[]) {
    const { nodeId } = await op({
      op: 'add_node',
      title: n.title,
      summary: n.summary,
      skillIds: n.skills.map((k) => skillIds.get(k)),
    });
    nodeIds.set(n.key, nodeId);
    const res = await page.request.post(`/api/nodes/${nodeId}/content`, {
      data: { kind: 'markdown', title: n.title, bodyMd: f.content[n.key] },
    });
    expect(res.status()).toBe(201);
  }
  for (const e of f.course.edges as { from: string; to: string }[]) {
    await op({ op: 'add_edge', from: nodeIds.get(e.from), to: nodeIds.get(e.to) });
  }
  await fillPools(versionId, f.difficulty);
  return { versionId, nodeIds, skillIds };
}

/** Stands in for the question generator: 4 validated node questions per node skill and 3 exam questions per skill. */
async function fillPools(versionId: string, difficulty: number) {
  await sql(
    `INSERT INTO questions (node_id, skill_id, pool, kind, prompt_md, options, answer_key, difficulty, guess, status)
     SELECT ns.node_id, ns.skill_id, p.pool::question_pool, 'mcq', 'Питання №' || g.i, '["Так", "Ні"]'::jsonb,
            '{"optionIndex": 0}'::jsonb, $2, 0.5, 'validated'
     FROM node_skills ns
     JOIN nodes n ON n.id = ns.node_id AND n.course_version_id = $1
     CROSS JOIN (VALUES ('node', 4), ('exam', 3)) AS p(pool, n)
     CROSS JOIN LATERAL generate_series(1, p.n) AS g(i)`,
    [versionId, difficulty],
  );
}

/** A 20-node course whose text is long enough for the Mock to call it expert level: the size allows rating 10. */
async function seedBigCourse(authorId: string) {
  const [course] = await sql<{ id: string }>(
    'INSERT INTO courses (author_id, slug) VALUES ($1, $2) RETURNING id',
    [authorId, `audit-big-${uniq()}`],
  );
  const [version] = await sql<{ id: string }>(
    `INSERT INTO course_versions (course_id, version_no, title, description, declared_level)
     VALUES ($1, 1, 'Просунутий Python', 'Курс про змінні, цикли та функції мови Python.', 'expert') RETURNING id`,
    [course!.id],
  );
  const v = version!.id;
  await sql(
    `INSERT INTO skills (course_version_id, name, description)
     SELECT $1, 'Функції ' || g.i, 'Тема ' || g.i FROM generate_series(1, 20) AS g(i)`,
    [v],
  );
  await sql(
    `INSERT INTO nodes (course_version_id, title, summary)
     SELECT $1, 'Тема ' || lpad(g.i::text, 2, '0'), 'Глибока тема' FROM generate_series(1, 20) AS g(i)`,
    [v],
  );
  await sql(
    `INSERT INTO node_skills (node_id, skill_id)
     SELECT n.id, s.id FROM nodes n JOIN skills s ON s.course_version_id = n.course_version_id
       AND s.name = 'Функції ' || ltrim(substr(n.title, 6), '0') WHERE n.course_version_id = $1`,
    [v],
  );
  await sql(
    `INSERT INTO node_edges (prereq_node_id, node_id)
     SELECT a.id, b.id FROM nodes a JOIN nodes b ON b.course_version_id = a.course_version_id
       AND b.title = 'Тема ' || lpad((substr(a.title, 6)::int + 1)::text, 2, '0')
     WHERE a.course_version_id = $1`,
    [v],
  );
  await sql(
    `INSERT INTO content_items (node_id, kind, title, ord, body_md)
     SELECT id, 'markdown', title, 0,
            repeat('Змінні, цикли та функції в Python: докладний розбір із прикладами та складними випадками. ', 45)
     FROM nodes WHERE course_version_id = $1`,
    [v],
  );
  await fillPools(v, 0.8);
  return v;
}

const openCourse = (page: Page, versionId: string) => page.goto(`/courses/${versionId}`);

test('an author builds a course in the editor, passes the audit, publishes; a student sees the rating', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await adminContext(browser);
  const author = await userWith(browser, admin, 'Автор Олена', ['author']);
  const page = author.page;

  // create the course in the UI
  await page.goto('/author');
  await expect(page.getByTestId('no-courses')).toBeVisible();
  const slug = `audit-ui-${uniq()}`;
  const form = page.getByTestId('create-course-form');
  await form.getByLabel('Назва курсу').fill('Основи Python');
  await form.getByLabel(/Адреса/).fill(slug);
  await form.getByLabel(/Опис/).fill('Курс про змінні, цикли та функції мови Python.');
  await form.getByLabel('Заявлений рівень').selectOption('junior');
  await page.screenshot({ path: `${proof}/01-author-new-course.png`, fullPage: true });
  await form.getByRole('button', { name: 'Створити курс' }).click();
  await expect(page.getByRole('heading', { name: /Основи Python/ })).toBeVisible();
  const versionId = page.url().split('/').pop()!;
  const editor = page.getByTestId('graph-editor');
  await expect(editor).toBeVisible();

  // skills and nodes through the editor's forms
  for (const name of ['Змінні', 'Цикли', 'Функції']) {
    await editor.getByTestId('add-skill-form').getByLabel('Нова навичка').fill(name);
    await editor
      .getByTestId('add-skill-form')
      .getByRole('button', { name: 'Додати навичку' })
      .click();
    await expect(
      editor.getByTestId('skill-list').getByLabel(`Назва навички ${name}`),
    ).toBeVisible();
  }
  const nodeTitles = ['Змінні та типи', 'Цикли', 'Функції'];
  for (const title of nodeTitles) {
    await editor.getByTestId('add-node-form').getByLabel('Назва нового вузла').fill(title);
    await editor.getByTestId('add-node-form').getByRole('button', { name: 'Додати вузол' }).click();
    await expect(page.getByTestId('graph-node').filter({ hasText: title })).toBeVisible();
  }

  // select a node, give it a skill
  const skillOf: Record<string, string> = {
    'Змінні та типи': 'Змінні',
    Цикли: 'Цикли',
    Функції: 'Функції',
  };
  for (const title of nodeTitles) {
    await page
      .getByTestId('graph-node')
      .filter({ hasText: title })
      .locator('.graph-node-skills')
      .click(); // the title itself is a link to the node
    const nodeForm = editor.getByTestId('node-form');
    await expect(nodeForm.getByRole('heading', { name: `Вузол «${title}»` })).toBeVisible();
    await nodeForm.getByLabel(skillOf[title]!, { exact: true }).check();
    await nodeForm.getByRole('button', { name: 'Зберегти вузол' }).click();
    await expect(
      page.getByTestId('graph-node').filter({ hasText: title }).locator('.graph-node-skills'),
    ).toHaveText(skillOf[title]!);
  }

  // a prerequisite drawn on the canvas, and one added by the form
  const [vars, loops] = [
    page.getByTestId('graph-node').filter({ hasText: 'Змінні та типи' }),
    page.getByTestId('graph-node').filter({ hasText: /^Цикли/ }),
  ];
  const source = vars.locator('.react-flow__handle.source');
  const target = loops.locator('.react-flow__handle.target');
  await source.hover();
  await page.mouse.down();
  await target.hover();
  await page.mouse.up();
  await expect(editor.getByTestId('edge-list').locator('li')).toHaveCount(1);
  await editor
    .getByTestId('add-edge-form')
    .getByLabel('Спершу пройти')
    .selectOption({ label: 'Цикли' });
  await editor
    .getByTestId('add-edge-form')
    .getByLabel('Щоб відкрити')
    .selectOption({ label: 'Функції' });
  await editor
    .getByTestId('add-edge-form')
    .getByRole('button', { name: 'Додати передумову' })
    .click();
  await expect(editor.getByTestId('edge-list').locator('li')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // a cycle is refused with a reason, and nothing changes
  await editor
    .getByTestId('add-edge-form')
    .getByLabel('Спершу пройти')
    .selectOption({ label: 'Функції' });
  await editor
    .getByTestId('add-edge-form')
    .getByLabel('Щоб відкрити')
    .selectOption({ label: 'Змінні та типи' });
  await editor
    .getByTestId('add-edge-form')
    .getByRole('button', { name: 'Додати передумову' })
    .click();
  await expect(editor.getByTestId('editor-errors')).toContainText('cycle');
  await expect(editor.getByTestId('edge-list').locator('li')).toHaveCount(2);
  await page.screenshot({ path: `${proof}/02-editor-graph.png`, fullPage: true });

  // an audit of a course without material is refused, with the reasons, and costs no run
  await page.getByTestId('submit-audit').click();
  await expect(page.getByTestId('audit-errors')).toContainText('has no content');
  await expect(page.getByTestId('audit-section')).toContainText(
    'використано запусків аудиту: 0 з 5',
  );
  await page.screenshot({ path: `${proof}/03-audit-refused.png`, fullPage: true });

  // material (as the node editor saves it) and question pools
  const graph = await (await page.request.get(`/api/courses/versions/${versionId}`)).json();
  const good = fixtures.good;
  for (const n of good.course.nodes) {
    const node = graph.nodes.find((g: { title: string }) => g.title === n.title);
    await page.request.post(`/api/nodes/${node.id}/content`, {
      data: { kind: 'markdown', title: n.title, bodyMd: good.content[n.key] },
    });
  }
  await fillPools(versionId, good.difficulty);

  // the audit runs in the worker; the page follows it
  await openCourse(page, versionId);
  await page.getByTestId('submit-audit').click();
  await expect(page.getByTestId('audit-running')).toBeVisible();
  await page.screenshot({ path: `${proof}/04-audit-running.png`, fullPage: true });
  await expect(page.getByTestId('audit-score')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('version-status')).toHaveText('Готово до публікації');
  await expect(page.getByTestId('audit-rating')).toHaveText('3'); // the 3-node course is capped by its size
  await expect(page.getByTestId('audit-level')).toContainText('Middle');
  await expect(page.getByTestId('volume-note')).toBeVisible();
  await expect(page.getByTestId('audit-feedback')).toContainText('Глибина теорії');
  await expect(page.getByTestId('skill-verification')).toContainText('✓ покрито');
  await expect(page.getByText(/volume|cap\b/i)).toHaveCount(0); // thresholds are not shown
  await expect(page.getByTestId('audit-section')).toContainText(
    'використано запусків аудиту: 1 з 5',
  );
  await page.screenshot({ path: `${proof}/05-audit-result.png`, fullPage: true });

  // the author is told
  await page.goto('/notifications');
  await expect(page.getByTestId('notification').first()).toContainText(
    'Аудит курсу «Основи Python» завершено: рейтинг 3',
  );
  await page.screenshot({ path: `${proof}/06-notifications.png`, fullPage: true });

  // publish: the version is frozen
  await openCourse(page, versionId);
  await page.getByTestId('publish').click();
  await expect(page.getByTestId('version-status')).toHaveText('Опубліковано');
  await expect(page.getByTestId('graph-editor')).toHaveCount(0);
  await expect(page.getByTestId('course-rating')).toContainText('3/10');
  const patch = await page.request.patch(`/api/courses/versions/${versionId}`, {
    data: { title: 'Інша' },
  });
  expect(patch.status()).toBe(409);
  const edit = await page.request.post(`/api/courses/versions/${versionId}/graph`, {
    data: { op: 'add_skill', name: 'Нова' },
  });
  expect(edit.status()).toBe(409);
  await page.screenshot({ path: `${proof}/07-published.png`, fullPage: true });

  // the student sees the rating in the catalog and on the course page
  const student = await userWith(browser, admin, 'Студентка', ['student']);
  await student.page.goto('/courses');
  const row = student.page
    .getByRole('row')
    .filter({ has: student.page.locator(`a[href="/courses/${versionId}"]`) });
  await expect(row.getByTestId('catalog-rating')).toContainText('3/10');
  await student.page.screenshot({ path: `${proof}/08-student-catalog.png`, fullPage: true });
  await student.page.locator(`a[href="/courses/${versionId}"]`).click();
  await expect(student.page.getByTestId('course-rating')).toContainText('3/10');
  await expect(student.page.getByTestId('audit-section')).toHaveCount(0); // the audit is the author's
  await student.page.screenshot({ path: `${proof}/09-student-course.png`, fullPage: true });

  // a new version goes through the audit again
  await page.getByTestId('new-version').click();
  await expect(page.getByTestId('graph-editor')).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`${versionId}$`));
  await expect(page.getByTestId('version-status')).toHaveText('Чернетка');
  await expect(page.getByTestId('audit-section')).toContainText(
    'використано запусків аудиту: 0 з 5',
  );
  await expect(page.getByTestId('course-rating')).toHaveCount(0);
  await page.screenshot({ path: `${proof}/10-new-version.png`, fullPage: true });
  await page.getByTestId('submit-audit').click();
  await expect(page.getByTestId('audit-score')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('version-status')).toHaveText('Готово до публікації');

  await student.ctx.close();
  await author.ctx.close();
  await admin.close();
});

test('a course that does not match its description, or leaves a skill uncovered, goes back with the reasons', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const admin = await adminContext(browser);
  const author = await userWith(browser, admin, 'Автор Іван', ['author']);
  const page = author.page;

  const off = await buildCourse(page, 'offTopic');
  await openCourse(page, off.versionId);
  await page.getByTestId('submit-audit').click();
  await expect(page.getByTestId('audit-failure')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('version-status')).toHaveText('Потрібні зміни');
  await expect(page.getByTestId('audit-failure')).toContainText(
    'Матеріали не відповідають опису курсу',
  );
  await expect(page.getByTestId('mismatches').locator('li').first()).toContainText('Опис обіцяє');
  await expect(page.getByTestId('audit-score')).toHaveCount(0);
  await expect(page.getByTestId('graph-editor')).toBeVisible(); // editable again
  await page.screenshot({ path: `${proof}/11-audit-mismatch.png`, fullPage: true });

  const gap = await buildCourse(page, 'uncoveredSkill');
  await openCourse(page, gap.versionId);
  await page.getByTestId('submit-audit').click();
  await expect(page.getByTestId('uncovered-skills')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('uncovered-skills')).toContainText('Асинхронність');
  await expect(page.getByTestId('skill-verification')).toContainText('✗ не покрито');
  await page.screenshot({ path: `${proof}/12-audit-uncovered-skill.png`, fullPage: true });

  // the sixth run on a version is refused
  await sql('UPDATE course_versions SET audit_attempts = 5 WHERE id = $1', [gap.versionId]);
  const sixth = await page.request.post(`/api/courses/versions/${gap.versionId}/audit`, {
    data: {},
  });
  expect(sixth.status()).toBe(409);
  expect((await sixth.json()).error).toBe('audit_limit_reached');
  await openCourse(page, gap.versionId);
  await expect(page.getByTestId('new-version')).toBeVisible();
  await expect(page.getByTestId('submit-audit')).toHaveCount(0);
  await page.screenshot({ path: `${proof}/13-audit-limit.png`, fullPage: true });

  await author.ctx.close();
  await admin.close();
});

test('rating 10: an admin assigns an expert, who checks the course; the author is told and chooses', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const admin = await adminContext(browser);
  const author = await userWith(browser, admin, 'Автор Марія', ['author']);
  const expertName = `Експерт ${uniq()}`;
  const expert = await userWith(browser, admin, expertName, ['expert']);
  const adminPage = await admin.newPage();

  // two candidates for 10 (the first is approved, the second rejected)
  const versions = [await seedBigCourse(author.id), await seedBigCourse(author.id)];
  const [first, second] = versions as [string, string];

  await openCourse(author.page, first);
  await author.page.getByTestId('submit-audit').click();
  await expect(author.page.getByTestId('expert-review-status')).toBeVisible({ timeout: 120_000 });
  await expect(author.page.getByTestId('version-status')).toHaveText('Експертна перевірка');
  await expect(author.page.getByTestId('audit-rating-pending')).toBeVisible();
  await expect(author.page.getByTestId('publish')).toHaveCount(0); // not without the expert
  await author.page.screenshot({ path: `${proof}/14-expert-review-pending.png`, fullPage: true });
  await author.page.goto('/notifications');
  await expect(author.page.getByTestId('notification').first()).toContainText(
    'кандидат на найвищий рейтинг',
  );

  // the admin's queue
  const queueRow = (versionId: string) =>
    adminPage
      .getByTestId('review-queue')
      .getByRole('row')
      .filter({ has: adminPage.locator(`a[href="/courses/${versionId}"]`) });
  await adminPage.goto('/admin');
  await expect(queueRow(first)).toContainText('Очікує призначення');
  await adminPage.screenshot({ path: `${proof}/15-admin-queue.png`, fullPage: true });
  await queueRow(first)
    .getByRole('combobox', { name: 'Експерт' })
    .selectOption({ label: expertName });
  await queueRow(first).getByRole('button', { name: 'Призначити' }).click();
  await expect(queueRow(first)).toContainText('Призначено експерта');
  await adminPage.screenshot({ path: `${proof}/16-admin-assigned.png`, fullPage: true });

  // the expert is told and opens the review
  await expert.page.goto('/notifications');
  await expect(expert.page.getByTestId('notification').first()).toContainText(
    'призначено перевірку курсу',
  );
  await expert.page.goto('/expert');
  await expect(expert.page.getByTestId('review-queue')).toContainText('Просунутий Python');
  await expert.page.screenshot({ path: `${proof}/17-expert-queue.png`, fullPage: true });
  await expert.page.getByRole('link', { name: 'Просунутий Python' }).first().click();
  await expect(expert.page.getByTestId('review-audit')).toContainText('Expert');

  // an incomplete decision is refused; a full one is saved
  const reviewForm = expert.page.getByTestId('review-form');
  await reviewForm.getByRole('button', { name: 'Схвалити рейтинг 10' }).click();
  await expect(reviewForm.getByRole('alert')).toContainText('every item is ticked');
  await reviewForm.getByRole('button', { name: 'Відхилити' }).click();
  await expect(reviewForm.getByRole('alert')).toContainText('comment');
  await expert.page.screenshot({
    path: `${proof}/18-expert-checklist-refused.png`,
    fullPage: true,
  });
  for (const box of await reviewForm.getByRole('checkbox').all()) await box.check();
  await reviewForm.getByLabel(/Коментар/).fill('Курс відповідає рівню експерта.');
  await expert.page.screenshot({ path: `${proof}/19-expert-checklist.png`, fullPage: true });
  await reviewForm.getByRole('button', { name: 'Схвалити рейтинг 10' }).click();
  await expect(expert.page.getByTestId('review-status')).toHaveText('Схвалено');

  // the author is told, the course has its 10 and can be published
  await author.page.goto('/notifications');
  await expect(author.page.getByTestId('notification').first()).toContainText(
    'Експерт схвалив курс',
  );
  await author.page.screenshot({ path: `${proof}/20-author-notified.png`, fullPage: true });
  await openCourse(author.page, first);
  await expect(author.page.getByTestId('audit-rating')).toHaveText('10');
  await author.page.getByTestId('publish').click();
  await expect(author.page.getByTestId('version-status')).toHaveText('Опубліковано');
  await expect(author.page.getByTestId('course-rating')).toContainText('10/10');
  await author.page.screenshot({ path: `${proof}/21-published-10.png`, fullPage: true });

  // the second candidate is rejected; the checklist reaches the author, who publishes with 9
  await openCourse(author.page, second);
  await author.page.getByTestId('submit-audit').click();
  await expect(author.page.getByTestId('expert-review-status')).toBeVisible({ timeout: 120_000 });
  await adminPage.goto('/admin');
  await queueRow(second)
    .getByRole('combobox', { name: 'Експерт' })
    .selectOption({ label: expertName });
  await queueRow(second).getByRole('button', { name: 'Призначити' }).click();
  await expect(queueRow(second)).toContainText('Призначено експерта');
  await expert.page.goto('/expert');
  await expert.page
    .getByTestId('review-queue')
    .getByRole('row', { name: /Призначено експерта/ })
    .getByRole('link')
    .click();
  const form2 = expert.page.getByTestId('review-form');
  await form2.getByLabel(/Коментар/).fill('Не вистачає складних випадків.');
  await form2.getByRole('button', { name: 'Відхилити' }).click();
  await expect(expert.page.getByTestId('review-status')).toHaveText('Відхилено');

  await openCourse(author.page, second);
  await expect(author.page.getByTestId('review-checklist')).toContainText(
    'Не вистачає складних випадків.',
  );
  await expect(author.page.getByTestId('review-checklist')).toContainText('✗');
  await expect(author.page.getByTestId('choose-improve')).toBeVisible();
  await author.page.screenshot({ path: `${proof}/22-rejected-choice.png`, fullPage: true });
  await author.page.getByTestId('choose-publish-9').click();
  await expect(author.page.getByTestId('version-status')).toHaveText('Опубліковано');
  await expect(author.page.getByTestId('course-rating')).toContainText('9/10');
  await author.page.screenshot({ path: `${proof}/23-published-9.png`, fullPage: true });

  await expert.ctx.close();
  await author.ctx.close();
  await admin.close();
});
