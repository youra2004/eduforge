import { createDb, loginAttempts, sessions, users, userRoles, consents } from '@eduforge/db';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { hasCurrentConsent, recordConsent, CONSENT_VERSIONS } from './consent';
import { AuthError, type AuthUser } from './guard';
import {
  assignRole,
  createAdmin,
  getSessionUser,
  listUsers,
  login,
  logout,
  register,
  removeRole,
  createSession,
  type AuthSettings,
} from './service';

const { db, pool } = createDb(process.env.TEST_DATABASE_URL!);
afterAll(() => pool.end());

const settings: AuthSettings = {
  sessionTtlSeconds: 3600,
  loginMaxAttempts: 3,
  loginWindowSeconds: 900,
};
const PASSWORD = 'correct horse battery';
let n = 0;
const email = () => `user${Date.now()}-${n++}@test.local`;
const reg = (e = email(), extra: object = {}) =>
  register(db, { email: e, password: PASSWORD, displayName: 'Тест', acceptTerms: true, ...extra });

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err instanceof AuthError ? err.code : `other:${String(err)}`;
  }
  return 'none';
}

describe('register', () => {
  it('creates a student, hashes the password and records the terms consent', async () => {
    const e = email();
    const user = await reg(e);
    expect(user.roles).toEqual(['student']);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.passwordHash).not.toContain(PASSWORD);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);

    const rows = await db.select().from(consents).where(eq(consents.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'terms', version: CONSENT_VERSIONS.terms });
    expect(rows[0]!.givenAt).toBeInstanceOf(Date);
  });

  it('also records research consent only when it was given', async () => {
    const user = await reg(email(), { acceptResearch: true });
    expect(await hasCurrentConsent(db, user.id, 'research')).toBe(true);
    const other = await reg();
    expect(await hasCurrentConsent(db, other.id, 'research')).toBe(false);
  });

  it('rejects missing terms, weak password, bad email and a duplicate email', async () => {
    expect(await codeOf(reg(email(), { acceptTerms: false }))).toBe('invalid_input');
    expect(await codeOf(reg(email(), { password: 'short' }))).toBe('invalid_input');
    expect(await codeOf(reg('not-an-email'))).toBe('invalid_input');
    const e = email();
    await reg(e);
    expect(await codeOf(reg(e.toUpperCase()))).toBe('email_taken');
  });

  it('ignores a role passed in the input', async () => {
    const user = await reg(email(), { roles: ['admin'], role: 'admin' });
    expect(user.roles).toEqual(['student']);
  });
});

describe('login and sessions', () => {
  it('logs in, finds the user by the session token, and logs out', async () => {
    const e = email();
    await reg(e);
    const { token, user } = await login(db, settings, { email: e, password: PASSWORD });
    expect((await getSessionUser(db, token))?.id).toBe(user.id);

    await logout(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
  });

  it('stores only a hash of the session token', async () => {
    const e = email();
    await reg(e);
    const { token } = await login(db, settings, { email: e, password: PASSWORD });
    const rows = await db.select().from(sessions);
    expect(rows.some((r) => r.id === token)).toBe(false);
  });

  it('ignores expired sessions and unknown tokens', async () => {
    const user = await reg();
    const { token } = await createSession(db, user.id, -1);
    expect(await getSessionUser(db, token)).toBeNull();
    expect(await getSessionUser(db, 'nope')).toBeNull();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const e = email();
    await reg(e);
    expect(await codeOf(login(db, settings, { email: e, password: 'wrong-password' }))).toBe(
      'invalid_credentials',
    );
    expect(await codeOf(login(db, settings, { email: email(), password: PASSWORD }))).toBe(
      'invalid_credentials',
    );
  });

  it('rate limits after too many failures, even for the right password', async () => {
    const e = email();
    await reg(e);
    for (let i = 0; i < settings.loginMaxAttempts; i++) {
      expect(await codeOf(login(db, settings, { email: e, password: 'wrong-password' }))).toBe(
        'invalid_credentials',
      );
    }
    expect(await codeOf(login(db, settings, { email: e, password: PASSWORD }))).toBe(
      'rate_limited',
    );
  });

  it('lets only loginMaxAttempts parallel wrong guesses through', async () => {
    const e = email();
    await reg(e);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        codeOf(login(db, settings, { email: e, password: 'wrong-password' })),
      ),
    );
    expect(results.filter((c) => c === 'invalid_credentials')).toHaveLength(
      settings.loginMaxAttempts,
    );
    expect(results.filter((c) => c === 'rate_limited')).toHaveLength(
      12 - settings.loginMaxAttempts,
    );
  });

  it('a successful login does not leave an attempt behind', async () => {
    const e = email();
    await reg(e);
    for (let i = 0; i < settings.loginMaxAttempts - 1; i++) {
      await codeOf(login(db, settings, { email: e, password: 'wrong-password' }));
    }
    await login(db, settings, { email: e, password: PASSWORD });
    const rows = await db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.key, `email:${e}`));
    expect(rows).toHaveLength(settings.loginMaxAttempts - 1);
  });

  it('rate limits per IP across different emails', async () => {
    const ip = `10.0.0.${n++}`;
    for (let i = 0; i < settings.loginMaxAttempts; i++) {
      await codeOf(login(db, settings, { email: email(), password: 'wrong-password' }, ip));
    }
    const e = email();
    await reg(e);
    expect(await codeOf(login(db, settings, { email: e, password: PASSWORD }, ip))).toBe(
      'rate_limited',
    );
  });

  it('forgets failures older than the window', async () => {
    const e = email();
    await reg(e);
    const old = new Date(Date.now() - (settings.loginWindowSeconds + 60) * 1000);
    await db
      .insert(loginAttempts)
      .values(Array.from({ length: 5 }, () => ({ key: `email:${e}`, createdAt: old })));
    expect(await codeOf(login(db, settings, { email: e, password: PASSWORD }))).toBe('none');
  });
});

