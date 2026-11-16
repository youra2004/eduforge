import type { Role } from '@eduforge/db';

export type AuthErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'email_taken'
  | 'not_found'
  | 'last_admin';

const httpStatus: Record<AuthErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_input: 400,
  invalid_credentials: 401,
  rate_limited: 429,
  email_taken: 409,
  not_found: 404,
  last_admin: 409,
};

export class AuthError extends Error {
  readonly status: number;
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.status = httpStatus[code];
  }
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
}

export function hasRole(user: AuthUser | null | undefined, ...allowed: Role[]): boolean {
  return !!user && user.roles.some((r) => allowed.includes(r));
}

/** The server-side role guard (P1): 401 without a user, 403 if the user holds none of `allowed`. */
export function requireRole(user: AuthUser | null | undefined, ...allowed: Role[]): AuthUser {
  if (!user) throw new AuthError('unauthenticated');
  if (!hasRole(user, ...allowed)) throw new AuthError('forbidden');
  return user;
}
