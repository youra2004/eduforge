import { learningSettings, startStudyTest, type StudyTestKind } from '@eduforge/core';
import { getCurrentUser, getDb, readCourseJson, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Starts the participant's pretest, posttest or delayed_posttest for a module; the server checks the step (P1). */
export const POST = route(
  async (req: Request, { params }: { params: Promise<{ module: string }> }) => {
    const { module } = await params;
    const body = (await readCourseJson(req)) as { kind?: StudyTestKind } | null;
    const assessment = await startStudyTest(
      getDb(),
      await getCurrentUser(),
      module,
      body?.kind as StudyTestKind,
      learningSettings(),
    );
    return Response.json({ assessment }, { status: 201 });
  },
);
