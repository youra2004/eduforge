import { reopenVersion } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  await readCourseJson(req); // no fields, but the JSON content type blocks cross-site form posts
  const { id } = await params;
  const version = await reopenVersion(getDb(), await getCurrentUser(), id);
  return Response.json({ versionId: version.id, status: version.status, rating: version.rating });
});
