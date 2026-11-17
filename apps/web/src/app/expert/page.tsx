import Link from 'next/link';
import { listMyReviews } from '@eduforge/core';
import { levelLabels, reviewStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('expert');
  const reviews = await listMyReviews(getDb(), user);
  return (
    <div className="card">
      <h1>Експерт</h1>
      <h2>Черга перевірки</h2>
      {reviews.length === 0 ? (
        <p className="muted" data-testid="no-reviews">
          Вам поки що не призначено жодної перевірки. Кандидатів на рейтинг 10 призначає
          адміністратор.
        </p>
      ) : (
        <table data-testid="review-queue">
          <thead>
            <tr>
              <th>Курс</th>
              <th>Заявлений рівень</th>
              <th>Призначено</th>
              <th>Стан</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <tr key={r.reviewId}>
                <td>
                  <Link href={`/expert/reviews/${r.reviewId}`}>{r.title}</Link>{' '}
                  <span className="muted">v{r.versionNo}</span>
                </td>
                <td>{r.declaredLevel ? levelLabels[r.declaredLevel] : '—'}</td>
                <td>{r.createdAt.toLocaleDateString('uk-UA')}</td>
                <td>{reviewStatusLabels[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
