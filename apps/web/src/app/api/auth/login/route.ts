import { login, loadConfig } from '@eduforge/core';
import { clientIp, getDb, readJson, route, setSessionCookie } from '@/lib/server';

export const POST = route(async (req: Request) => {
  const { user, token, expiresAt } = await login(
    getDb(),
    loadConfig().auth,
    await readJson(req),
    clientIp(req),
  );
  await setSessionCookie(token, expiresAt);
  return Response.json({ user });
});
