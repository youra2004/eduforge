import { EXPORT_TABLES, listExperts, listReviewQueue, listUsers } from '@eduforge/core';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { EmptyState, PageHeader } from '@/components/ui';
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
    <div className="page">
      <PageHeader
        title="Користувачі та ролі"
        lead="Керуйте ролями, чергою експертної перевірки та службовими розділами."
      />
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
              <td className="muted">{u.email}</td>
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
        <EmptyState icon="eye" title="Курсів на експертній перевірці немає" testId="no-queue">
          Курс зʼявиться тут, коли аудит присудить йому рейтинг 10.
        </EmptyState>
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

      <h2>Службові розділи</h2>
      <div className="grid">
        <Link href="/admin/strikes" className="card link shortcut" data-testid="strikes-link">
          <span className="pillar-icon">
            <Icon name="alert" size={18} />
          </span>
          <strong>Порушення на іспитах</strong>
          <span>Відкрити чергу порушень та апеляцій</span>
        </Link>
        <Link
          href="/admin/certificates"
          className="card link shortcut"
          data-testid="certificates-link"
        >
          <span className="pillar-icon">
            <Icon name="award" size={18} />
          </span>
          <strong>Сертифікати</strong>
          <span>Переглянути видані сертифікати й відкликати їх</span>
        </Link>
        <Link href="/admin/demo" className="card link shortcut" data-testid="demo-link">
          <span className="pillar-icon">
            <Icon name="sliders" size={18} />
          </span>
          <strong>Демо-режим і рекомендації</strong>
          <span>Масштаб часу, запуск щоденних порад вручну</span>
        </Link>
      </div>

      <h2>Експорт дослідження</h2>
      <p className="hint">
        CSV без email та імен: людей позначає лише код учасника. Для скриптів у{' '}
        <code>analysis/</code>.
      </p>
      <ul className="chips" data-testid="export-links">
        {EXPORT_TABLES.map((t) => (
          <li key={t}>
            <a href={`/api/admin/experiment/export?table=${t}`}>{t}.csv</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
