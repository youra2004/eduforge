import { eventLog, type Db } from '@eduforge/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../auth/guard';
import { requireRole } from '../auth/guard';
import { CourseError } from '../courses/errors';
import { assertNodeAccess } from '../learning/access';
import { logEvent } from '../learning/events';
import type { ExperimentSettings } from './service';

const base = { nodeId: z.uuid() };
const clientEvent = z.discriminatedUnion('name', [
  z.object({ name: z.literal('content_opened'), ...base }),
  z.object({ name: z.literal('session_heartbeat'), ...base }),
  z.object({
    name: z.literal('video_progress'),
    ...base,
    contentItemId: z.uuid(),
    positionSeconds: z.number().min(0).max(86_400),
    durationSeconds: z.number().min(0).max(86_400).optional(),
    ended: z.boolean().optional(),
  }),
]);

/**
 * The events only the browser can see (RESEARCH.md §3): a node's material was opened, video progress and the
 * heartbeat that measures learning time. The server decides what is accepted: a known name, a node the user may
 * open, and at most one heartbeat per interval, so the client cannot inflate learning time (P1).
 */
export async function recordClientEvent(
  db: Db,
  user: AuthUser | null,
  input: unknown,
  settings: Pick<ExperimentSettings, 'heartbeatSeconds'>,
  now = new Date(),
) {
  const parsed = clientEvent.safeParse(input);
  if (!parsed.success) throw new CourseError('invalid_content');
  const actor = requireRole(user, 'student', 'author', 'expert', 'admin');
  const { version } = await assertNodeAccess(db, actor, parsed.data.nodeId);
  const { name, ...props } = parsed.data;
  if (name === 'session_heartbeat') {
    const floor = new Date(now.getTime() - settings.heartbeatSeconds * 0.8 * 1000);
    const [recent] = await db
      .select({ id: eventLog.id })
      .from(eventLog)
      .where(and(eq(eventLog.userId, actor.id), eq(eventLog.name, name), gt(eventLog.ts, floor)))
      .orderBy(desc(eventLog.ts))
      .limit(1);
    if (recent) return { logged: false };
  }
  await logEvent(db, actor.id, name, props, version.id);
  return { logged: true };
}
