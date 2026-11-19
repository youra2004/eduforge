import Link from 'next/link';
import { listCourseVersions } from '@eduforge/core';
import { CreateCourseForm } from '@/components/CreateCourseForm';
import { versionStatusLabels } from '@/lib/messages';
import { EmptyState, PageHeader } from '@/components/ui';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('author');
  const mine = (await listCourseVersions(getDb(), user)).filter((v) => v.authorId === user.id);
  return (
    <div className="page">
      <PageHeader
        title="Автор"
        lead="Створюйте курси, будуйте граф знань і надсилайте їх на аудит."
      />
      <h2 style={{ marginTop: 0 }}>Мої курси</h2>
      {mine.length === 0 ? (
        <EmptyState icon="pen" title="У вас ще немає курсів" testId="no-courses">
          Створіть перший нижче.
        </EmptyState>
      ) : (
        <table data-testid="my-courses">
          <thead>
            <tr>
              <th>Назва</th>
              <th>Версія</th>
              <th>Стан</th>
              <th>Рейтинг</th>
              <th>Аудити</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((v) => (
              <tr key={v.versionId}>
                <td>
                  <Link href={`/courses/${v.versionId}`}>{v.title}</Link>
                </td>
                <td>v{v.versionNo}</td>
                <td>
                  <span className={v.status === 'published' ? 'badge ok' : 'badge'}>
                    {versionStatusLabels[v.status]}
                  </span>
                </td>
                <td>
                  {v.rating === null ? '—' : <span className="rating-badge">{v.rating}/10</span>}
                </td>
                <td>{v.auditAttempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Новий курс</h2>
      <div className="card">
        <p className="hint">
          Створіть порожній курс, додайте у редакторі навички, вузли та передумови, наповніть вузли
          матеріалами й питаннями, а потім надішліть курс на аудит.
        </p>
        <CreateCourseForm />
      </div>
    </div>
  );
}
