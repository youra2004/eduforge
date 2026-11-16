import { createNewVersion } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await createNewVersion(getDb(), await getCurrentUser(), id), {
    status: 201,
  });
});
