import { decideQuestion } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const question = await decideQuestion(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  return Response.json({ question });
});
