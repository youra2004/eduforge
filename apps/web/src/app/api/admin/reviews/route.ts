import { assignExpert } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

/** An admin assigns an expert to a version in `expert_review`: `{ versionId, expertId }`. */
export const POST = route(async (req: Request) => {
  const body = (await readCourseJson(req)) as { versionId?: unknown; expertId?: unknown } | null;
  const result = await assignExpert(getDb(), await getCurrentUser(), {
    versionId: body?.versionId,
    expertId: body?.expertId,
  });
  return Response.json(result, { status: 201 });
});
