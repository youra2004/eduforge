import { logout } from '@eduforge/core';
import { clearSessionCookie, getDb, getSessionToken, route } from '@/lib/server';

export const POST = route(async () => {
  const token = await getSessionToken();
  if (token) await logout(getDb(), token);
  await clearSessionCookie();
  return Response.json({ ok: true });
});
