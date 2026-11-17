import { getAuditView, submitForAudit } from '@eduforge/core';
import { queueAudit } from '@/lib/queue';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await getAuditView(getDb(), await getCurrentUser(), id));
});

/** Sends the version to the audit; the worker runs it and the version leaves `auditing` when it is done. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  await readCourseJson(req);
  const { id } = await params;
  const job = await submitForAudit(getDb(), await getCurrentUser(), id);
  await queueAudit(job);
  return Response.json(job, { status: 202 });
});
