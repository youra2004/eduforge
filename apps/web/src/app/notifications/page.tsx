import Link from 'next/link';
import { listNotifications } from '@eduforge/core';
import { MarkReadButton } from '@/components/MarkReadButton';
import { EmptyState, PageHeader } from '@/components/ui';
import { notificationText } from '@/lib/messages';
import { requirePageRole } from '@/lib/pages';
import { getDb } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сповіщення' };

function linkFor(type: string, p: Record<string, unknown>) {
  if (type === 'review_assigned' && p.reviewId) return `/expert/reviews/${p.reviewId}`;
  return p.versionId ? `/courses/${p.versionId}` : null;
}

export default async function NotificationsPage() {
  const user = await requirePageRole('student', 'author', 'expert', 'admin');
  const items = await listNotifications(getDb(), user);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div className="page reading">
      <PageHeader
        title="Сповіщення"
        lead={
          items.length > 0 ? (unread > 0 ? `Непрочитаних: ${unread}` : 'Усе прочитано') : undefined
        }
        actions={items.length > 0 && unread > 0 ? <MarkReadButton /> : undefined}
      />
      {items.length === 0 ? (
        <EmptyState icon="bell" title="Сповіщень немає">
          Тут зʼявляться результати аудитів, призначення перевірок та інші події.
        </EmptyState>
      ) : (
        <ul className="notifications" data-testid="notifications">
          {items.map((n) => {
            const payload = n.payload as Record<string, unknown>;
            const href = linkFor(n.type, payload);
            return (
              <li key={n.id} className={n.readAt ? '' : 'unread'} data-testid="notification">
                {notificationText(n.type, payload)} {href && <Link href={href}>Відкрити</Link>}
                <div className="hint" style={{ fontWeight: 400 }}>
                  {n.createdAt.toLocaleString('uk-UA')}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
