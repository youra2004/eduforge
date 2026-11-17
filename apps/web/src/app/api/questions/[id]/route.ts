import { updateQuestion } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';
import { queueValidateQuestion } from '@/lib/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const question = await updateQuestion(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
  );
  await queueValidateQuestion(question.id);
  return Response.json({ question });
});
