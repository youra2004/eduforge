import Link from 'next/link';
import { listCourseVersions } from '@eduforge/core';
import { Icon } from '@/components/icons';
import { PageHeader, EmptyState } from '@/components/ui';
import { levelLabels, ratingBand, versionStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Курси' };

export default async function CoursesPage() {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const versions = await listCourseVersions(getDb(), user);
  return (
    <div className="page">
      <PageHeader title="Курси" lead="Оберіть курс, перегляньте його граф знань і запишіться." />
      {versions.length === 0 ? (
        <EmptyState icon="book" title="Поки що немає доступних курсів">
          Опубліковані курси зʼявляться тут.
        </EmptyState>
      ) : (
        <table className="catalog">
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
                  <Link href={`/courses/${v.versionId}`} className="catalog-title">
                    <span className="pillar-icon">
                      <Icon name="book" size={16} />
                    </span>
                    {v.title}
                  </Link>
                </td>
                <td className="muted">v{v.versionNo}</td>
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
                <td>
                  <span className={v.status === 'published' ? 'badge ok' : 'badge'}>
                    {versionStatusLabels[v.status]}
                  </span>
                </td>
                <td className="muted">{v.authorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
