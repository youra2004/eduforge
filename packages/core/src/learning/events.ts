import { eventLog, type Db } from '@eduforge/db';
import type { Tx } from '../courses/service';
import { experimentContext } from '../experiment/context';

/**
 * P5: research events, written from the start. Names follow the list in docs/RESEARCH.md. With `versionId`, an
 * event of a study participant also carries the `module` and `condition` they are in for that course.
 */
export async function logEvent(
  db: Db | Tx,
  userId: string,
  name: string,
  props: Record<string, unknown> = {},
  versionId?: string,
) {
  const ctx = versionId ? await experimentContext(db, userId, versionId) : null;
  await db.insert(eventLog).values({
    userId,
    name,
    props: ctx ? { ...props, module: ctx.module, condition: ctx.condition } : props,
  });
}

/** `module_finished` (RESEARCH.md §3): the learning part of a study module is over. Nothing for other courses. */
export async function logModuleFinished(db: Db | Tx, userId: string, versionId: string) {
  const ctx = await experimentContext(db, userId, versionId);
  if (ctx) await logEvent(db, userId, 'module_finished', { versionId }, versionId);
}
