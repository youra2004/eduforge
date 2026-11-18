import { EXPORT_TABLES, listExperts, listReviewQueue, listUsers } from '@eduforge/core';
import Link from 'next/link';
import { ReviewAssign } from '@/components/ReviewAssign';
import { RoleEditor } from '@/components/RoleEditor';
import { reviewStatusLabels } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const admin = await requirePageRole('admin');
  const users = await listUsers(getDb(), admin);
  const queue = await listReviewQueue(getDb(), admin);
  const experts = await listExperts(getDb(), admin);
  return (
    <div className="card">
      <h1>Користувачі та ролі</h1>
      <table>
        <thead>
          <tr>
            <th>Імʼя</th>
            <th>Email</th>
            <th>Ролі</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.displayName}</td>
              <td>{u.email}</td>
              <td>
                <RoleEditor userId={u.id} roles={u.roles} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Черга експертної перевірки</h2>
      <p className="hint">
        Курси, що претендують на рейтинг 10, не публікуються без експерта. Призначте експерта для
        кожного.
      </p>
      {queue.length === 0 ? (
        <p className="muted" data-testid="no-queue">
          Курсів на експертній перевірці немає.
        </p>
      ) : (
        <table data-testid="review-queue">
          <thead>
            <tr>
              <th>Курс</th>
              <th>Автор</th>
              <th>Експерт</th>
              <th>Стан</th>
              <th>Призначення</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((q) => (
              <tr key={q.versionId}>
                <td>
                  <Link href={`/courses/${q.versionId}`}>{q.title}</Link>{' '}
                  <span className="muted">v{q.versionNo}</span>
                </td>
                <td>{q.authorName}</td>
                <td>{q.expertName ?? '—'}</td>
                <td>{q.review ? reviewStatusLabels[q.review.status] : 'Очікує призначення'}</td>
                <td>
                  <ReviewAssign
                    versionId={q.versionId}
                    experts={experts}
                    currentExpertName={q.expertName}
                    decided={!!q.review && q.review.status !== 'assigned'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Порушення на іспитах</h2>
      <p>
        <Link href="/admin/strikes" data-testid="strikes-link">
          Відкрити чергу порушень та апеляцій
        </Link>
      </p>
      <h2>Сертифікати</h2>
      <p>
        <Link href="/admin/certificates" data-testid="certificates-link">
          Переглянути видані сертифікати й відкликати їх
        </Link>
      </p>
      <h2>Демо-режим і рекомендації</h2>
      <p>
        <Link href="/admin/demo" data-testid="demo-link">
          Масштаб часу, запуск щоденних порад вручну
        </Link>
      </p>
      <h2>Експорт дослідження</h2>
      <p className="hint">
        CSV без email та імен: людей позначає лише код учасника. Для скриптів у{' '}
        <code>analysis/</code>.
      </p>
      <ul data-testid="export-links">
        {EXPORT_TABLES.map((t) => (
          <li key={t}>
            <a href={`/api/admin/experiment/export?table=${t}`}>{t}.csv</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
