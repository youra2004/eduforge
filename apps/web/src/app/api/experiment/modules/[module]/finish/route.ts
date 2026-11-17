import { finishLearning } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Control condition: "I am done with the material". The method condition ends only by passing every node. */
export const POST = route(
  async (_req: Request, { params }: { params: Promise<{ module: string }> }) => {
    const { module } = await params;
    await finishLearning(getDb(), await getCurrentUser(), module);
    return Response.json({ finished: true });
  },
);
