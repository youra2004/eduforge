import { getAssessment, learningSettings } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return Response.json({
    assessment: await getAssessment(getDb(), await getCurrentUser(), id, learningSettings()),
  });
});
