import { examSettings, saveExamDraft } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Autosave of the answer being typed (F8-R3). */
export const PUT = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = (await readCourseJson(req)) as { itemId?: string; answer?: unknown } | null;
  return Response.json(
    await saveExamDraft(
      getDb(),
      await getCurrentUser(),
      id,
      String(body?.itemId ?? ''),
      body?.answer,
      examSettings(),
    ),
  );
});
