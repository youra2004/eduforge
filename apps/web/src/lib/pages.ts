import { forbidden, redirect } from 'next/navigation';
import { hasRole, type AuthUser } from '@eduforge/core';
import type { Role } from '@eduforge/db';
import { getCurrentUser } from './server';

/** For server-rendered pages: sends guests to /login and shows 403 to users without the role. */
export async function requirePageRole(...roles: Role[]): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!hasRole(user, ...roles)) forbidden();
  return user;
}
