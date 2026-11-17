import { CourseError, examSettings, resolveAppeal, reviewSoftStrike } from '@eduforge/core';
import { z } from 'zod';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

const body = z.object({
  outcome: z.enum(['confirm', 'dismiss', 'overturn', 'reject']),
  note: z.string().max(2000).optional(),
});

/** An admin's decision on a flagged attempt (confirm / dismiss) or on an appeal (overturn / reject) (F9-R3, F9-R6). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const parsed = body.safeParse(await readCourseJson(req));
  if (!parsed.success) throw new CourseError('invalid_proctor_event');
  const { outcome, note } = parsed.data;
  const user = await getCurrentUser();
  const settings = examSettings().proctor;
  const strike =
    outcome === 'confirm' || outcome === 'dismiss'
      ? await reviewSoftStrike(getDb(), user, id, outcome, { note }, settings)
      : await resolveAppeal(getDb(), user, id, outcome, { note }, settings);
  return Response.json({ strike: { id: strike.id, status: strike.status, level: strike.level } });
});
