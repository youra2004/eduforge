import { loadConfig, login } from '@eduforge/core';
import { clientIp, getDb, readJson, route, setSessionCookie } from '@/lib/server';

export const POST = route(async (req: Request) => {
  const { auth } = loadConfig();
  const { user, token, expiresAt } = await login(
    getDb(),
    auth,
    await readJson(req),
    clientIp(req, auth.trustedProxyHops),
  );
  await setSessionCookie(token, expiresAt);
  return Response.json({ user });
});
