import { editGraph } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

/** One editor change (add/update/delete a node, edge or skill); see `graphEdit` in core for the shapes. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(
    await editGraph(getDb(), await getCurrentUser(), id, await readCourseJson(req)),
  );
});
