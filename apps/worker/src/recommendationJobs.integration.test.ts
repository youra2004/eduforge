import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLLMClient, recommendationSettings, seedDemo } from '@eduforge/core';
import { createDb, recommendations, users } from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { RECOMMENDATIONS_QUEUE, registerRecommendationJobs } from './recommendationJobs';

const url = process.env.TEST_DATABASE_URL!;
const { db, pool } = createDb(url);
const boss = new PgBoss(url);

beforeAll(async () => {
  await boss.start();
});
afterAll(async () => {
  await boss.stop();
  await pool.end();
});

describe('daily recommendations job (F7-R1, F7-R2)', () => {
  it('on its queue, stores tips for the seeded students', async () => {
    await seedDemo(db, { password: 'correct horse battery', suffix: '-worker' });
    await registerRecommendationJobs(boss, {
      db,
      llm: createLLMClient(db),
      settings: recommendationSettings(),
    });
    await boss.send(RECOMMENDATIONS_QUEUE, {});
    const [taras] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, 'demo-taras-worker@demo.eduforge.local'));
    await expect
      .poll(
        async () =>
          (await db.select().from(recommendations).where(eq(recommendations.userId, taras!.id)))
            .length,
        { timeout: 20_000, interval: 500 },
      )
      .toBe(1);
  });
});
