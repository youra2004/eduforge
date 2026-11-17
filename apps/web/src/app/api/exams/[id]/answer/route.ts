import { answerExam, createLLMClient, examSettings } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** The answer is graded and timed on the server; the request carries no time and no verdict (P1). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await readCourseJson(req)) as { itemId?: string; answer?: unknown } | null;
  const db = getDb();
  const exam = await answerExam(
    db,
    createLLMClient(db),
    await getCurrentUser(),
    id,
    String(body?.itemId ?? ''),
    body?.answer,
    examSettings(),
  );
  return Response.json({ exam });
});
