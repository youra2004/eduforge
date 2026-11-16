import { createSession, loadConfig, register } from '@eduforge/core';
import { getDb, readJson, route, setSessionCookie } from '@/lib/server';

export const POST = route(async (req: Request) => {
  const db = getDb();
  const user = await register(db, await readJson(req));
  const session = await createSession(db, user.id, loadConfig().auth.sessionTtlSeconds);
  await setSessionCookie(session.token, session.expiresAt);
  return Response.json({ user }, { status: 201 });
});
