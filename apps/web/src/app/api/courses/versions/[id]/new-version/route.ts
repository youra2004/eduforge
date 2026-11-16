import { createNewVersion } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  await readCourseJson(req); // no fields yet, but the JSON content type blocks cross-site form posts
  const { id } = await params;
  return Response.json(await createNewVersion(getDb(), await getCurrentUser(), id), {
    status: 201,
  });
});
