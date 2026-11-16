import { createContentItem, listNodeContent } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';
import { queueContentWork } from '@/lib/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await listNodeContent(getDb(), await getCurrentUser(), id));
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const item = await createContentItem(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  await queueContentWork(item);
  return Response.json({ item }, { status: 201 });
});
