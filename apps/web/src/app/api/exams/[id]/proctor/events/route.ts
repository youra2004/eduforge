import { examSettings, reportEvents } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** What the browser saw (fullscreen, focus, copy/paste, devtools, faces, typing). The server decides what each one means (F9-R8). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const result = await reportEvents(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
    examSettings().proctor,
  );
  return Response.json(result);
});
