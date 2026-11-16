import { cookies } from 'next/headers';
import { AuthError, CourseError, getSessionUser, loadConfig, type AuthUser } from '@eduforge/core';
import { createDb, type Db } from '@eduforge/db';
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

/**
 * The client IP as seen by the `hops`-th trusted proxy from the right of X-Forwarded-For.
 * Anything further left is client-supplied and spoofable; with hops = 0 the header is ignored.
 */
export function clientIp(req: Request, hops: number): string | undefined {
  if (hops < 1) return undefined;
  const parts =
    req.headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((p) => p.trim()) ?? [];
  return parts[parts.length - hops] || undefined;
}

export async function readJson(req: Request): Promise<unknown> {
  // Browsers cannot send application/json cross-site without a CORS preflight, which blocks login CSRF.
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AuthError('invalid_input');
  }
  try {
    return await req.json();
  } catch {
    throw new AuthError('invalid_input');
  }
}

/** `readJson` for course endpoints: a bad body is reported as a course problem, not as a login one. */
export async function readCourseJson(req: Request): Promise<unknown> {
  try {
    return await readJson(req);
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    throw new CourseError('invalid_course', [
      { code: 'schema', message: 'The body must be valid JSON sent as application/json.' },
    ]);
  }
}

/** Wraps a route handler so AuthErrors and CourseErrors become JSON with the right status and a Ukrainian message. */
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
      if (err instanceof CourseError) {
        return Response.json(
          { error: err.code, message: errorMessages[err.code], issues: err.issues },
          { status: err.status },
        );
      }
      console.error(err);
      return Response.json({ error: 'internal', message: errorMessages.internal }, { status: 500 });
    }
  };
}
