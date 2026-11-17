import { resolveRejection } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

/** After an expert rejects rating 10: `{ choice: "improve" | "publish_9" }`. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const version = await resolveRejection(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  return Response.json({ versionId: version.id, status: version.status, rating: version.rating });
});
