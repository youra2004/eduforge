import { notFound } from 'next/navigation';
import { AuthError, CourseError, examSettings, getExam } from '@eduforge/core';
import { ExamRunner, type ExamViewData } from '@/components/ExamRunner';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function ExamRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const { id } = await params;
  const exam = await getExam(getDb(), user, id, examSettings()).catch((err) => {
    if (err instanceof CourseError || err instanceof AuthError) notFound();
    throw err;
  });
  return (
    <div className="page focus">
      <ExamRunner initial={JSON.parse(JSON.stringify(exam)) as ExamViewData} />
    </div>
  );
}
