import Link from 'next/link';
import {
  experimentSettings,
  getParticipation,
  listEnrollments,
  listOwnCertificates,
} from '@eduforge/core';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('student');
  const mine = await listEnrollments(getDb(), user);
  const certs = await listOwnCertificates(getDb(), user);
  const study = await getParticipation(getDb(), user, experimentSettings());
  return (
    <div className="card">
      <h1>Студент</h1>
      {study && study.reminders.length > 0 && (
        <p className="reminder" role="status" data-testid="delayed-reminder">
          Нагадування: настав час пройти відкладений тест.{' '}
          <Link href="/experiment">До дослідження</Link>
        </p>
      )}
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
                <td>
                  {c.status === 'completed' ? (
                    <>
                      Курс пройдено ·{' '}
                      <Link href={`/courses/${c.versionId}/exam`} data-testid="exam-link">
                        Іспит
                      </Link>
                    </>
                  ) : (
                    'У процесі'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {certs.length > 0 && (
        <>
          <h2>Мої сертифікати</h2>
          <ul data-testid="my-certificates">
            {certs.map((c) => (
              <li key={c.id}>
                <Link href={`/verify/${c.id}`}>{c.title}</Link>{' '}
                <span className="muted">
                  {c.issuedAt.toLocaleDateString('uk-UA')}
                  {c.revoked && ' · відкликано'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">Іспит зʼявиться, коли ви пройдете всі вузли курсу.</p>
    </div>
  );
}
