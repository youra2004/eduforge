import { describe, expect, it } from 'vitest';
import { AuthError, hasRole, requireRole, type AuthUser } from './guard';

const user = (...roles: AuthUser['roles']): AuthUser => ({
  id: 'u1',
  email: 'a@b.co',
  displayName: 'A',
  roles,
});

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AuthError ? `${err.code}:${err.status}` : 'other';
  }
  return 'none';
};

describe('role guard', () => {
  it('rejects a missing user with 401', () => {
    expect(codeOf(() => requireRole(null, 'student'))).toBe('unauthenticated:401');
    expect(codeOf(() => requireRole(undefined, 'admin'))).toBe('unauthenticated:401');
  });

  it('rejects a user without the role with 403', () => {
    expect(codeOf(() => requireRole(user('student'), 'admin'))).toBe('forbidden:403');
    expect(codeOf(() => requireRole(user(), 'student'))).toBe('forbidden:403');
  });

  it('lets a user through if any of their roles is allowed', () => {
    const u = user('student', 'author');
    expect(requireRole(u, 'author')).toBe(u);
    expect(requireRole(u, 'admin', 'student')).toBe(u);
  });

  it('hasRole is false for no user and for no match', () => {
    expect(hasRole(null, 'student')).toBe(false);
    expect(hasRole(user('expert'), 'author', 'admin')).toBe(false);
    expect(hasRole(user('expert'), 'expert')).toBe(true);
  });
});
