import { submitSurvey } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

export const POST = route(
  async (req: Request, { params }: { params: Promise<{ module: string }> }) => {
    const { module } = await params;
    await submitSurvey(getDb(), await getCurrentUser(), module, await readCourseJson(req));
    return Response.json({ submitted: true }, { status: 201 });
  },
);
