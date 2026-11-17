import Link from 'next/link';
import { listCourseVersions } from '@eduforge/core';
import { CreateCourseForm } from '@/components/CreateCourseForm';
import { versionStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('author');
  const mine = (await listCourseVersions(getDb(), user)).filter((v) => v.authorId === user.id);
  return (
    <div className="card">
      <h1>Автор</h1>
      <h2>Мої курси</h2>
      {mine.length === 0 ? (
        <p className="muted" data-testid="no-courses">
          У вас ще немає курсів. Створіть перший нижче.
        </p>
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
                <td>{versionStatusLabels[v.status]}</td>
                <td>{v.rating === null ? '—' : `${v.rating}/10`}</td>
                <td>{v.auditAttempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Новий курс</h2>
      <p className="hint">
        Створіть порожній курс, додайте у редакторі навички, вузли та передумови, наповніть вузли
        матеріалами й питаннями, а потім надішліть курс на аудит.
      </p>
      <CreateCourseForm />
    </div>
  );
}
