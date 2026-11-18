import type { PgBoss } from 'pg-boss';
import {
  recommendationCron,
  runRecommendations,
  type RecommendationSettings,
} from '@eduforge/core';
import type { Db } from '@eduforge/db';
import type { LLMClient } from '@eduforge/llm';

export const RECOMMENDATIONS_QUEUE = 'recommendations.daily';

export interface RecommendationJobDeps {
  db: Db;
  llm: LLMClient;
  settings: RecommendationSettings;
}

/** The daily job (F7-R1): 06:00, or once per "day" of demo time when TIME_SCALE > 1 (D-32). */
export async function registerRecommendationJobs(boss: PgBoss, deps: RecommendationJobDeps) {
  await boss.createQueue(RECOMMENDATIONS_QUEUE, { policy: 'short', retryLimit: 2, retryDelay: 60 });
  await boss.work(RECOMMENDATIONS_QUEUE, { pollingIntervalSeconds: 5 }, async () => {
    const run = await runRecommendations(deps.db, deps.llm, new Date(), deps.settings);
    console.log(`[recommendations.daily] ${JSON.stringify(run.counts)}`);
  });
  await boss.schedule(RECOMMENDATIONS_QUEUE, recommendationCron(deps.settings.timeScale));
}
