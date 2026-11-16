import { deleteContentItem, updateContentItem } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';
import { queueContentWork } from '@/lib/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const item = await updateContentItem(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  await queueContentWork(item);
  return Response.json({ item });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteContentItem(getDb(), await getCurrentUser(), id);
  return new Response(null, { status: 204 });
});
