import { examSettings, getExamStatus, startExam } from '@eduforge/core';
import { getCurrentUser, getDb, route } from '@/lib/server';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Eligibility, rules, attempts and pause for the pre-check screen. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return Response.json({
    status: await getExamStatus(getDb(), await getCurrentUser(), id, examSettings()),
  });
});

/** Starts the next attempt, resumes an interrupted one, or returns the running exam. Time and rules are the server's (P1). */
export const POST = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const exam = await startExam(getDb(), await getCurrentUser(), id, examSettings());
  return Response.json({ exam }, { status: 201 });
});
