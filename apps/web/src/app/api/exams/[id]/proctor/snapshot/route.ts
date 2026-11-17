import { checkSnapshot, createProctorProvider, examSettings, loadConfig } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** One frame for the check against the reference photo and the Vision look. It is not stored unless it triggers an event (F9-R4, D-27). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const result = await checkSnapshot(
    getDb(),
    createProctorProvider(loadConfig()),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
    examSettings().proctor,
  );
  return Response.json(result);
});
