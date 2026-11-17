import {
  askTutor,
  createEmbeddingClient,
  createLLMClient,
  loadConfig,
  type TutorInput,
} from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** One tutor turn: a hint that passed the guard, or the author's static hint (F6). The server picks the hint level. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readCourseJson(req);
  const db = getDb();
  const config = loadConfig();
  const result = await askTutor(
    db,
    {
      llm: createLLMClient(db),
      embedder: createEmbeddingClient(db, config),
      limits: config.tutor,
    },
    await getCurrentUser(),
    id,
    body as TutorInput,
  );
  return Response.json(result);
});
