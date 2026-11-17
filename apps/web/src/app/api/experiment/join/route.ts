import { joinExperiment } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Informed consent → pseudonym and counterbalanced assignment (D-30). Body: `{ "consent": true }`. */
export const POST = route(async (req: Request) => {
  const participation = await joinExperiment(
    getDb(),
    await getCurrentUser(),
    await readCourseJson(req),
  );
  return Response.json({ participation }, { status: 201 });
});
