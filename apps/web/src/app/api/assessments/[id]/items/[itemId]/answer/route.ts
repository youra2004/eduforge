import { answerAssessment, createLLMClient, learningSettings } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id, itemId } = await params;
  const body = (await readCourseJson(req)) as { answer?: unknown } | null;
  const db = getDb();
  const result = await answerAssessment(
    db,
    createLLMClient(db),
    await getCurrentUser(),
    id,
    itemId,
    body?.answer,
    learningSettings(),
  );
  return Response.json(result);
});
