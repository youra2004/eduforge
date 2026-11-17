import { experimentSettings, recordClientEvent } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Browser-only research events: content opened, video progress, the learning-time heartbeat (RESEARCH.md §3). */
export const POST = route(async (req: Request) => {
  const result = await recordClientEvent(
    getDb(),
    await getCurrentUser(),
    await readCourseJson(req),
    experimentSettings(),
  );
  return Response.json(result);
});
