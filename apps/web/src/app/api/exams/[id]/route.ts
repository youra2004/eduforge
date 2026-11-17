import { examSettings, getExam } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return Response.json({
    exam: await getExam(getDb(), await getCurrentUser(), id, examSettings()),
  });
});
