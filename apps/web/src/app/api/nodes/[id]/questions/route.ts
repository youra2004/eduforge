import { createQuestion, listNodeQuestions, loadConfig } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';
import { queueValidateQuestion } from '@/lib/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await listNodeQuestions(getDb(), await getCurrentUser(), id));
});

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const question = await createQuestion(
    getDb(),
    await getCurrentUser(),
    id,
    await readCourseJson(req),
    { slip: loadConfig().bkt.slip },
  );
  await queueValidateQuestion(question.id);
  return Response.json({ question }, { status: 201 });
});
