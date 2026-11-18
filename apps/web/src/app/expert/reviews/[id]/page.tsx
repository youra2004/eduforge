import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseError, getReview, type AuditSummary } from '@eduforge/core';
import { ReviewForm } from '@/components/ReviewForm';
import { checklistLabels, feedbackLabels, levelLabels, reviewStatusLabels } from '@/lib/messages';
import { PageHeader } from '@/components/ui';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageRole('expert', 'admin');
  const { id } = await params;
  const r = await getReview(getDb(), user, id).catch((err) => {
    if (err instanceof CourseError) notFound();
    throw err;
  });
  const summary = r.version.auditSummary as AuditSummary | null;
  return (
    <div className="page reading">
      <PageHeader
        back={{ href: '/expert', label: 'Черга перевірки' }}
        title={
          <>
            {r.version.title} <span className="muted">v{r.version.versionNo}</span>
          </>
        }
        lead={r.version.description || undefined}
        actions={
          <Link href={`/courses/${r.version.id}`} className="btn secondary">
            Відкрити курс, його граф і матеріали
          </Link>
        }
      />
      <p>
        <span className="badge accent" data-testid="review-status">
          {reviewStatusLabels[r.review.status]}
        </span>
      </p>
      <h2>Що встановив аудит</h2>
      <dl className="feedback" data-testid="review-audit">
        <div>
          <dt>Заявлений рівень</dt>
          <dd>{r.version.declaredLevel ? levelLabels[r.version.declaredLevel] : '—'}</dd>
        </div>
        <div>
          <dt>Рівень за оцінкою ШІ</dt>
          <dd>{r.version.aiLevel ? levelLabels[r.version.aiLevel] : '—'}</dd>
        </div>
        <div>
          <dt>Складність</dt>
          <dd>{r.version.aiHardness?.toFixed(2) ?? '—'}</dd>
        </div>
        {summary?.feedback &&
          (Object.keys(feedbackLabels) as (keyof typeof feedbackLabels)[]).map((k) => (
            <div key={k}>
              <dt>{feedbackLabels[k]}</dt>
              <dd>{summary.feedback![k]}</dd>
            </div>
          ))}
      </dl>
      <h2>Рішення</h2>
      {r.canDecide ? (
        <ReviewForm reviewId={r.review.id} />
      ) : (
        <div data-testid="review-decided">
          {r.review.checklist && (
            <>
              <ul>
                {Object.entries(r.review.checklist.items).map(([key, ok]) => (
                  <li key={key}>
                    {ok ? '✓' : '✗'} {checklistLabels[key as keyof typeof checklistLabels] ?? key}
                  </li>
                ))}
              </ul>
              {r.review.checklist.comment && <blockquote>{r.review.checklist.comment}</blockquote>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
