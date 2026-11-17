import { examSettings, interruptExam } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** A technical interruption (network, camera): no strike, at most `EXAM_MAX_INTERRUPTIONS` per attempt (F8-R6). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await readCourseJson(req)) as { reason?: unknown } | null;
  const exam = await interruptExam(
    getDb(),
    await getCurrentUser(),
    id,
    body?.reason,
    examSettings(),
  );
  return Response.json({ exam });
});
