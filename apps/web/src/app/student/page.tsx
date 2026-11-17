import Link from 'next/link';
import { listEnrollments } from '@eduforge/core';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('student');
  const mine = await listEnrollments(getDb(), user);
  return (
    <div className="card">
      <h1>Студент</h1>
      {mine.length === 0 ? (
        <p className="muted" data-testid="no-enrollments">
          Ви ще не записані на жоден курс. Оберіть його у розділі <Link href="/courses">Курси</Link>
          .
        </p>
      ) : (
        <table data-testid="enrollments">
          <thead>
            <tr>
              <th>Курс</th>
              <th>Прогрес</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.versionId}>
                <td>
                  <Link href={`/courses/${c.versionId}`}>{c.title}</Link>{' '}
                  <span className="muted">v{c.versionNo}</span>
                </td>
                <td>
                  пройдено {c.nodesPassed} з {c.nodesTotal}
                </td>
                <td>{c.status === 'completed' ? 'Курс пройдено' : 'У процесі'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">Іспит зʼявиться, коли ви пройдете всі вузли курсу.</p>
    </div>
  );
}
