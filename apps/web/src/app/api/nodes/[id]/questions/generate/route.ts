import { loadConfig, planGeneration } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';
import { queueGenerateQuestions } from '@/lib/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Queues generation for the worker; the new questions appear in the node's list once it has run. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const job = await planGeneration(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
    loadConfig().questions,
  );
  const { alreadyQueued } = await queueGenerateQuestions(job);
  return Response.json({ queued: job, alreadyQueued }, { status: 202 });
});
