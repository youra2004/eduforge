import { notFound } from 'next/navigation';
import { AuthError, CourseError, getAssessment, learningSettings } from '@eduforge/core';
import { TestRunner, type AssessmentView } from '@/components/TestRunner';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const { id } = await params;
  const now = new Date();
  const assessment = await getAssessment(getDb(), user, id, learningSettings(), now).catch(
    (err) => {
      if (err instanceof CourseError || err instanceof AuthError) notFound();
      throw err;
    },
  );
  return (
    <div className="card">
      <TestRunner
        initial={JSON.parse(JSON.stringify(assessment)) as AssessmentView}
        serverNow={now.toISOString()}
      />
    </div>
  );
}
