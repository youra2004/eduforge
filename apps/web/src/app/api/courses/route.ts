import { createCourse, listCourseVersions } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  return Response.json({ versions: await listCourseVersions(getDb(), await getCurrentUser()) });
});

/** An author (or admin) starts a new course: an empty draft the editor fills. */
export const POST = route(async (req: Request) => {
  return Response.json(
    await createCourse(getDb(), await getCurrentUser(), await readCourseJson(req)),
    {
      status: 201,
    },
  );
});
