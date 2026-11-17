import { notifications, type Db } from '@eduforge/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireRole, type AuthUser } from '../auth/guard';
import type { Tx } from '../courses/service';

export type NotificationType =
  | 'audit_finished'
  | 'audit_failed'
  | 'expert_review_started'
  | 'review_assigned'
  | 'review_decided';

/** Queues a message for a user. Runs inside the caller's transaction, so a notice exists only if its change does. */
export async function notify(
  tx: Tx | Db,
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown>,
) {
  await tx.insert(notifications).values({ userId, type, payload });
}

const anyone = (user: AuthUser | null) => requireRole(user, 'student', 'author', 'expert', 'admin');

export async function listNotifications(db: Db, user: AuthUser | null) {
  const me = anyone(user);
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, me.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function unreadCount(db: Db, user: AuthUser | null) {
  const me = anyone(user);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function markAllRead(db: Db, user: AuthUser | null) {
  const me = anyone(user);
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
}
