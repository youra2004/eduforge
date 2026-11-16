import { importCourse, requireRole } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const POST = route(async (req: Request) => {
  const admin = requireRole(await getCurrentUser(), 'admin');
  const result = await importCourse(getDb(), await readCourseJson(req), admin.id);
  return Response.json(result, { status: 201 });
});
