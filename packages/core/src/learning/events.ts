import { eventLog, type Db } from '@eduforge/db';
import type { Tx } from '../courses/service';

/** P5: research events, written from the start. Names follow the list in docs/RESEARCH.md. */
export async function logEvent(
  db: Db | Tx,
  userId: string,
  name: string,
  props: Record<string, unknown> = {},
) {
  await db.insert(eventLog).values({ userId, name, props });
}
