import { enroll, getProgress } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const POST = route(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const user = await getCurrentUser();
    await enroll(getDb(), user, id);
    return Response.json({ progress: await getProgress(getDb(), user, id) }, { status: 201 });
  },
);
