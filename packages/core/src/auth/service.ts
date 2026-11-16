import { createHash, randomBytes } from 'node:crypto';
import {
  consents,
  loginAttempts,
  roles as allRoles,
  sessions,
  userRoles,
  users,
  type Db,
  type Role,
} from '@eduforge/db';
import { and, asc, count, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONSENT_VERSIONS } from './consent';
import { AuthError, requireRole, type AuthUser } from './guard';
import { hashPassword, verifyPassword } from './password';

export interface AuthSettings {
  sessionTtlSeconds: number;
  loginMaxAttempts: number;
  loginWindowSeconds: number;
}

const credentials = {
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  // 128 max keeps argon2 from being fed megabytes of input.
  password: z.string().min(8).max(128),
};

const registerInput = z.object({
  email: credentials.email,
  password: credentials.password,
  displayName: z.string().trim().min(1).max(100),
  acceptTerms: z.literal(true),
  acceptResearch: z.boolean().default(false),
});

const loginInput = z.object({ email: credentials.email, password: z.string().min(1).max(128) });

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const res = schema.safeParse(input);
  if (!res.success) throw new AuthError('invalid_input');
  return res.data;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

// Verified against when the email is unknown, so a miss costs the same time as a wrong password.
let dummyHash: Promise<string> | undefined;

async function loadUser(db: Db, userId: string): Promise<AuthUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: allRoles.filter((r) => rows.some((row) => row.role === r)),
  };
}

export async function createSession(db: Db, userId: string, ttlSeconds: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.insert(sessions).values({ id: tokenHash(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Registers a student (P1: the only role self-registration can give). Returns the new user. */
export async function register(db: Db, input: unknown): Promise<AuthUser> {
  const data = parse(registerInput, input);
  const passwordHash = await hashPassword(data.password);
  try {
    const userId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: data.email, passwordHash, displayName: data.displayName })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ userId: user!.id, role: 'student' });
      await tx
        .insert(consents)
        .values({ userId: user!.id, kind: 'terms', version: CONSENT_VERSIONS.terms });
      if (data.acceptResearch) {
        await tx
          .insert(consents)
          .values({ userId: user!.id, kind: 'research', version: CONSENT_VERSIONS.research });
      }
      return user!.id;
    });
    return (await loadUser(db, userId))!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AuthError('email_taken');
    throw err;
  }
}

/** Checks credentials and opens a session. Failed attempts are rate limited per email and per IP. */
export async function login(db: Db, settings: AuthSettings, input: unknown, ip?: string) {
  const data = parse(loginInput, input);
  const keys = [`email:${data.email}`, ...(ip ? [`ip:${ip}`] : [])];
  const since = new Date(Date.now() - settings.loginWindowSeconds * 1000);

  // Count and reserve an attempt in one locked step, so parallel requests cannot all slip under
  // the limit while argon2 runs. The reservation is released again if the password is right.
  const reservedIds = await db.transaction(async (tx) => {
    for (const key of [...keys].sort()) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    }
    // Old rows are only useful inside the window; clean only our own keys (they are locked).
    await tx
      .delete(loginAttempts)
      .where(and(inArray(loginAttempts.key, keys), lt(loginAttempts.createdAt, since)));
    for (const key of keys) {
      const [row] = await tx
        .select({ n: count() })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, since)));
      if ((row?.n ?? 0) >= settings.loginMaxAttempts) throw new AuthError('rate_limited');
    }
    const rows = await tx
      .insert(loginAttempts)
      .values(keys.map((key) => ({ key })))
      .returning({ id: loginAttempts.id });
    return rows.map((r) => r.id);
  });

  const [user] = await db.select().from(users).where(eq(users.email, data.email));
  dummyHash ??= hashPassword('dummy-password-for-timing');
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash), data.password);
  if (!user || !ok) throw new AuthError('invalid_credentials');

  await db.delete(loginAttempts).where(inArray(loginAttempts.id, reservedIds));
  const session = await createSession(db, user.id, settings.sessionTtlSeconds);
  return { user: (await loadUser(db, user.id))!, ...session };
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, tokenHash(token)));
}

/** The user behind a session cookie, or null if the token is unknown or expired. */
export async function getSessionUser(db: Db, token: string): Promise<AuthUser | null> {
  const [session] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  return session ? loadUser(db, session.userId) : null;
}

export interface UserWithRoles {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  roles: Role[];
}

export async function listUsers(db: Db, actor: AuthUser | null): Promise<UserWithRoles[]> {
  requireRole(actor, 'admin');
  const all = await db.select().from(users).orderBy(asc(users.createdAt));
  const roleRows = await db.select().from(userRoles);
  return all.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt,
    roles: allRoles.filter((r) => roleRows.some((row) => row.userId === u.id && row.role === r)),
  }));
}

const roleSchema = z.enum(allRoles);

async function assertUserExists(db: Db, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw new AuthError('not_found');
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!row) throw new AuthError('not_found');
}

export async function assignRole(db: Db, actor: AuthUser | null, userId: string, role: unknown) {
  requireRole(actor, 'admin');
  const parsed = parse(roleSchema, role);
  await assertUserExists(db, userId);
  await db.insert(userRoles).values({ userId, role: parsed }).onConflictDoNothing();
}

/** Removes a role. The last admin cannot lose the admin role, or nobody could assign roles again. */
export async function removeRole(db: Db, actor: AuthUser | null, userId: string, role: unknown) {
  requireRole(actor, 'admin');
  const parsed = parse(roleSchema, role);
  await assertUserExists(db, userId);
  await db.transaction(async (tx) => {
    if (parsed === 'admin') {
      // Lock the admin rows so two concurrent removals cannot both pass the check.
      const admins = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))
        .for('update');
      if (admins.length <= 1 && admins.some((a) => a.userId === userId)) {
        throw new AuthError('last_admin');
      }
    }
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, parsed)));
  });
}

/** Used by the create-admin script. Creates the user, or just adds the admin role if the email exists. */
export async function createAdmin(
  db: Db,
  input: { email: string; password: string; displayName: string },
): Promise<{ created: boolean }> {
  const data = parse(
    z.object({
      email: credentials.email,
      password: credentials.password,
      displayName: z.string().trim().min(1).max(100),
    }),
    input,
  );
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email));
  if (existing) {
    await db.insert(userRoles).values({ userId: existing.id, role: 'admin' }).onConflictDoNothing();
    return { created: false };
  }
  const passwordHash = await hashPassword(data.password);
  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: data.email, passwordHash, displayName: data.displayName })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: user!.id, role: 'admin' });
  });
  return { created: true };
}