describe('roles', () => {
  async function admin(): Promise<AuthUser> {
    const e = email();
    await createAdmin(db, { email: e, password: PASSWORD, displayName: 'Адмін' });
    const { user } = await login(db, settings, { email: e, password: PASSWORD });
    return user;
  }

  it('lets an admin assign and remove roles, and the change persists', async () => {
    const a = await admin();
    const student = await reg();
    await assignRole(db, a, student.id, 'author');
    await assignRole(db, a, student.id, 'author'); // idempotent
    let rows = await db.select().from(userRoles).where(eq(userRoles.userId, student.id));
    expect(rows.map((r) => r.role).sort()).toEqual(['author', 'student']);

    await removeRole(db, a, student.id, 'student');
    rows = await db.select().from(userRoles).where(eq(userRoles.userId, student.id));
    expect(rows.map((r) => r.role)).toEqual(['author']);
  });

  it('blocks non-admins and anonymous callers on the server', async () => {
    const student = await reg();
    const other = await reg();
    expect(await codeOf(assignRole(db, student, other.id, 'admin'))).toBe('forbidden');
    expect(await codeOf(removeRole(db, student, other.id, 'student'))).toBe('forbidden');
    expect(await codeOf(listUsers(db, student))).toBe('forbidden');
    expect(await codeOf(assignRole(db, null, other.id, 'admin'))).toBe('unauthenticated');
    expect(await codeOf(listUsers(db, null))).toBe('unauthenticated');
  });

  it('rejects unknown roles and unknown users', async () => {
    const a = await admin();
    const student = await reg();
    expect(await codeOf(assignRole(db, a, student.id, 'superuser'))).toBe('invalid_input');
    expect(await codeOf(assignRole(db, a, '00000000-0000-0000-0000-000000000000', 'author'))).toBe(
      'not_found',
    );
  });

  it('does not let the last admin lose the admin role', async () => {
    // Make this admin the only one: drop admin from everyone else.
    const a = await admin();
    const others = await db.select().from(userRoles);
    for (const r of others) {
      if (r.role === 'admin' && r.userId !== a.id) {
        await db.delete(userRoles).where(eq(userRoles.userId, r.userId));
      }
    }
    expect(await codeOf(removeRole(db, a, a.id, 'admin'))).toBe('last_admin');

    const second = await admin();
    await removeRole(db, a, a.id, 'admin');
    expect(await codeOf(removeRole(db, second, second.id, 'admin'))).toBe('last_admin');
  });

  it('createAdmin adds the role to an existing user without changing the password', async () => {
    const e = email();
    const user = await reg(e);
    expect(
      await createAdmin(db, { email: e, password: 'another-password', displayName: 'X' }),
    ).toEqual({
      created: false,
    });
    const { user: loggedIn } = await login(db, settings, { email: e, password: PASSWORD });
    expect(loggedIn.id).toBe(user.id);
    expect(loggedIn.roles).toEqual(['student', 'admin']);
  });
});

describe('consent', () => {
  it('records the current version and time, and old versions do not count', async () => {
    const user = await reg();
    expect(await hasCurrentConsent(db, user.id, 'proctoring')).toBe(false);
    const row = await recordConsent(db, user.id, 'proctoring');
    expect(row.version).toBe(CONSENT_VERSIONS.proctoring);
    expect(await hasCurrentConsent(db, user.id, 'proctoring')).toBe(true);

    await db.update(consents).set({ version: 'old' }).where(eq(consents.id, row.id));
    expect(await hasCurrentConsent(db, user.id, 'proctoring')).toBe(false);
  });
});
