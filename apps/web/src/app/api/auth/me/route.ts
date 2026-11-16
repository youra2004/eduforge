import { requireRole } from '@eduforge/core';
import { getCurrentUser, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = requireRole(await getCurrentUser(), 'student', 'author', 'expert', 'admin');
  return Response.json({ user });
});
