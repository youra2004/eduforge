import { listUsers } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  return Response.json({ users: await listUsers(getDb(), await getCurrentUser()) });
});
