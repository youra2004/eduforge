import { listCourseVersions } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  return Response.json({ versions: await listCourseVersions(getDb(), await getCurrentUser()) });
});
