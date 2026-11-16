import { assignRole, removeRole } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string; role: string }> };

export const PUT = route(async (_req: Request, { params }: Ctx) => {
  const { id, role } = await params;
  await assignRole(getDb(), await getCurrentUser(), id, role);
  return Response.json({ ok: true });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id, role } = await params;
  await removeRole(getDb(), await getCurrentUser(), id, role);
  return Response.json({ ok: true });
});
