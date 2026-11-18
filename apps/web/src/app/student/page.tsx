import Link from 'next/link';
import {
  experimentSettings,
  getOwnRecommendations,
  getParticipation,
  isDemoUser,
  listEnrollments,
  listOwnCertificates,
} from '@eduforge/core';
import { recommendationKindLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const user = await requirePageRole('student');
  const mine = await listEnrollments(getDb(), user);
  const certs = await listOwnCertificates(getDb(), user);
  const tips = await getOwnRecommendations(getDb(), user);
  const demo = await isDemoUser(getDb(), user.id);
  const study = await getParticipation(getDb(), user, experimentSettings());
  return (
    <div className="card">
      <h1>Студент</h1>
      {demo && (
        <p className="demo-banner" data-testid="demo-banner">
          Демонстраційні дані: цей обліковий запис і його історія створені для показу, а не реальним
          студентом.
        </p>
      )}
      {study && study.reminders.length > 0 && (
        <p className="reminder" role="status" data-testid="delayed-reminder">
          Нагадування: настав час пройти відкладений тест.{' '}
          <Link href="/experiment">До дослідження</Link>
        </p>
      )}
      <h2>Поради для вас</h2>
      {tips ? (
        <>
          <ul className="tips" data-testid="recommendations">
            {tips.items.map((t) => (
              <li key={t.title} className={`tip ${t.kind}`} data-testid="recommendation">
                <span className="badge">{recommendationKindLabels[t.kind]}</span>
                <strong>{t.title}</strong>
                <p>{t.text}</p>
              </li>
            ))}
          </ul>
          <p className="hint">Складено {tips.createdAt.toLocaleString('uk-UA')}.</p>
        </>
      ) : (
        <p className="muted" data-testid="no-recommendations">
          Порад поки немає. Вони зʼявляються, коли у вас є історія навчання.
        </p>
      )}
      <h2>Мої курси</h2>
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
