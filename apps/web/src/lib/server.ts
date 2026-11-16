import { cookies } from 'next/headers';
import { AuthError, getSessionUser, loadConfig, requireRole, type AuthUser } from '@eduforge/core';
import { createDb, type Db, type Role } from '@eduforge/db';
import { errorMessages } from './messages';

export const SESSION_COOKIE = 'eduforge_session';

const globalForDb = globalThis as unknown as { eduforgeDb?: Db };

/** One pool per server process (survives dev hot reloads). */
export function getDb(): Db {
  globalForDb.eduforgeDb ??= createDb(loadConfig().databaseUrl).db;
  return globalForDb.eduforgeDb;
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The signed-in user, or null. The server is the only place this is decided (P1). */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  return token ? getSessionUser(getDb(), token) : null;
}

/** For route handlers: the current user, or an AuthError (401/403) if they lack every role. */
export async function requireApiRole(...roles: Role[]): Promise<AuthUser> {
  return requireRole(await getCurrentUser(), ...roles);
}

export function clientIp(req: Request): string | undefined {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AuthError('invalid_input');
  }
}

/** Wraps a route handler so AuthErrors become JSON with the right status and a Ukrainian message. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AuthError) {
        return Response.json(
          { error: err.code, message: errorMessages[err.code] },
          { status: err.status },
        );
      }
      console.error(err);
      return Response.json({ error: 'internal', message: errorMessages.internal }, { status: 500 });
    }
  };
}
