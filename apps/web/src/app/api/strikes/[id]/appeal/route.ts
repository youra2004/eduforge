import { appealStrike, examSettings } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The student appeals a confirmed strike; an admin decides (F9-R6). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const strike = await appealStrike(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
    examSettings().proctor,
  );
  return Response.json({ strike: { id: strike.id, status: strike.status } });
});
