import Link from 'next/link';
import { listCourseVersions } from '@eduforge/core';
import { levelLabels, ratingBand, versionStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const versions = await listCourseVersions(getDb(), user);
  return (
    <div className="card">
      <h1>Курси</h1>
      {versions.length === 0 ? (
        <p className="muted">Поки що немає доступних курсів.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Назва</th>
              <th>Версія</th>
              <th>Рейтинг</th>
              <th>Статус</th>
              <th>Автор</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.versionId}>
                <td>
                  <Link href={`/courses/${v.versionId}`}>{v.title}</Link>
                </td>
                <td>v{v.versionNo}</td>
                <td data-testid="catalog-rating">
                  {v.rating === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <span className="rating-badge">{v.rating}/10</span>{' '}
                      <span className="muted">
                        {levelLabels[ratingBand(v.rating)]?.split(' ')[0]}
                      </span>
                    </>
                  )}
                </td>
                <td>{versionStatusLabels[v.status]}</td>
                <td>{v.authorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
