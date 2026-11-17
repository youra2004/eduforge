import { markAllRead } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const POST = route(async (req: Request) => {
  await readCourseJson(req);
  await markAllRead(getDb(), await getCurrentUser());
  return Response.json({ ok: true });
});
