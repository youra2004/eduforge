import { learningSettings, startNodeTest } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Starts the node test, or returns the one already running. Time and rules come from the server only (P1). */
export const POST = route(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const assessment = await startNodeTest(getDb(), await getCurrentUser(), id, learningSettings());
    return Response.json({ assessment }, { status: 201 });
  },
);
