import {
  answerPractice,
  createLLMClient,
  getPracticeQuestion,
  learningSettings,
} from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** A free practice question; `?exclude=a,b` skips questions the page already showed. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const exclude = (new URL(req.url).searchParams.get('exclude') ?? '').split(',').filter(Boolean);
  return Response.json({
    question: await getPracticeQuestion(getDb(), await getCurrentUser(), id, exclude),
  });
});

/** Practice never changes mastery or progress (F5-R6). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = (await readCourseJson(req)) as { questionId?: string; answer?: unknown } | null;
  const db = getDb();
  const result = await answerPractice(
    db,
    createLLMClient(db),
    await getCurrentUser(),
    id,
    String(body?.questionId ?? ''),
    body?.answer,
    learningSettings(),
  );
  return Response.json(result);
});
