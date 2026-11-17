import { notFound } from 'next/navigation';
import { CourseError, examSettings, getExamStatus } from '@eduforge/core';
import { ExamPrecheck, type ExamStatusView } from '@/components/ExamPrecheck';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const { id } = await params;
  const now = new Date();
  const status = await getExamStatus(getDb(), user, id, examSettings(), now).catch((err) => {
    if (err instanceof CourseError) notFound();
    throw err;
  });
  return (
    <div className="card">
      <ExamPrecheck
        status={JSON.parse(JSON.stringify(status)) as ExamStatusView}
        serverNow={now.toISOString()}
      />
    </div>
  );
}
