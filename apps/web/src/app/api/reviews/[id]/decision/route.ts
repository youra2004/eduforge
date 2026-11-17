import { decideReview } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

type Ctx = { params: Promise<{ id: string }> };

/** The assigned expert decides: `{ decision: "approved" | "rejected", items: {...}, comment }`. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json(
    await decideReview(getDb(), await getCurrentUser(), id, await readCourseJson(req)),
  );
});
