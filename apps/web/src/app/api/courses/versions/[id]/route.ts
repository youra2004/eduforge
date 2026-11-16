import { getVersionGraph, updateVersion } from '@eduforge/core';
import { getCurrentUser, getDb, readJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(await getVersionGraph(getDb(), await getCurrentUser(), id));
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json({
    version: await updateVersion(getDb(), await getCurrentUser(), id, await readJson(req)),
  });
});
