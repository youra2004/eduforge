import { createLLMClient, runRecommendationsNow } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The admin starts the daily recommendation job by hand and gets its result (F7-R3, D-32). */
export const POST = route(async () => {
  const db = getDb();
  const run = await runRecommendationsNow(db, await getCurrentUser(), createLLMClient(db));
  return Response.json({ run });
});
